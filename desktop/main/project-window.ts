/**
 * One window, one open project.
 *
 * The window hosts two things. The **chrome renderer** is the window's own
 * `webContents` and owns everything that is not generated code — the top bar,
 * project switching, the foundation wizard, preferences, notifications. The
 * **canvas** is a `WebContentsView` layered on top of it, pointed straight at
 * the project's Vite URL, so the canvas app that already exists in
 * `.caret/lib/canvas/` runs completely unported.
 *
 * A `BrowserWindow` rather than a `BaseWindow` with two child views, because the
 * chrome *is* the window here — and because automation tools (and the OS) only
 * recognise a window's own `webContents` as a window, which a `BaseWindow` does
 * not have.
 *
 * The chrome reports how much room its top bar takes (`canvas:setBounds`), which
 * keeps layout authority in the renderer, where that height is actually known.
 */
import { BrowserWindow, WebContentsView } from "electron"
import * as path from "path"

import {
	caretDirectoryExists,
	DesignSession,
	hostFor,
	readFoundationTokens,
	registerProjectServices,
	unregisterProjectServices,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { AgentService } from "./agent-service"
import { CatalogService } from "./catalog-service"
import { DesignChecksService } from "./design-checks"
import { createElectronDesignHost } from "./electron-host"
import { CaretMcpServer } from "./mcp/server"
import { migrateProject } from "./migrate"
import { recordRecentProject } from "./prefs"
import { regenerateRulesFiles } from "./rules/generate"
import type { DesignInboundMessage, DesignOutboundMessage, ProjectState, ScreenshotResult } from "./types"
import { WatchAndHeal } from "./watch-and-heal"

/** Fallback top-bar height, used until the chrome reports its real layout. */
const DEFAULT_CHROME_INSET = 44

interface ChromeInsets {
	top: number
	right: number
}

export interface ProjectWindowOptions {
	projectPath: string
	chromeEntry: { url?: string; file?: string }
	preloadChrome: string
	preloadCanvas: string
	onClosed(projectPath: string): void
}

export class ProjectWindow {
	readonly projectPath: string
	readonly window: BrowserWindow

	private canvas: WebContentsView | null = null
	private agent: AgentService
	private checks: DesignChecksService
	private catalog: CatalogService
	private session: DesignSession
	private mcp: CaretMcpServer
	private healer: WatchAndHeal
	private chromeInsets: ChromeInsets = { top: DEFAULT_CHROME_INSET, right: 0 }
	private canvasVisible = false
	private closed = false

	constructor(private readonly options: ProjectWindowOptions) {
		this.projectPath = options.projectPath

		this.window = new BrowserWindow({
			width: 1440,
			height: 900,
			minWidth: 900,
			minHeight: 600,
			title: `${path.basename(this.projectPath)} — Caret`,
			backgroundColor: "#0b0d12",
			titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
			webPreferences: {
				preload: options.preloadChrome,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: false,
			},
		})

		// Services are keyed by project path, so two open projects each notify into
		// their own window rather than whichever one started last.
		registerProjectServices(this.projectPath, {
			host: createElectronDesignHost({
				chrome: () => (this.closed || this.window.isDestroyed() ? null : this.window.webContents),
				sendToCanvas: (message) => this.sendToCanvas(message),
				// Lazily: the healer is constructed a few lines below this call.
				noteSelfWrite: (file) => this.healer?.markSelfWrite(file),
			}),
		})

		this.checks = new DesignChecksService({
			projectPath: this.projectPath,
			baseUrl: () => this.session.getUrl(),
		})

		this.catalog = new CatalogService({
			projectPath: this.projectPath,
			// The lock is always-on context — a stale index would have the agent
			// re-import what is already installed under a different name.
			onInstalled: () =>
				void regenerateRulesFiles(this.projectPath).catch((err) => Logger.warn(`[window] rules regen failed: ${err}`)),
		})

		// Constructed before the session, because registering the bridge is what
		// makes every outbound feature stop refusing.
		this.agent = new AgentService({
			projectPath: this.projectPath,
			onState: (state) => this.sendToChrome("agent:state", this.projectPath, state),
			// The pill lives where the intent was expressed: in the canvas, not the
			// chat. This is the entire live surface a canvas edit gets.
			onEditStatus: (status) => this.sendToCanvas({ source: "caret-host", type: "edit-status", payload: status }),
			// The owned loop is what makes the checker ENFORCED rather than
			// requested: every turn that wrote pages gets checked, and errors go
			// straight back into the session that made them.
			onTurnComplete: (conversation, outcome, request) => this.checks.afterTurn(conversation, outcome, request),
		})

		this.session = new DesignSession({
			workspacePath: this.projectPath,
			onUrlChanged: (url) => this.onCanvasUrlChanged(url),
		})

		this.mcp = new CaretMcpServer({
			projectPath: this.projectPath,
			onAgentConnectionChanged: () => void this.pushState(),
			screenshot: (pageId) => this.screenshotPage(pageId),
			runChecks: (pageId) => this.checks.run(pageId ? [pageId] : undefined),
			installComponent: (libraryId, componentId) => this.catalog.install(libraryId, componentId),
			onInterviewPrompt: (prompt) => this.sendToChrome("interview:prompt", prompt),
		})

		this.healer = new WatchAndHeal({
			projectPath: this.projectPath,
			isAgentActive: () => this.agent.conversation.getState().streaming,
			onFirstDirectWrite: (file) => this.noticeDirectWrite(file),
			onTokensChanged: () => void this.pushState(),
			// An asset can arrive from an agent or from Finder, not only from the
			// library surface, so the renderer is told rather than left to poll.
			onAssetsChanged: () => this.sendToChrome("assets:changed", this.projectPath),
			onPageWritten: (file) => void this.catalog.ensureSuppliedFor(file),
		})

		this.loadChrome()
		this.window.on("resize", () => this.layout())
		this.window.on("closed", () => this.onWindowClosed())
		this.layout()
	}

	/** Boots Vite, the MCP endpoint, the backend and the healer. Safe to call once. */
	async start(): Promise<void> {
		await recordRecentProject(this.projectPath)

		// Runs before anything reads `.caret/`, so a project written by the VS Code
		// extension is in the current shape by the time the session starts.
		await migrateProject(this.projectPath).catch((err) => Logger.warn(`[window] migration failed: ${err}`))

		// The healer and the rules files do not wait on Vite.
		//
		// Booting the preview can take a minute on first run (npm install) and can
		// fail outright — a port already taken, a broken install. Neither has
		// anything to do with healing `.caret/` or writing the rules an agent reads,
		// and gating them on Vite meant a slow preview left the design layer
		// unhealed and every agent working from stale foundations.
		this.healer.start()
		const rules = regenerateRulesFiles(this.projectPath).catch((err) =>
			Logger.warn(`[window] rules generation failed: ${err}`),
		)

		await Promise.all([this.session.start(), this.mcp.start(), this.agent.start(), rules])

		// First pass over every page, so the canvas shows check results without
		// anything having asked — a defect that predates this session is still a
		// defect. Backgrounded: N hidden renders must not delay the window.
		void this.checks.run().catch((err) => Logger.warn(`[window] initial design checks failed: ${err}`))

		await this.pushState()
	}

	async close(): Promise<void> {
		if (this.closed) return
		this.closed = true
		this.checks.close()
		await Promise.allSettled([this.session.stop(), this.mcp.stop(), this.healer.stop(), this.agent.close()])
		unregisterProjectServices(this.projectPath)
		if (!this.window.isDestroyed()) this.window.destroy()
	}

	async getState(): Promise<ProjectState> {
		const hasFoundation = (await caretDirectoryExists(this.projectPath))
			? Boolean(await readFoundationTokens(this.projectPath))
			: false
		return {
			path: this.projectPath,
			name: path.basename(this.projectPath),
			canvasUrl: this.session.getUrl(),
			mcpUrl: this.mcp.getUrl(),
			agentConnected: this.mcp.hasConnectedAgent(),
			hasFoundation,
		}
	}

	/** Routes a message that arrived from the canvas. */
	handleCanvasMessage(message: DesignInboundMessage): Promise<void> {
		return this.session.handleCanvasMessage(message)
	}

	sendToCanvas(message: DesignOutboundMessage): void {
		if (this.canvas && !this.canvas.webContents.isDestroyed()) {
			this.canvas.webContents.send("canvas:fromHost", message)
		}
	}

	sendToChrome(channel: string, ...args: unknown[]): void {
		if (this.closed || this.window.isDestroyed()) return
		this.window.webContents.send(channel, ...args)
	}

	/** The chrome reporting how much room it occupies around the canvas. */
	setChromeInsets(insets: ChromeInsets): void {
		this.chromeInsets = {
			top: Math.max(0, Math.round(insets.top)),
			right: Math.max(0, Math.round(insets.right)),
		}
		this.layout()
	}

	/** Hides the canvas so the chrome can show a full-window surface (wizard, prefs). */
	setCanvasVisible(visible: boolean): void {
		this.canvasVisible = visible
		this.layout()
	}

	requestSync(): Promise<void> {
		return this.session.requestSync()
	}

	getMcpServer(): CaretMcpServer {
		return this.mcp
	}

	/**
	 * Said once, the first time something edits `.caret/` around Caret.
	 *
	 * Not a warning — the write is honoured and healed like any other, and it has
	 * to be, because Caret cannot stop an agent or an editor from touching a file.
	 * It is a signpost: the visual editor knows what a caret-id is for and a text
	 * editor does not, so the file that comes back from one needs no repair.
	 */
	private noticeDirectWrite(filePath: string): void {
		const name = path.relative(this.projectPath, filePath) || path.basename(filePath)
		void hostFor(this.projectPath).notify(
			"info",
			`Something edited ${name} directly. Caret fixed it up, but editing on the canvas — or asking in the chat — is the path that stays reliable.`,
		)
	}

	getAgent(): AgentService {
		return this.agent
	}

	focus(): void {
		if (!this.window.isDestroyed()) this.window.focus()
	}

	private loadChrome(): void {
		const { url, file } = this.options.chromeEntry

		// The renderer's own `<title>` wins once the document loads, which would
		// leave every project window named the same thing — unusable in the dock
		// and the Window menu with more than one project open.
		const title = `${path.basename(this.projectPath)} — Caret`
		this.window.on("page-title-updated", (event) => {
			event.preventDefault()
			this.window.setTitle(title)
		})

		if (url) {
			void this.window.webContents.loadURL(url)
		} else if (file) {
			void this.window.webContents.loadFile(file)
		}
	}

	private onCanvasUrlChanged(url: string | null): void {
		if (this.closed) return
		if (url === null) {
			this.destroyCanvas()
		} else {
			this.mountCanvas(url)
		}
		void this.pushState()
	}

	private mountCanvas(url: string): void {
		if (!this.canvas) {
			this.canvas = new WebContentsView({
				webPreferences: {
					preload: this.options.preloadCanvas,
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: false,
					// The canvas renders agent-generated code. It gets no Node reach
					// and no filesystem access — only the message pipe in its preload.
					webSecurity: true,
				},
			})
			this.canvas.webContents.on("ipc-message", (_event, channel, payload) => {
				if (channel === "canvas:toHost") {
					void this.handleCanvasMessage(payload as DesignInboundMessage)
				}
			})
			this.window.contentView.addChildView(this.canvas)
		}
		this.canvasVisible = true
		void this.canvas.webContents.loadURL(url)
		this.layout()
	}

	private destroyCanvas(): void {
		if (!this.canvas) return
		this.window.contentView.removeChildView(this.canvas)
		this.canvas.webContents.close()
		this.canvas = null
	}

	/**
	 * Screenshots one design page by loading it in a hidden window rather than
	 * capturing the canvas, which would return whatever the user happens to be
	 * looking at — possibly zoomed out, scrolled, or showing a different page.
	 *
	 * A hidden `BrowserWindow`, not a detached `WebContentsView`: `capturePage`
	 * needs a real compositor surface, and a view that was never added to a window
	 * has none, so it returns an empty image no matter how long you wait.
	 * `paintWhenInitiallyHidden` keeps that surface alive while the window stays
	 * off-screen.
	 *
	 * Failures return a reason rather than null. Every caller is an agent, and
	 * "could not screenshot" with no cause is a dead end for it and for us.
	 */
	private async screenshotPage(pageId: string): Promise<ScreenshotResult> {
		const base = this.session.getUrl()
		if (!base) {
			return { ok: false, reason: "the design preview is still starting up — try again in a few seconds" }
		}

		const capture = new BrowserWindow({
			show: false,
			width: 1440,
			height: 900,
			paintWhenInitiallyHidden: true,
			webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false },
		})

		try {
			await capture.loadURL(`${base}?page=${encodeURIComponent(pageId)}&isolated=1`)
			await this.settle(capture)

			const image = await capture.webContents.capturePage()
			if (image.isEmpty()) {
				return { ok: false, reason: `page "${pageId}" rendered nothing — does it exist, and does it render at 1440x900?` }
			}
			return { ok: true, dataUrl: image.toDataURL() }
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			Logger.error(`[window] screenshot of "${pageId}" failed:`, err)
			return { ok: false, reason: `loading page "${pageId}" failed: ${detail}` }
		} finally {
			if (!capture.isDestroyed()) capture.destroy()
		}
	}

	/**
	 * Waits for the page to stop changing before capturing it.
	 *
	 * `did-finish-load` fires well before a page *looks* finished: webfonts are
	 * still swapping and images are still decoding, and a capture taken then shows
	 * fallback type and empty boxes. That reads to an agent as "the page is
	 * broken" — the most expensive possible false signal in a loop whose whole
	 * point is the agent judging its own work.
	 *
	 * Capped, because a page with an infinite animation or a never-resolving image
	 * would otherwise block forever. A late capture beats no capture.
	 */
	private async settle(capture: BrowserWindow): Promise<void> {
		await capture.webContents
			.executeJavaScript(
				`(async () => {
					const deadline = new Promise((r) => setTimeout(r, 4000))
					const ready = (async () => {
						await document.fonts.ready
						await Promise.all(
							[...document.images].map((img) =>
								img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r }),
							),
						)
						await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
					})()
					await Promise.race([ready, deadline])
				})()`,
			)
			.catch(() => {})
	}

	private layout(): void {
		if (this.closed || this.window.isDestroyed()) return
		const { width, height } = this.window.getContentBounds()

		// The chrome is the window's own webContents, so it fills the window on its
		// own. Only the canvas view needs positioning.
		if (this.canvas) {
			// Parked below the fold rather than removed, so hiding and showing the
			// canvas doesn't reload Vite or lose canvas scroll position.
			const y = this.canvasVisible ? this.chromeInsets.top : height
			this.canvas.setBounds({
				x: 0,
				y,
				width: Math.max(0, width - this.chromeInsets.right),
				height: Math.max(0, height - this.chromeInsets.top),
			})
		}
	}

	private async pushState(): Promise<void> {
		if (this.closed) return
		try {
			this.sendToChrome("project:stateChanged", await this.getState())
		} catch (err) {
			Logger.error("[window] could not push project state:", err)
		}
	}

	private onWindowClosed(): void {
		if (this.closed) return
		this.closed = true
		void this.session.stop()
		void this.mcp.stop()
		void this.healer.stop()
		void this.agent.close()
		unregisterProjectServices(this.projectPath)
		this.options.onClosed(this.projectPath)
	}
}

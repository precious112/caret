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
	readFoundationTokens,
	registerProjectServices,
	unregisterProjectServices,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { createElectronDesignHost } from "./electron-host"
import { CaretMcpServer } from "./mcp/server"
import { migrateProject } from "./migrate"
import { recordRecentProject } from "./prefs"
import { regenerateRulesFiles } from "./rules/generate"
import type { DesignInboundMessage, DesignOutboundMessage, ProjectState } from "./types"
import { WatchAndHeal } from "./watch-and-heal"

/** Fallback top-bar height, used until the chrome reports its real layout. */
const DEFAULT_CHROME_INSET = 44

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
	private session: DesignSession
	private mcp: CaretMcpServer
	private healer: WatchAndHeal
	private chromeInset = DEFAULT_CHROME_INSET
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
			}),
		})

		this.session = new DesignSession({
			workspacePath: this.projectPath,
			onUrlChanged: (url) => this.onCanvasUrlChanged(url),
		})

		this.mcp = new CaretMcpServer({
			projectPath: this.projectPath,
			onAgentConnectionChanged: () => void this.pushState(),
			screenshot: (pageId) => this.screenshotPage(pageId),
			onAgentTask: (task) => this.sendToChrome("agent:task", task),
			onInterviewPrompt: (prompt) => this.sendToChrome("interview:prompt", prompt),
		})

		this.healer = new WatchAndHeal({
			projectPath: this.projectPath,
			onTokensChanged: () => void this.pushState(),
		})

		this.loadChrome()
		this.window.on("resize", () => this.layout())
		this.window.on("closed", () => this.onWindowClosed())
		this.layout()
	}

	/** Boots Vite, the MCP endpoint and the healer. Safe to call once. */
	async start(): Promise<void> {
		await recordRecentProject(this.projectPath)

		// Runs before anything reads `.caret/`, so a project written by the VS Code
		// extension is in the current shape by the time the session starts.
		await migrateProject(this.projectPath).catch((err) => Logger.warn(`[window] migration failed: ${err}`))

		await Promise.all([this.session.start(), this.mcp.start()])
		this.healer.start()

		// Foundations reach an agent through repo rules files, not MCP — a server
		// cannot inject into a client's context. Written on open so a freshly
		// cloned project is correct before the first agent turn.
		await regenerateRulesFiles(this.projectPath).catch((err) => Logger.warn(`[window] rules generation failed: ${err}`))

		await this.pushState()
	}

	async close(): Promise<void> {
		if (this.closed) return
		this.closed = true
		await Promise.allSettled([this.session.stop(), this.mcp.stop(), this.healer.stop()])
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

	/** The chrome reporting how much vertical space its top bar occupies. */
	setChromeInset(inset: number): void {
		this.chromeInset = Math.max(0, Math.round(inset))
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
	 * Screenshots one design page by loading it in an offscreen view rather than
	 * capturing the canvas, which would return whatever the user happens to be
	 * looking at — possibly zoomed out, scrolled, or showing a different page.
	 */
	private async screenshotPage(pageId: string): Promise<string | null> {
		const base = this.session.getUrl()
		if (!base) return null

		const view = new WebContentsView({
			webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
		})
		try {
			view.setBounds({ x: 0, y: 0, width: 1440, height: 900 })
			await view.webContents.loadURL(`${base}?page=${encodeURIComponent(pageId)}&isolated=1`)
			// Give fonts and first paint a moment; the alternative is capturing a
			// blank frame, which reads as "the page is broken".
			await new Promise((resolve) => setTimeout(resolve, 600))
			const image = await view.webContents.capturePage()
			return image.isEmpty() ? null : image.toDataURL()
		} catch (err) {
			Logger.error(`[window] screenshot of "${pageId}" failed:`, err)
			return null
		} finally {
			view.webContents.close()
		}
	}

	private layout(): void {
		if (this.closed || this.window.isDestroyed()) return
		const { width, height } = this.window.getContentBounds()

		// The chrome is the window's own webContents, so it fills the window on its
		// own. Only the canvas view needs positioning.
		if (this.canvas) {
			// Parked below the fold rather than removed, so hiding and showing the
			// canvas doesn't reload Vite or lose canvas scroll position.
			const y = this.canvasVisible ? this.chromeInset : height
			this.canvas.setBounds({ x: 0, y, width, height: Math.max(0, height - this.chromeInset) })
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
		unregisterProjectServices(this.projectPath)
		this.options.onClosed(this.projectPath)
	}
}

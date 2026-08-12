/**
 * The acceptance checker's host half: render each page in a hidden window,
 * run axe-core's contrast audit plus the DOM slop-tell script, and drive the
 * enforcement loop — after every backend session that wrote pages, the checks
 * run, the results land where the canvas can show them, and errors are fed
 * back into the very session that produced them, once.
 */
import { createRequire } from "node:module"
import { BrowserWindow } from "electron"
import * as fs from "fs/promises"

import * as path from "path"

import {
	type AgentConversation,
	type CheckFinding,
	catalogFindings,
	DESIGN_CHECKS_DOM_SCRIPT,
	filterByConfig,
	formatFeedback,
	listPages,
	metaFindings,
	type PageCheckResult,
	pageIdsFromFiles,
	type RunOutcome,
	type RunRequest,
	readCatalogLock,
	readChecksConfig,
	shouldFeedBack,
	storeChecksResults,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"

/** axe-core's minified source, read once — injected into each rendered page. */
let axeSource: string | null = null
async function loadAxe(): Promise<string> {
	if (axeSource) return axeSource
	const require = createRequire(import.meta.url)
	axeSource = await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf-8")
	return axeSource
}

export interface DesignChecksOptions {
	projectPath: string
	/** The design preview's base URL, or null while Vite is still starting. */
	baseUrl(): string | null
	/** Tells the renderer/canvas results changed (the results file also HMRs the canvas). */
	onResults?(results: PageCheckResult[]): void
}

export class DesignChecksService {
	/** Activities already fed back into — one feedback turn per activity, ever. */
	private fedActivities = new Set<string>()
	private closed = false

	constructor(private readonly options: DesignChecksOptions) {}

	close(): void {
		this.closed = true
	}

	/**
	 * The enforcement hook, wired to `ConversationDeps.onTurnComplete`. Fires
	 * the checker when the turn wrote design pages, and feeds error findings
	 * back into the session — once per activity, so a model that cannot fix
	 * them does not loop forever.
	 */
	afterTurn(conversation: AgentConversation, outcome: RunOutcome, request: RunRequest): void {
		if (this.closed) return
		const pageIds = pageIdsFromFiles(outcome.filesChanged)
		if (pageIds.length === 0) return

		void (async () => {
			try {
				const results = await this.run(pageIds)
				const findings = results.flatMap((r) => r.findings)
				if (!shouldFeedBack(findings)) return

				const activity = conversation.getState().activity
				const activityId = activity?.id ?? `session-${outcome.sessionId}`
				if (this.fedActivities.has(activityId)) {
					Logger.info(`[checks] ${findings.length} finding(s) remain after feedback — surfacing on the canvas only`)
					return
				}
				// The turn that carried the feedback must not re-trigger it.
				if (request.note === FEEDBACK_NOTE) return
				this.fedActivities.add(activityId)

				Logger.info(
					`[checks] feeding ${findings.filter((f) => f.severity === "error").length} error(s) back into the session`,
				)
				await conversation.run({
					kind: activity?.kind ?? "chat",
					title: activity?.title ?? "Design checks",
					mode: "write",
					prompt: formatFeedback(findings),
					displayPrompt: "Design checks found problems in what was just written — asking the agent to fix them.",
					resumeSessionId: activity?.sessionId || outcome.sessionId || undefined,
					note: FEEDBACK_NOTE,
				})
			} catch (err) {
				Logger.warn(`[checks] post-session check failed: ${err}`)
			}
		})()
	}

	/** Runs the checks on the named pages (or every page), stores and returns results. */
	async run(pageIds?: string[]): Promise<PageCheckResult[]> {
		const config = await readChecksConfig(this.options.projectPath)
		const pages = (await listPages(this.options.projectPath)).filter((p) => !p.variantOf)
		const targets = pageIds ? pages.filter((p) => pageIds.includes(p.id)) : pages

		const results: PageCheckResult[] = []
		const rendererUp = this.options.baseUrl() !== null
		const lock = await readCatalogLock(this.options.projectPath)
		for (const page of targets) {
			const findings: CheckFinding[] = [...metaFindings(page)]
			// Catalog restraint findings are computed from SOURCE — a budget breach
			// must flag even when the renderer is down.
			const pageSource = await fs
				.readFile(path.join(this.options.projectPath, ".caret", "pages", page.id, "index.tsx"), "utf-8")
				.catch(() => "")
			if (pageSource) findings.push(...catalogFindings(pageSource, page.id, lock))
			if (rendererUp) {
				const rendered = await this.checkRendered(page.id).catch((err) => {
					Logger.warn(`[checks] could not render ${page.id}: ${err}`)
					return [] as CheckFinding[]
				})
				findings.push(...rendered)
			} else {
				// Saying so beats a silent half-answer: a clean result that only ran
				// the metadata checks would read as "the page renders fine".
				findings.push({
					check: "render-unavailable",
					severity: "info",
					message: "the design preview is still starting — only the metadata checks ran; run again shortly",
					pageId: page.id,
				})
			}
			results.push({ pageId: page.id, findings: filterByConfig(findings, config), at: new Date().toISOString() })
		}

		await storeChecksResults(
			this.options.projectPath,
			results,
			pages.map((p) => p.id),
		)
		this.options.onResults?.(results)
		return results
	}

	/** One page: isolated render, axe contrast audit, DOM slop-tell script. */
	private async checkRendered(pageId: string): Promise<CheckFinding[]> {
		const base = this.options.baseUrl()
		if (!base) return []

		const window = new BrowserWindow({
			show: false,
			width: 1440,
			height: 900,
			paintWhenInitiallyHidden: true,
			webPreferences: { contextIsolation: true, nodeIntegration: false },
		})

		try {
			await window.loadURL(`${base}?page=${encodeURIComponent(pageId)}&isolated=1`)
			// Same settle contract as the screenshot path: fonts and images decide
			// what the checks see, and a check against fallback type lies.
			await window.webContents
				.executeJavaScript(
					`(async () => {
						const deadline = new Promise((r) => setTimeout(r, 4000))
						const ready = (async () => {
							await document.fonts.ready
							await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r })))
							await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
						})()
						await Promise.race([ready, deadline])
					})()`,
				)
				.catch(() => {})

			const findings: CheckFinding[] = []

			const domFindings = (await window.webContents.executeJavaScript(DESIGN_CHECKS_DOM_SCRIPT).catch((err) => {
				Logger.warn(`[checks] DOM script failed on ${pageId}: ${err}`)
				return []
			})) as Array<Omit<CheckFinding, "pageId">>
			for (const finding of domFindings) {
				findings.push({ ...finding, pageId })
			}

			try {
				await window.webContents.executeJavaScript(await loadAxe())
				const contrast = (await window.webContents.executeJavaScript(
					`axe.run(document, { runOnly: ["color-contrast"], resultTypes: ["violations"] }).then((r) =>
						r.violations.flatMap((v) => v.nodes.slice(0, 5).map((n) => n.failureSummary || v.help)))`,
				)) as string[]
				for (const message of contrast.slice(0, 5)) {
					findings.push({ check: "contrast", severity: "error", message, pageId })
				}
			} catch (err) {
				Logger.warn(`[checks] axe run failed on ${pageId}: ${err}`)
			}

			return findings
		} finally {
			if (!window.isDestroyed()) window.destroy()
		}
	}
}

const FEEDBACK_NOTE = "Design checks"

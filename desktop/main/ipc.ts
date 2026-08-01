/**
 * The `ipcMain` half of the renderer contract.
 *
 * Every handler is keyed to a project path rather than to "the current project",
 * because several project windows can be open and each has its own renderer.
 * A handler for a project that is not open returns null rather than falling back
 * to whichever one happens to be focused.
 */
import { dialog, ipcMain } from "electron"

import {
	completeSync,
	type FoundationTokens,
	fullLibrary,
	generateTokenScale,
	listPages,
	readFoundationTokens,
	rollbackSync,
	searchGoogleFonts,
	validateFoundationTokens,
	writeFoundationTokens,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { buildAgentClientConfigs } from "./agent-configs"
import { resolveNotification } from "./electron-host"
import { answerInterviewPrompt } from "./interview"
import { forgetRecentProject, getPrefs, setPrefs } from "./prefs"
import { regenerateRulesFiles } from "./rules/generate"
import type { DesignInboundMessage } from "./types"
import type { WindowManager } from "./window-manager"

export function registerIpcHandlers(windows: WindowManager): void {
	// ── projects ──────────────────────────────────────────────────────────────

	ipcMain.handle("project:pickFolder", async () => {
		const result = await dialog.showOpenDialog({
			title: "Open a project",
			properties: ["openDirectory", "createDirectory"],
			buttonLabel: "Open",
		})
		return result.canceled ? null : (result.filePaths[0] ?? null)
	})

	ipcMain.handle("project:open", async (_event, projectPath: string) => {
		const window = await windows.open(projectPath)
		return window ? window.getState() : null
	})

	ipcMain.handle("project:close", async (_event, projectPath: string) => {
		await windows.close(projectPath)
	})

	ipcMain.handle("project:recents", () => windows.listRecents())

	ipcMain.handle("project:forgetRecent", async (_event, projectPath: string) => {
		await forgetRecentProject(projectPath)
	})

	ipcMain.handle("project:state", async (_event, projectPath: string) => {
		const window = windows.get(projectPath)
		return window ? window.getState() : null
	})

	// ── tokens and fonts ──────────────────────────────────────────────────────

	ipcMain.handle("tokens:read", (_event, projectPath: string) => readFoundationTokens(projectPath))

	ipcMain.handle("tokens:write", async (_event, projectPath: string, tokens: FoundationTokens) => {
		if (!validateFoundationTokens(tokens)) {
			return { ok: false, error: "Those tokens are missing required fields (vibe, color, typography, spacing, radius)." }
		}
		try {
			await writeFoundationTokens(projectPath, tokens)
			// Rules files carry the foundation into every agent session, so they are
			// stale the instant a token changes.
			await regenerateRulesFiles(projectPath)
			return { ok: true }
		} catch (err) {
			Logger.error("[ipc] tokens:write failed:", err)
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

	ipcMain.handle(
		"tokens:generateScale",
		(_event, type: "color" | "typography" | "spacing" | "radius", seed: string, options?: Record<string, unknown>) =>
			generateTokenScale(type, seed, options),
	)

	ipcMain.handle("fonts:search", (_event, query: string) => searchGoogleFonts(query, { apiKey: getPrefs().googleFontsApiKey }))

	// ── pages ─────────────────────────────────────────────────────────────────

	ipcMain.handle("pages:list", (_event, projectPath: string) => listPages(projectPath))

	// ── sync ──────────────────────────────────────────────────────────────────

	ipcMain.handle("sync:now", async (_event, projectPath: string) => {
		const window = windows.get(projectPath)
		if (!window) return { status: "error", message: "That project isn't open." }
		await window.requestSync()
		return { status: "ok", message: "" }
	})

	ipcMain.handle("sync:rollback", (_event, projectPath: string) => rollbackSync(projectPath))

	ipcMain.handle("sync:markSynced", async (_event, projectPath: string) => {
		const outcome = await completeSync(projectPath)
		const message =
			outcome === "advanced"
				? "Marked as synced. The next sync will only report changes made from here."
				: outcome === "already-applied"
					? "This sync was already recorded."
					: "There's no sync waiting to be recorded."
		return { status: outcome, message }
	})

	// ── agent ─────────────────────────────────────────────────────────────────

	ipcMain.handle("agent:clientConfigs", (_event, projectPath: string) => {
		const window = windows.get(projectPath)
		if (!window) return []
		const mcp = window.getMcpServer()
		return buildAgentClientConfigs(projectPath, mcp.getUrl(), mcp.getToken())
	})

	// ── preferences ───────────────────────────────────────────────────────────

	ipcMain.handle("prefs:get", () => getPrefs())

	ipcMain.handle("prefs:set", async (_event, patch: Record<string, unknown>) => {
		await setPrefs(patch)
	})

	// ── canvas + chrome plumbing ──────────────────────────────────────────────

	ipcMain.handle("canvas:message", async (_event, projectPath: string, message: DesignInboundMessage) => {
		await windows.get(projectPath)?.handleCanvasMessage(message)
	})

	ipcMain.handle("canvas:setBounds", (_event, projectPath: string, inset: number) => {
		windows.get(projectPath)?.setChromeInset(inset)
	})

	ipcMain.handle("canvas:setVisible", (_event, projectPath: string, visible: boolean) => {
		windows.get(projectPath)?.setCanvasVisible(visible)
	})

	ipcMain.handle("notification:respond", (_event, id: string, action: string | null) => {
		resolveNotification(id, action)
	})

	ipcMain.handle("interview:respond", (_event, id: string, answer: string | null) => {
		answerInterviewPrompt(id, answer)
	})

	ipcMain.handle("interview:library", () => fullLibrary())
}

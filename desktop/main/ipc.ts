/**
 * The `ipcMain` half of the renderer contract.
 *
 * Every handler is keyed to a project path rather than to "the current project",
 * because several project windows can be open and each has its own renderer.
 * A handler for a project that is not open returns null rather than falling back
 * to whichever one happens to be focused.
 */
import { dialog, ipcMain } from "electron"
import * as fs from "fs/promises"
import * as path from "path"

import {
	ASSET_TYPES,
	assetsDirectory,
	assetUrl,
	type BackendId,
	completeSync,
	describeAsset,
	type FoundationTokens,
	findAsset,
	fullLibrary,
	generateTokenScale,
	getBackend,
	LARGE_ASSET_BYTES,
	listPages,
	probeBackends,
	readAssetIndex,
	readFoundationTokens,
	reindexAssets,
	retagAsset,
	rollbackSync,
	searchGoogleFonts,
	validateFoundationTokens,
	writeFoundationTokens,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { buildAgentClientConfigs } from "./agent-configs"
import { resolveNotification } from "./electron-host"
import { answerInterviewPrompt, currentPrompt } from "./interview"
import { forgetRecentProject, getPrefs, setPref, setPrefs } from "./prefs"
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

	// ── assets ────────────────────────────────────────────────────────────────

	ipcMain.handle("assets:list", async (_event, projectPath: string) => {
		const index = await readAssetIndex(projectPath)
		return index.assets.map((asset) => ({
			tag: asset.tag,
			file: asset.file,
			url: assetUrl(asset),
			kind: asset.kind,
			mime: asset.mime,
			width: asset.width,
			height: asset.height,
			bytes: asset.bytes,
			alt: asset.alt,
			description: asset.description,
			origin: asset.origin.type,
			addedAt: asset.addedAt,
		}))
	})

	ipcMain.handle("assets:pickFiles", async () => {
		const result = await dialog.showOpenDialog({
			title: "Add assets",
			properties: ["openFile", "multiSelections"],
			filters: [{ name: "Assets", extensions: Object.keys(ASSET_TYPES).map((extension) => extension.slice(1)) }],
		})
		return result.canceled ? [] : result.filePaths
	})

	/**
	 * Copies files in and lets watch-and-heal index them.
	 *
	 * Copying rather than referencing in place: an asset that lives outside the
	 * repo is not versioned with the design and breaks for the next person to
	 * clone it, which defeats the reason `.caret/` exists.
	 */
	ipcMain.handle("assets:add", async (_event, projectPath: string, sourcePaths: string[]) => {
		const directory = assetsDirectory(projectPath)
		await fs.mkdir(directory, { recursive: true })

		const added: string[] = []
		const rejected: Array<{ file: string; reason: string }> = []

		for (const source of sourcePaths) {
			const name = path.basename(source)
			const extension = path.extname(name).toLowerCase()

			if (!ASSET_TYPES[extension]) {
				rejected.push({ file: name, reason: `${extension || "files with no extension"} is not a supported asset type` })
				continue
			}

			try {
				const stat = await fs.stat(source)
				if (stat.size > LARGE_ASSET_BYTES) {
					// Assets live in git with the design. A warning rather than a
					// refusal: it is the user's repository and their call.
					Logger.warn(`[assets] ${name} is ${Math.round(stat.size / 1024 / 1024)}MB — consider Git LFS`)
				}

				// Never silently overwrite: two different photographs called
				// "screenshot.png" is the common case, not the rare one.
				const target = await freeName(directory, name)
				await fs.copyFile(source, path.join(directory, target))
				added.push(target)
			} catch (err) {
				rejected.push({ file: name, reason: err instanceof Error ? err.message : String(err) })
			}
		}

		await reindexAssets(projectPath).catch((err) => Logger.warn(`[assets] reindex after add failed: ${err}`))
		return { added, rejected }
	})

	ipcMain.handle("assets:retag", async (_event, projectPath: string, from: string, to: string) => {
		const result = await retagAsset(projectPath, from, to)
		if (result.ok) await regenerateRulesFiles(projectPath).catch(() => {})
		return result.ok ? { ok: true } : { ok: false, error: result.reason }
	})

	ipcMain.handle(
		"assets:describe",
		async (_event, projectPath: string, tag: string, fields: { alt?: string; description?: string }) => {
			const result = await describeAsset(projectPath, tag, fields)
			if (result.ok) await regenerateRulesFiles(projectPath).catch(() => {})
			return result.ok ? { ok: true } : { ok: false, error: result.reason }
		},
	)

	ipcMain.handle("assets:remove", async (_event, projectPath: string, tag: string) => {
		const index = await readAssetIndex(projectPath)
		const entry = findAsset(index, tag)
		if (!entry) return { ok: false, error: `No asset tagged "${tag}".` }

		try {
			await fs.rm(path.join(assetsDirectory(projectPath), entry.file))
			await reindexAssets(projectPath)
			await regenerateRulesFiles(projectPath).catch(() => {})
			return { ok: true }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	})

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

	// ── the coding backend ────────────────────────────────────────────────────

	ipcMain.handle("agent:state", (_event, projectPath: string) => {
		return windows.get(projectPath)?.getAgent().conversation.getState() ?? null
	})

	/**
	 * Fire-and-forget: a turn runs for minutes and streams its progress over
	 * `agent:state`. Making the renderer await it would hang the invoke channel
	 * for the whole turn and give it nothing the event stream has not already
	 * delivered.
	 */
	ipcMain.handle("agent:send", (_event, projectPath: string, text: string) => {
		const agent = windows.get(projectPath)?.getAgent()
		if (!agent) return
		void agent.conversation.sendMessage(text).catch((err) => {
			agent.conversation.note(err instanceof Error ? err.message : String(err))
		})
	})

	ipcMain.handle("agent:abort", async (_event, projectPath: string) => {
		await windows.get(projectPath)?.getAgent().conversation.abort()
	})

	ipcMain.handle(
		"agent:permission",
		async (_event, projectPath: string, requestId: string, decision: "allow" | "deny" | "allow-always") => {
			await windows.get(projectPath)?.getAgent().conversation.respondToPermission(requestId, decision)
		},
	)

	ipcMain.handle("agent:approval", (_event, projectPath: string, id: string, ok: boolean) => {
		windows.get(projectPath)?.getAgent().conversation.respondToApproval(id, ok)
	})

	ipcMain.handle("agent:reset", (_event, projectPath: string) => {
		windows.get(projectPath)?.getAgent().conversation.reset()
	})

	ipcMain.handle("agent:backends", () => probeBackends())

	ipcMain.handle("agent:selectBackend", async (_event, id: BackendId | null) => {
		await setPref("backendId", id)
		// Every open project re-resolves, so a backend chosen in one window stops
		// the other windows refusing too.
		await Promise.all(windows.list().map((window) => window.getAgent().conversation.refreshBackend()))
	})

	ipcMain.handle("agent:sessions", async (_event, projectPath: string) => {
		const id = getPrefs().backendId
		if (!id) return []
		const backend = getBackend(id)
		return (await backend.listSessions?.(projectPath).catch(() => [])) ?? []
	})

	ipcMain.handle("agent:replay", async (_event, projectPath: string, sessionId: string) => {
		return (await windows.get(projectPath)?.getAgent().conversation.replay(sessionId)) ?? false
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

	ipcMain.handle("canvas:setBounds", (_event, projectPath: string, insets: { top: number; right: number }) => {
		windows.get(projectPath)?.setChromeInsets(insets)
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

	ipcMain.handle("interview:pending", () => currentPrompt())
}

/**
 * A filename that is free in `directory`, suffixing `-2`, `-3`, … as needed.
 *
 * Two unrelated photographs both called `screenshot.png` is the common case when
 * dragging files in, and silently replacing the first one loses an asset a page
 * may already reference.
 */
async function freeName(directory: string, name: string): Promise<string> {
	const extension = path.extname(name)
	const base = name.slice(0, name.length - extension.length)

	for (let suffix = 1; suffix < 1000; suffix++) {
		const candidate = suffix === 1 ? name : `${base}-${suffix}${extension}`
		try {
			await fs.access(path.join(directory, candidate))
		} catch {
			return candidate
		}
	}
	throw new Error(`Could not find a free filename for "${name}".`)
}

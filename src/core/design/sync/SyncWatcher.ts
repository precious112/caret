/**
 * Watches git HEAD and offers a sync when unsynced design commits land.
 *
 * `.git/logs/HEAD` is appended to on every commit, checkout and reset, so
 * watching that one file fires exactly when HEAD moves and never otherwise.
 * This is a soft signal — it prompts, it never blocks and never syncs on its own.
 */

import chokidar, { type FSWatcher } from "chokidar"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import { getLatestGitCommitHash, hasDesignChangesSince } from "@/utils/git"
import { caretDirectoryExists } from "../scaffold"
import { hostFor } from "../services"
import { runSync, type SyncResult } from "./sync-orchestrator"
import { readSyncState } from "./sync-state"

const DEBOUNCE_MS = 1500
const SYNC_NOW = "Sync now"

/**
 * Runs a sync, surfacing the preflight's fixable states as a confirm prompt.
 *
 * Shared by the canvas toolbar button, the menu command and the watcher, so
 * "sync" means the same thing however it was triggered.
 */
export async function runSyncInteractive(cwd: string): Promise<SyncResult> {
	let result = await runSync(cwd)

	if ((result.status === "needs-git-setup" || result.status === "needs-design-commit") && result.fixLabel) {
		const choice = await hostFor(cwd).notify("warn", result.message, [result.fixLabel])
		if (choice !== result.fixLabel) {
			return result // user declined the fix
		}
		result = await runSync(cwd, { autoFix: true })
	}

	const level = result.status === "git-not-installed" || result.status === "no-agent" ? "error" : "info"
	await hostFor(cwd).notify(level, result.message)
	return result
}

export interface SyncWatcher {
	dispose(): Promise<void>
}

export function createSyncWatcher(cwd: string): SyncWatcher {
	const watcher: FSWatcher = chokidar.watch(path.join(cwd, ".git", "logs", "HEAD"), {
		ignoreInitial: true,
		// The file is appended to by git in one shot; a short stability window is
		// enough and keeps the first prompt from lagging behind the commit.
		awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
	})

	let timer: NodeJS.Timeout | undefined
	// Don't re-prompt for a HEAD we've already offered (or that's mid-sync).
	let lastHandledCommit: string | null = null

	const onHeadMoved = () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(async () => {
			try {
				if (!(await caretDirectoryExists(cwd))) return

				const head = await getLatestGitCommitHash(cwd)
				if (!head || head === lastHandledCommit) return

				const { lastSyncedCommit } = await readSyncState(cwd)
				if (lastSyncedCommit === head) return // already in sync
				if (!(await hasDesignChangesSince(cwd, lastSyncedCommit))) return // HEAD moved, design didn't

				lastHandledCommit = head
				const choice = await hostFor(cwd).notify("info", "Design changes detected — sync them into the app?", [SYNC_NOW])
				if (choice === SYNC_NOW) {
					await runSyncInteractive(cwd)
				}
			} catch (error) {
				Logger.error("[sync] watcher check failed:", error)
			}
		}, DEBOUNCE_MS)
	}

	watcher.on("add", onHeadMoved)
	watcher.on("change", onHeadMoved)

	return {
		async dispose() {
			if (timer) clearTimeout(timer)
			await watcher.close()
		},
	}
}

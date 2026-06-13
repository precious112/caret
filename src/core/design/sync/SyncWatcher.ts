import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { getLatestGitCommitHash, hasDesignChangesSince } from "@/utils/git"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from "../../controller"
import { caretDirectoryExists } from "../scaffold"
import { runSync } from "./sync-orchestrator"
import { readSyncState } from "./sync-state"

const DEBOUNCE_MS = 1500

/**
 * Runs a sync with native confirm dialogs for the git-state fixes. Shared by the
 * `caret.syncNow` command (and thus the canvas toolbar button) and the watcher.
 */
export async function runSyncInteractive(controller: Controller): Promise<void> {
	let result = await runSync(controller)
	if ((result.status === "needs-git-setup" || result.status === "needs-design-commit") && result.fixLabel) {
		const choice = await vscode.window.showWarningMessage(result.message, result.fixLabel)
		if (choice !== result.fixLabel) {
			return // user declined the fix
		}
		result = await runSync(controller, { autoFix: true })
	}
	if (result.status === "git-not-installed") {
		vscode.window.showErrorMessage(result.message)
	} else {
		vscode.window.showInformationMessage(result.message)
	}
}

/**
 * Watches git HEAD and, when new unsynced `.caret/` commits land, offers a
 * non-blocking "Sync now" prompt. Soft signal only — never blocks the user.
 *
 * `.git/logs/HEAD` is appended to on every commit / checkout / reset, so a
 * FileSystemWatcher on it fires exactly when HEAD moves.
 */
export function createSyncWatcher(controller: Controller): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher("**/.git/logs/HEAD")
	let timer: NodeJS.Timeout | undefined
	// Don't re-prompt for a HEAD we've already offered (or that's mid-sync).
	let lastHandledCommit: string | null = null

	const onHeadMoved = () => {
		if (timer) {
			clearTimeout(timer)
		}
		timer = setTimeout(async () => {
			try {
				const cwd = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
				if (!(await caretDirectoryExists(cwd))) {
					return
				}

				const head = await getLatestGitCommitHash(cwd)
				if (!head || head === lastHandledCommit) {
					return
				}

				const { lastSyncedCommit } = await readSyncState(cwd)
				if (lastSyncedCommit === head) {
					return // already in sync
				}
				if (!(await hasDesignChangesSince(cwd, lastSyncedCommit))) {
					return // HEAD moved but the design layer didn't change
				}

				lastHandledCommit = head
				const choice = await vscode.window.showInformationMessage(
					"Design changes detected — sync them into the app?",
					"Sync now",
				)
				if (choice === "Sync now") {
					await runSyncInteractive(controller)
				}
			} catch (error) {
				Logger.error("[sync] watcher check failed:", error)
			}
		}, DEBOUNCE_MS)
	}

	watcher.onDidCreate(onHeadMoved)
	watcher.onDidChange(onHeadMoved)

	return new vscode.Disposable(() => {
		if (timer) {
			clearTimeout(timer)
		}
		watcher.dispose()
	})
}

import { Logger } from "@/shared/services/Logger"
import {
	assessSyncGitState,
	getDesignLayerChangedFiles,
	getDesignLayerLog,
	getLatestGitCommitHash,
	hasDesignChangesSince,
} from "@/utils/git"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from "../../controller"
import { caretDirectoryExists } from "../scaffold"
import { registerPendingSync } from "./sync-completion"
import { commitDesignLayer, ensureGitRepo } from "./sync-git"
import { buildSyncPrompt } from "./sync-prompt"
import { readSyncState } from "./sync-state"

export type SyncStatus =
	| "started"
	| "up-to-date"
	| "no-caret-dir"
	| "git-not-installed"
	| "needs-git-setup"
	| "needs-design-commit"

export interface SyncResult {
	status: SyncStatus
	message: string
	/** Label for the one-click fix, present on fixable statuses (re-run with { autoFix: true }). */
	fixLabel?: string
	/** Number of changed design files handed to the AI. Present when status === "started". */
	changedCount?: number
}

export interface SyncOptions {
	/** When true, perform the git fix (init/commit) the preflight would otherwise prompt for. */
	autoFix?: boolean
}

/**
 * Runs a design→app sync as a specialized plan-mode task: gather the design-layer
 * diff since the last sync, budget it (token guardrails), build the prompt, force
 * plan mode, and hand it to the AI. The bookmark in sync-state.json is advanced by
 * the AI as the final step of the sync (instructed in the prompt).
 */
export async function runSync(controller: Controller, opts: SyncOptions = {}): Promise<SyncResult> {
	const cwd = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))

	if (!(await caretDirectoryExists(cwd))) {
		return { status: "no-caret-dir", message: "No .caret/ design layer in this workspace — nothing to sync." }
	}

	// Preflight: get the design layer into a committed state (the bookmark is a
	// commit hash). Each gap is either auto-fixed (after a confirmed re-run with
	// autoFix) or surfaced as a fixable status. All Caret commits are .caret/-scoped.
	const gitState = await assessSyncGitState(cwd)
	switch (gitState) {
		case "not-installed":
			return {
				status: "git-not-installed",
				message: "Git isn't installed. Sync needs git to track the design layer — install git and try again.",
			}
		case "no-repo":
		case "no-commits":
			if (opts.autoFix) {
				await ensureGitRepo(cwd)
				await commitDesignLayer(cwd, "chore(caret): initialize design layer")
			} else {
				return {
					status: "needs-git-setup",
					message:
						"This project needs a git repo with the design layer committed before syncing. Initialize git and commit .caret/ now?",
					fixLabel: "Initialize & commit .caret/",
				}
			}
			break
		case "dirty-design":
			if (opts.autoFix) {
				await commitDesignLayer(cwd, "design: sync checkpoint")
			} else {
				return {
					status: "needs-design-commit",
					message: "You have uncommitted design changes. Commit them (only the .caret/ folder) before syncing?",
					fixLabel: "Commit .caret/ changes",
				}
			}
			break
		case "ready":
			break
	}

	const { lastSyncedCommit } = await readSyncState(cwd)

	// Up-to-date is gated on actual design changes, NOT commit-hash equality:
	// an unrelated app commit moves HEAD but doesn't change the design.
	if (!(await hasDesignChangesSince(cwd, lastSyncedCommit))) {
		return { status: "up-to-date", message: "Design layer is already in sync with the app." }
	}

	const targetCommit = await getLatestGitCommitHash(cwd)
	if (!targetCommit) {
		// Defensive: assessSyncGitState already guaranteed commits exist.
		return { status: "up-to-date", message: "Design layer is already in sync with the app." }
	}

	// Net cumulative changed-files worklist (no file content) — the AI reads the
	// current `.caret/` + app sources itself. See buildSyncPrompt.
	const changedFiles = await getDesignLayerChangedFiles(cwd, lastSyncedCommit)
	const intentLog = await getDesignLayerLog(cwd, lastSyncedCommit)
	const isFirstSync = lastSyncedCommit === null

	const prompt = await buildSyncPrompt(cwd, { changedFiles, isFirstSync, intentLog })

	// Force plan mode AND Code context — sync produces a reviewable plan that edits
	// app code, so the design/code toggle must reflect Code, not Design. Mirrors the
	// manual toggle handler in updateSettings.ts. initTask posts state afterward, so
	// both flips reach the webview in one update.
	controller.stateManager.setGlobalState("mode", "plan")
	controller.stateManager.setGlobalState("designContext", "implementation")
	const { setDesignMode } = await import("@/core/design/DesignMode")
	setDesignMode(false)
	const taskId = await controller.initTask(prompt)

	// Capture a pre-edit checkpoint so a half-done sync can be rolled back (app +
	// bookmark, since .caret/sync-state.json is inside the checkpoint snapshot).
	let preSyncCheckpoint: string | undefined
	try {
		preSyncCheckpoint = await controller.task?.checkpointManager?.commit()
	} catch (err) {
		Logger.warn(`[sync] could not capture pre-sync checkpoint (rollback may be unavailable): ${err}`)
	}

	// Register the sync so the bookmark advances deterministically (in our code)
	// when the user APPLIES it (plan→Act) — never via instructing the model to write
	// the file. Persisted to disk so it survives an extension reload mid-sync.
	await registerPendingSync(cwd, {
		taskId,
		commit: targetCommit,
		previousBookmark: lastSyncedCommit,
		preSyncCheckpoint: typeof preSyncCheckpoint === "string" ? preSyncCheckpoint : undefined,
	})

	Logger.info(`[sync] Started: ${changedFiles.length} changed design file(s), target ${targetCommit.slice(0, 8)}`)

	const message =
		changedFiles.length === 0
			? "Syncing design → app (reconciling full design state)."
			: `Syncing design → app: ${changedFiles.length} changed design file(s).`

	return {
		status: "started",
		message,
		changedCount: changedFiles.length,
	}
}

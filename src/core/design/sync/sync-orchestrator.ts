import { randomUUID } from "crypto"

import { Logger } from "@/shared/services/Logger"
import {
	assessSyncGitState,
	getDesignLayerChangedFiles,
	getDesignLayerLog,
	getLatestGitCommitHash,
	hasDesignChangesSince,
} from "@/utils/git"
import { NoAgentConnectedError } from "../agent/bridge"
import { caretDirectoryExists } from "../scaffold"
import { bridgeFor } from "../services"
import { clearPendingSync, registerPendingSync } from "./sync-completion"
import { commitDesignLayer, ensureGitRepo } from "./sync-git"
import { buildSyncPrompt } from "./sync-prompt"
import { captureSyncSnapshot } from "./sync-snapshot"
import { readSyncState } from "./sync-state"

export type SyncStatus =
	| "started"
	| "up-to-date"
	| "no-caret-dir"
	| "no-agent"
	| "git-not-installed"
	| "needs-git-setup"
	| "needs-design-commit"

export interface SyncResult {
	status: SyncStatus
	message: string
	/** Label for the one-click fix, present on fixable statuses (re-run with { autoFix: true }). */
	fixLabel?: string
	/** Number of changed design files handed to the agent. Present when status === "started". */
	changedCount?: number
	/** Id of the sync just started, for `complete_sync`. Present when status === "started". */
	syncId?: string
}

export interface SyncOptions {
	/** When true, perform the git fix (init/commit) the preflight would otherwise prompt for. */
	autoFix?: boolean
}

/**
 * Runs a design→app sync: get the design layer into a committed state, compute
 * the net changed-files worklist since the last sync, capture a rollback point,
 * and hand the prompt to whichever agent is connected.
 *
 * The preflight is unchanged from V1 — it was the reliable part. What changed is
 * the far end: instead of `controller.initTask(prompt)` starting a local
 * plan-mode task, the prompt goes out over the {@link AgentBridge} and Caret
 * waits for a completion signal it does not control (see `sync-completion.ts`).
 */
export async function runSync(cwd: string, opts: SyncOptions = {}): Promise<SyncResult> {
	if (!(await caretDirectoryExists(cwd))) {
		return { status: "no-caret-dir", message: "No .caret/ design layer in this project — nothing to sync." }
	}

	// Fail before doing any git work if there is nobody to hand the sync to.
	if (!bridgeFor(cwd).connected()) {
		return { status: "no-agent", message: new NoAgentConnectedError("sync").message }
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

	// Net cumulative changed-files worklist (no file content) — the agent reads the
	// current `.caret/` + app sources itself. See buildSyncPrompt.
	const changedFiles = await getDesignLayerChangedFiles(cwd, lastSyncedCommit)
	const intentLog = await getDesignLayerLog(cwd, lastSyncedCommit)
	const isFirstSync = lastSyncedCommit === null

	const syncId = randomUUID()
	const prompt = await buildSyncPrompt(cwd, { changedFiles, isFirstSync, intentLog, syncId })

	// Capture the rollback point BEFORE the agent touches anything. Ordered this
	// way deliberately: an agent that starts editing the instant it receives the
	// prompt must not race the snapshot.
	const preSyncSnapshot = (await captureSyncSnapshot(cwd)) ?? undefined

	await registerPendingSync(cwd, {
		syncId,
		commit: targetCommit,
		previousBookmark: lastSyncedCommit,
		preSyncSnapshot,
	})

	try {
		await bridgeFor(cwd).request({
			kind: "sync",
			prompt,
			context: { syncId, changedFiles, targetCommit },
		})
	} catch (err) {
		// The agent went away between the connected() check and the request.
		// Drop the pending record so a stale sync can't be completed later.
		await clearPendingSync(cwd)
		const message = err instanceof Error ? err.message : String(err)
		Logger.error(`[sync] agent refused the sync: ${message}`)
		return { status: "no-agent", message }
	}

	Logger.info(`[sync] Started: ${changedFiles.length} changed design file(s), target ${targetCommit.slice(0, 8)}`)

	return {
		status: "started",
		syncId,
		changedCount: changedFiles.length,
		message:
			changedFiles.length === 0
				? "Syncing design → app (reconciling full design state)."
				: `Syncing design → app: ${changedFiles.length} changed design file(s).`,
	}
}

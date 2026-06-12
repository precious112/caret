import { buildApiHandler } from "@core/api"
import { getContextWindowInfo } from "@core/context/context-management/context-window-utils"
import { Logger } from "@/shared/services/Logger"
import { getDesignLayerDiffSince, getLatestGitCommitHash } from "@/utils/git"
import { getCwd, getDesktopDir } from "@/utils/path"
import type { Controller } from "../../controller"
import { caretDirectoryExists } from "../scaffold"
import { buildBudgetedDiff } from "./sync-budget"
import { registerPendingSync } from "./sync-completion"
import { buildSyncPrompt } from "./sync-prompt"
import { readSyncState } from "./sync-state"

// Fraction of the model's safe context budget we allow the sync opening message
// to occupy. The rest is reserved for the AI's own file reads + reasoning +
// output during planning (Layer 0). A small message + lazy reads keeps a 2-page
// sync and a 200-page sync roughly the same opening size.
const DIFF_BUDGET_FRACTION = 0.35

export type SyncStatus = "started" | "up-to-date" | "no-caret-dir" | "no-git"

export interface SyncResult {
	status: SyncStatus
	message: string
	/** Present when status === "started". */
	diffStats?: { shown: number; total: number; summarized: number }
	/** Present when status === "started" and some files were summarized (Layer 2 cue). */
	largeSync?: boolean
}

/**
 * Runs a design→app sync as a specialized plan-mode task: gather the design-layer
 * diff since the last sync, budget it (token guardrails), build the prompt, force
 * plan mode, and hand it to the AI. The bookmark in sync-state.json is advanced by
 * the AI as the final step of the sync (instructed in the prompt).
 */
export async function runSync(controller: Controller): Promise<SyncResult> {
	const cwd = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))

	if (!(await caretDirectoryExists(cwd))) {
		return { status: "no-caret-dir", message: "No .caret/ design layer in this workspace — nothing to sync." }
	}

	const targetCommit = await getLatestGitCommitHash(cwd)
	if (!targetCommit) {
		return {
			status: "no-git",
			message: "Sync needs a git repository with at least one commit (the design layer must be version-controlled).",
		}
	}

	const { lastSyncedCommit } = await readSyncState(cwd)
	if (lastSyncedCommit === targetCommit) {
		return { status: "up-to-date", message: "Design layer is already in sync with the app." }
	}

	const diff = await getDesignLayerDiffSince(cwd, lastSyncedCommit)

	// Layer 0 — size the diff section from the model's real context window so it
	// auto-scales (tight on 200k, generous on 1M) with no hardcoding.
	const api = buildApiHandler(controller.stateManager.getApiConfiguration(), "plan")
	const { maxAllowedSize } = getContextWindowInfo(api)
	const diffBudget = Math.floor(maxAllowedSize * DIFF_BUDGET_FRACTION)

	const budgetedDiff = buildBudgetedDiff(diff, diffBudget)
	const prompt = await buildSyncPrompt(cwd, budgetedDiff)

	// Force plan mode — sync always produces a reviewable plan before any app edits.
	controller.stateManager.setGlobalState("mode", "plan")
	const taskId = await controller.initTask(prompt)

	// Register the sync so the bookmark advances deterministically (in our code)
	// when THIS task completes — never via instructing the model to write the file.
	registerPendingSync(taskId, cwd, targetCommit)

	Logger.info(
		`[sync] Started: ${budgetedDiff.shown}/${budgetedDiff.total} diffs inlined, ${budgetedDiff.summarized} summarized, target ${targetCommit.slice(0, 8)}`,
	)

	const largeSync = budgetedDiff.summarized > 0
	const message =
		budgetedDiff.total === 0
			? "Syncing design → app (no file-level design changes; AI will reconcile full state)."
			: `Syncing design → app: ${budgetedDiff.total} changed file(s)` +
				(largeSync
					? `, ${budgetedDiff.shown} diffs inlined, ${budgetedDiff.summarized} summarized (AI will read those directly).`
					: ".")

	return {
		status: "started",
		message,
		diffStats: { shown: budgetedDiff.shown, total: budgetedDiff.total, summarized: budgetedDiff.summarized },
		largeSync,
	}
}

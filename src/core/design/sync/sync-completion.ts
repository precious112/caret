import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { hasUncommittedDesignChanges } from "@/utils/git"
import { isDesignModeActive } from "../scaffold"
import { commitDesignLayer, discardDesignLayerChanges } from "./sync-git"
import { advanceSyncState } from "./sync-state"

/**
 * In-memory registry of in-flight syncs, keyed by the task id that is performing
 * the sync. The bookmark in `.caret/sync-state.json` is advanced by OUR code
 * (here) when that task completes successfully — never by instructing the model
 * to write the file. This makes the design→app pipeline's source-of-truth
 * deterministic: a missed/incorrect model write can't silently re-sync stale
 * changes or skip un-synced ones.
 *
 * Keyed by taskId (globally unique), so it is safe even across multiple
 * controllers/instances. If the extension restarts mid-sync the entry is lost —
 * the safe failure direction, since the next sync simply re-diffs from the
 * unchanged bookmark (redundant work, never skipped changes).
 */
interface PendingSync {
	cwd: string
	/** The design HEAD this sync is reconciling the app up to. */
	commit: string
}

const pending = new Map<string, PendingSync>()

/** Records that `taskId` is syncing the design layer up to `commit`. */
export function registerPendingSync(taskId: string, cwd: string, commit: string): void {
	pending.set(taskId, { cwd, commit })
}

/** Drops a pending sync without advancing (e.g. caller-side cleanup). */
export function clearPendingSync(taskId: string): void {
	pending.delete(taskId)
}

/**
 * Fired when a task completes successfully (attempt_completion). If that task was
 * a registered sync, advance the bookmark to its target commit — exactly once.
 * No-op for every non-sync task, so it is cheap to call on all completions.
 */
export async function onSyncTaskCompleted(taskId: string): Promise<void> {
	const entry = pending.get(taskId)
	if (!entry) {
		return
	}
	// Delete first so a repeated attempt_completion on the same task can't double-advance.
	pending.delete(taskId)
	try {
		await advanceSyncState(entry.cwd, entry.commit)
		Logger.info(`[sync] bookmark advanced to ${entry.commit.slice(0, 8)} (task ${taskId} completed)`)
	} catch (err) {
		Logger.error(`[sync] failed to advance bookmark after task ${taskId} completed:`, err)
	}
}

/**
 * Fired when a task completes successfully. If design mode is active and the
 * design layer is dirty, commits `.caret/` (scoped) so it stays committed — the
 * sole, deterministic, app-isolated commit path. Setting-gated and silent (with
 * a transparency toast). No-op outside design mode / when clean / when disabled.
 */
export async function onDesignTaskCompleted(cwd: string, autoCommitEnabled: boolean): Promise<void> {
	if (!autoCommitEnabled || !isDesignModeActive()) {
		return
	}
	if (!(await hasUncommittedDesignChanges(cwd))) {
		return
	}
	const hash = await commitDesignLayer(cwd, "design: auto-checkpoint")
	if (hash) {
		Logger.info(`[sync] auto-committed .caret/ → ${hash.slice(0, 8)} on design task completion`)
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Committed design changes to .caret/",
		})
	}
}

/**
 * Fired when a (resumable) task is cancelled. If design mode is active and the
 * design layer has uncommitted orphans, offers Keep/Discard alongside Cline's
 * own Resume button. Discard is `.caret/`-scoped and race-guarded: if the user
 * resumed (a task is active again) it leaves the changes alone.
 */
export async function onDesignTaskCancelled(cwd: string, isTaskActive: () => boolean): Promise<void> {
	if (!isDesignModeActive()) {
		return
	}
	if (!(await hasUncommittedDesignChanges(cwd))) {
		return
	}
	const choice = await HostProvider.window.showMessage({
		type: ShowMessageType.WARNING,
		message: "Design task cancelled with uncommitted changes in .caret/. Discard reverts ALL uncommitted .caret/ changes.",
		options: { items: ["Discard", "Keep"] },
	})
	if (choice.selectedOption !== "Discard") {
		return
	}
	// Resume-then-Discard guard: don't revert work that's now back in progress.
	if (isTaskActive()) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Task resumed — design changes kept.",
		})
		return
	}
	await discardDesignLayerChanges(cwd)
	HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: "Discarded uncommitted .caret/ changes.",
	})
}

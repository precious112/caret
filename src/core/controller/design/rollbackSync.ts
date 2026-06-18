import { EmptyRequest } from "@shared/proto/cline/common"
import { SyncDesignResponse } from "@shared/proto/cline/design"
import { clearPendingSync, readPendingSync } from "@/core/design/sync/sync-completion"
import { writeSyncState } from "@/core/design/sync/sync-state"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from "../index"

/**
 * Rolls back the most recent (possibly half-done) design→app sync: restores the
 * app to the checkpoint captured before the sync edited anything, reverts the
 * sync bookmark to its pre-sync value, and stops the sync task if it's running.
 */
export async function rollbackSync(controller: Controller, _request: EmptyRequest): Promise<SyncDesignResponse> {
	const cwd = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
	const record = await readPendingSync(cwd)
	if (!record) {
		return SyncDesignResponse.create({
			status: "nothing",
			message: "No recent sync to roll back.",
			fixLabel: "",
			shown: 0,
			total: 0,
			summarized: 0,
		})
	}

	// Restore the workspace (app files + .caret/sync-state.json, which lives inside
	// the checkpoint snapshot) to the pre-sync state. Must run BEFORE cancelTask,
	// which can tear down the task's checkpoint manager/tracker.
	let appRestored = false
	if (record.preSyncCheckpoint && controller.task?.taskId === record.taskId) {
		try {
			const tracker = await controller.task.checkpointManager?.checkpointTrackerCheckAndInit?.()
			if (tracker) {
				await tracker.resetHead(record.preSyncCheckpoint)
				appRestored = true
			}
		} catch (err) {
			Logger.error("[sync] rollback: checkpoint restore failed:", err)
		}
	}

	// Revert the bookmark to its pre-sync value. Defensive — resetHead already does
	// this when sync-state.json was captured, but this also covers the no-checkpoint case.
	try {
		await writeSyncState(cwd, { lastSyncedCommit: record.previousBookmark })
	} catch (err) {
		Logger.error("[sync] rollback: failed to revert bookmark:", err)
	}

	await clearPendingSync(cwd)

	// Stop the in-flight sync task if it's still the active one.
	if (controller.task?.taskId === record.taskId) {
		try {
			await controller.cancelTask()
		} catch (err) {
			Logger.error("[sync] rollback: failed to cancel sync task:", err)
		}
	}

	const message = appRestored
		? "Rolled back the last sync — app changes and sync state reverted to before the sync."
		: "Reverted the sync state. To also undo app file edits, use the checkpoint Restore on the sync message."
	return SyncDesignResponse.create({ status: "rolledback", message, fixLabel: "", shown: 0, total: 0, summarized: 0 })
}

import * as fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { hasUncommittedDesignChanges } from "@/utils/git"
import { runExclusive, writeFileAtomic } from "../file-mutation-queue"
import { ensureCaretGitignore, isDesignModeActive } from "../scaffold"
import { commitDesignLayer, discardDesignLayerChanges } from "./sync-git"
import { advanceSyncState } from "./sync-state"

/**
 * Durable record of the single in-flight sync. The bookmark in
 * `.caret/sync-state.json` is advanced by OUR code (here) when the sync task
 * completes successfully — never by instructing the model to write the file.
 *
 * It is persisted to a gitignored `.caret/.sync-pending.json` (not an in-memory
 * map) because a sync spans a long flow (plan → review → Act → apply → complete)
 * during which the extension host can reload; an in-memory entry would be lost
 * and the bookmark would never advance. The resumed-after-reload task keeps the
 * same taskId, so the persisted record still matches at completion. Only one
 * sync runs at a time (initTask clears any prior task), so a single record
 * suffices.
 */
export interface PendingSync {
	taskId: string
	/** The design HEAD this sync is reconciling the app up to. */
	commit: string
	/** The bookmark BEFORE this sync started — restored if the sync is rolled back. */
	previousBookmark: string | null
	/** Checkpoint hash captured before the sync edited anything — the rollback target. */
	preSyncCheckpoint?: string
	/** True once the sync began applying (bookmark advanced). Gates idempotent re-advance. */
	applied?: boolean
}

function pendingPath(cwd: string): string {
	return path.join(cwd, ".caret", ".sync-pending.json")
}

/** Reads the durable pending-sync record, or null when there is none / it's unreadable. */
export async function readPendingSync(cwd: string): Promise<PendingSync | null> {
	try {
		const parsed = JSON.parse(await fs.readFile(pendingPath(cwd), "utf-8")) as PendingSync
		return parsed && typeof parsed.taskId === "string" ? parsed : null
	} catch {
		return null
	}
}

async function writePendingSync(cwd: string, entry: PendingSync): Promise<void> {
	const filePath = pendingPath(cwd)
	await runExclusive(filePath, async () => {
		await writeFileAtomic(filePath, JSON.stringify(entry, null, 2))
	})
}

/** Records that `taskId` is syncing the design layer up to `commit` (durable). */
export async function registerPendingSync(
	cwd: string,
	entry: { taskId: string; commit: string; previousBookmark: string | null; preSyncCheckpoint?: string },
): Promise<void> {
	// Guarantee `.sync-pending.json` is ignored before creating it, so it can't be
	// swept into the design auto-commit or trip the dirty check (handles existing
	// projects whose .gitignore predates this file).
	await ensureCaretGitignore(cwd).catch(() => {})
	await writePendingSync(cwd, { ...entry, applied: false })
}

/** Drops the pending sync without advancing (e.g. caller-side cleanup). */
export async function clearPendingSync(cwd: string): Promise<void> {
	await fs.rm(pendingPath(cwd), { force: true }).catch(() => {})
}

/**
 * Advances the sync bookmark when its task starts APPLYING the sync (the user
 * switches the plan-mode sync into Act), and again — defensively — on full
 * completion. Idempotent: the `applied` flag means repeated triggers never
 * double-advance. No-op for every non-sync task, so it's cheap to call broadly.
 *
 * Why not only on `attempt_completion`: a plan-mode sync frequently never reaches
 * it (the user reviews/applies the plan without a formal completion), which left
 * the bookmark stuck at "never synced" so every sync re-reported the whole design.
 *
 * @param final when true (task completed), the record is cleared afterwards — the
 *   sync is accepted, so the one-click rollback is no longer offered.
 */
export async function applySyncBookmark(taskId: string, cwd: string, final = false): Promise<void> {
	const entry = await readPendingSync(cwd)
	if (!entry || entry.taskId !== taskId) {
		return // no pending sync, or a different task — leave the record intact
	}
	if (!entry.applied) {
		try {
			await advanceSyncState(cwd, entry.commit)
			entry.applied = true
			await writePendingSync(cwd, entry)
			Logger.info(`[sync] bookmark advanced to ${entry.commit.slice(0, 8)} (task ${taskId} applied)`)
		} catch (err) {
			Logger.error(`[sync] failed to advance bookmark for task ${taskId}:`, err)
			return
		}
	}
	if (final) {
		await clearPendingSync(cwd)
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

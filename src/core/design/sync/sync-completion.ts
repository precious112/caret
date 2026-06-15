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
interface PendingSync {
	taskId: string
	/** The design HEAD this sync is reconciling the app up to. */
	commit: string
}

function pendingPath(cwd: string): string {
	return path.join(cwd, ".caret", ".sync-pending.json")
}

/** Records that `taskId` is syncing the design layer up to `commit` (durable). */
export async function registerPendingSync(taskId: string, cwd: string, commit: string): Promise<void> {
	// Guarantee `.sync-pending.json` is ignored before creating it, so it can't be
	// swept into the design auto-commit or trip the dirty check (handles existing
	// projects whose .gitignore predates this file).
	await ensureCaretGitignore(cwd).catch(() => {})
	const filePath = pendingPath(cwd)
	await runExclusive(filePath, async () => {
		await writeFileAtomic(filePath, JSON.stringify({ taskId, commit } satisfies PendingSync, null, 2))
	})
}

/** Drops the pending sync without advancing (e.g. caller-side cleanup). */
export async function clearPendingSync(cwd: string): Promise<void> {
	await fs.rm(pendingPath(cwd), { force: true }).catch(() => {})
}

/**
 * Fired when a task completes successfully (attempt_completion). If that task was
 * the registered sync, advance the bookmark to its target commit — exactly once.
 * No-op for every non-sync task, so it is cheap to call on all completions.
 */
export async function onSyncTaskCompleted(taskId: string, cwd: string): Promise<void> {
	const filePath = pendingPath(cwd)
	let entry: PendingSync | undefined
	try {
		entry = JSON.parse(await fs.readFile(filePath, "utf-8")) as PendingSync
	} catch {
		return // no pending sync (or unreadable) → nothing to advance
	}
	if (!entry || entry.taskId !== taskId) {
		return // a different task completed; leave the pending sync intact
	}
	// Clear first so a repeated attempt_completion on the same task can't double-advance.
	await clearPendingSync(cwd)
	try {
		await advanceSyncState(cwd, entry.commit)
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

/**
 * Design → app sync, run on the backend Caret owns.
 *
 * This restores the V1 contract that the BYO-agent detour could not keep. The
 * preflight, the worklist prompt, the pre-sync snapshot and "Undo sync" are all
 * unchanged; what comes back is the part that needs Caret to be in the loop:
 *
 * 1. **Plan** in a `read-only` session. App writes are denied at Caret's own
 *    permission boundary no matter what the agent config says, so "review before
 *    anything changes" is a guarantee rather than an instruction.
 * 2. **Review.** The plan streams into the chat and the user accepts or discards
 *    it. Discarding ends the session with nothing written.
 * 3. **Apply** in the same session, switched to `write`. App-path permissions
 *    follow the user's own toggle.
 * 4. **Caret advances the bookmark**, in this file, in its own code. The model is
 *    never asked to write `sync-state.json` — an honour-system bookmark was the
 *    bug that made every sync re-report the whole design layer.
 */
import { Logger } from "@/shared/services/Logger"
import type { AgentConversation } from "../agent/conversation"
import { clearPendingSync, completeSync, readPendingSync } from "./sync-completion"
import { diffCountAgainstSnapshot } from "./sync-snapshot"

export interface BackendSyncRequest {
	cwd: string
	syncId: string
	/** The worklist prompt from `buildSyncPrompt` — file names, never file contents. */
	prompt: string
	changedCount: number
}

/**
 * The apply turn's prompt.
 *
 * It opens by **revoking the planning restriction**, and that is the load-bearing
 * line rather than a courtesy. The apply resumes the same session, so the plan
 * prompt — "RIGHT NOW YOU ARE PLANNING, NOT CHANGING ANYTHING… any write you
 * attempt will be refused" — is still in context. Telling a model to edit while
 * an earlier turn forbids it leaves the two instructions to fight, and the better
 * the model is at following instructions the more likely the prohibition wins.
 *
 * That inversion was observed: a weak model applied eighteen files, while a
 * stronger one announced it would map the changes "without modifying files" and
 * touched nothing. Repeating "edit now" louder does not fix a contradiction; only
 * withdrawing the earlier instruction does.
 */
const APPLY_PROMPT = `The planning phase is over, and the restriction you were given for it no
longer applies. You were told you were planning, that you must not change anything, and that
any write would be refused. **Disregard all of that from here on.** The user has read your plan
and approved it. This turn is in write mode, your edits will be accepted, and producing another
plan instead of edits is a failure.

Make the edits to the app now.

You have already read everything you need — that was the whole point of the planning turn.
**Start editing immediately.** Do not re-list directories, re-read config files or look for
conventions again; if you catch yourself exploring, stop and write the edit instead.

Work only from the plan you just wrote. If something in it turns out to be wrong once you
open the file, say so and stop rather than improvising a different change — the user approved
a specific plan.

Do not touch \`.caret/\` — the design layer is already correct; it is the source you are
translating *from*. Do not write \`sync-state.json\`: Caret records the sync itself.`

/**
 * Runs the whole two-phase sync. Long-lived — the caller starts it and returns.
 *
 * Every exit path clears the pending record. A pending sync that outlives its
 * conversation would let a later `complete_sync` advance the bookmark past work
 * nobody applied, which is the one failure that silently loses design changes.
 */
export async function runBackendSync(conversation: AgentConversation, request: BackendSyncRequest): Promise<void> {
	const { cwd, syncId, changedCount } = request

	try {
		const plan = await conversation.run({
			kind: "sync-plan",
			title: "Sync design → app",
			mode: "read-only",
			prompt: request.prompt,
			displayPrompt:
				changedCount === 0
					? "Reconcile the whole design layer into the app."
					: `Bring the app in line with ${changedCount} changed design file${changedCount === 1 ? "" : "s"}.`,
			note:
				changedCount === 0
					? "Planning a full reconciliation. Nothing in your app is written yet."
					: `Planning from ${changedCount} changed design file${changedCount === 1 ? "" : "s"}. Nothing in your app is written yet.`,
		})

		if (!plan.ok) {
			conversation.note("The plan didn't finish, so nothing was applied. Your design layer is untouched.")
			await clearPendingSync(cwd)
			return
		}

		const approved = await conversation.requestApproval({
			id: syncId,
			question: "Apply this to your app?",
			confirmLabel: "Apply",
			cancelLabel: "Discard",
		})

		if (!approved) {
			conversation.note("Discarded. Nothing was written, and this design change will be offered again next sync.")
			await clearPendingSync(cwd)
			return
		}

		const applied = await conversation.run({
			kind: "sync-apply",
			title: "Sync design → app",
			mode: "write",
			prompt: APPLY_PROMPT,
			displayPrompt: "Apply the plan.",
			// Same session: the plan is the context that makes the apply correct,
			// and re-sending it as text would be both wasteful and lossy.
			resumeSessionId: plan.sessionId ?? undefined,
		})

		if (!applied.ok) {
			conversation.note("The changes didn't finish cleanly. Use Undo sync if the app is in a bad state.")
			return
		}

		// Did anything actually change? **Ask git, not the transcript.**
		//
		// This used to count `file-changed` events, which an adapter only emits for
		// tools whose *name* it recognises — `edit`, `write`, `patch`. A model that
		// reaches for any other tool edits the app while Caret sees nothing, and the
		// bookmark then fails to advance on a sync that genuinely happened, so the
		// same changes are re-offered forever. Caret already took a snapshot before
		// the agent touched anything; that is the authoritative answer and it does
		// not care what the tool was called.
		//
		// The point stands either way: a turn can end cleanly having written
		// nothing, and advancing there silently drops the design change rather than
		// retrying it. "It finished" is not "it did it".
		const pending = await readPendingSync(cwd)
		const changed = pending?.preSyncSnapshot ? await diffCountAgainstSnapshot(cwd, pending.preSyncSnapshot) : 0

		if (changed === 0) {
			conversation.note(
				"The agent finished without changing anything in your app, so this sync hasn't been recorded — the same design changes will be offered again next time. Try again, or use a stronger model.",
			)
			await clearPendingSync(cwd)
			return
		}

		const outcome = await completeSync(cwd, syncId)
		conversation.note(
			outcome === "advanced"
				? `Synced — ${changed} app file${changed === 1 ? "" : "s"} changed. The next sync will only report changes made from here.`
				: `Applied, but the sync bookmark didn't advance (${outcome}). The next sync will re-report these files.`,
		)
	} catch (err) {
		Logger.error("[sync] backend sync failed:", err)
		conversation.note(`Sync stopped: ${err instanceof Error ? err.message : String(err)}`)
		await clearPendingSync(cwd).catch(() => {})
	}
}

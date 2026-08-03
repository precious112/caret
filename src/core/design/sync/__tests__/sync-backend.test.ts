/**
 * The bookmark rule.
 *
 * A sync that advances the bookmark without having changed anything is the worst
 * failure this system has: the design change is never offered again, so it is
 * dropped rather than retried, and nothing tells anyone. It is cheap to get
 * wrong — "the turn ended without an error" reads like success — so it is
 * pinned here against a stubbed conversation rather than left to a live model.
 */
import { strict as assert } from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { AgentConversation, RunOutcome, RunRequest } from "../../agent/conversation"
import { runBackendSync } from "../sync-backend"
import { registerPendingSync } from "../sync-completion"
import { readSyncState, writeSyncState } from "../sync-state"

interface StubOptions {
	/** Files each turn reports as changed, in order. */
	filesPerTurn: string[][]
	approve: boolean
}

function stubConversation(options: StubOptions) {
	const notes: string[] = []
	const kinds: string[] = []
	let turn = 0
	// Files accumulate across turns in the real transcript, which is what makes
	// "did the apply write anything" a comparison rather than a check for empty.
	const seen: string[] = []

	const conversation = {
		async run(request: RunRequest): Promise<RunOutcome> {
			kinds.push(request.kind)
			for (const file of options.filesPerTurn[turn] ?? []) {
				if (!seen.includes(file)) seen.push(file)
			}
			turn += 1
			return { ok: true, sessionId: "ses_stub", text: "", filesChanged: [...seen] }
		},
		async requestApproval(): Promise<boolean> {
			return options.approve
		},
		note(text: string) {
			notes.push(text)
		},
	}

	return { conversation: conversation as unknown as AgentConversation, notes, kinds }
}

async function fixture(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-syncbackend-"))
	await fs.mkdir(path.join(dir, ".caret"), { recursive: true })
	await writeSyncState(dir, { lastSyncedCommit: null })
	await registerPendingSync(dir, { syncId: "sync-1", commit: "abc123", previousBookmark: null })
	return dir
}

describe("runBackendSync", () => {
	it("advances the bookmark when the apply actually wrote something", async () => {
		const cwd = await fixture()
		const { conversation, kinds } = stubConversation({ filesPerTurn: [[], ["src/App.tsx"]], approve: true })

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.deepEqual(kinds, ["sync-plan", "sync-apply"])
		assert.equal((await readSyncState(cwd)).lastSyncedCommit, "abc123")
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("leaves the bookmark alone when the apply finished without writing anything", async () => {
		const cwd = await fixture()
		const { conversation, notes } = stubConversation({ filesPerTurn: [[], []], approve: true })

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.equal((await readSyncState(cwd)).lastSyncedCommit, null, "an empty apply advanced the bookmark")
		assert.ok(
			notes.some((note) => note.includes("offered again")),
			`the user was not told the sync did not happen: ${JSON.stringify(notes)}`,
		)
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("writes nothing and records nothing when the plan is discarded", async () => {
		const cwd = await fixture()
		const { conversation, kinds } = stubConversation({ filesPerTurn: [[]], approve: false })

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.deepEqual(kinds, ["sync-plan"], "the apply ran despite being discarded")
		assert.equal((await readSyncState(cwd)).lastSyncedCommit, null)
		await fs.rm(cwd, { recursive: true, force: true })
	})
})

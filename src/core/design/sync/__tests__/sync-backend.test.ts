/**
 * The bookmark rule.
 *
 * A sync that advances the bookmark without having changed anything is the worst
 * failure this system has: the design change is never offered again, so it is
 * dropped rather than retried, and nothing tells anyone. The mirror failure is
 * just as bad — a sync that *did* change the app but is not recorded, so the same
 * work is offered forever.
 *
 * Both hinge on one question, "did the apply write anything", and the answer has
 * to come from **git** rather than from the transcript. Counting `file-changed`
 * events was tried and is wrong: an adapter only emits those for tools whose
 * name it recognises, so a model reaching for any other tool edits the app while
 * Caret sees nothing. These run against a real repository and a real snapshot
 * for exactly that reason.
 */
import { strict as assert } from "assert"
import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { AgentConversation, RunOutcome, RunRequest } from "../../agent/conversation"
import { runBackendSync } from "../sync-backend"
import { registerPendingSync } from "../sync-completion"
import { captureSyncSnapshot } from "../sync-snapshot"
import { readSyncState, writeSyncState } from "../sync-state"

interface StubOptions {
	approve: boolean
	/** Runs when the apply turn starts, standing in for whatever the agent did. */
	onApply?: () => Promise<void>
}

function stubConversation(options: StubOptions) {
	const notes: string[] = []
	const kinds: string[] = []

	const conversation = {
		async run(request: RunRequest): Promise<RunOutcome> {
			kinds.push(request.kind)
			if (request.kind === "sync-apply") await options.onApply?.()
			// Deliberately always reports no files: the decision must not depend on
			// what the transcript happened to notice.
			return { ok: true, sessionId: "ses_stub", text: "", filesChanged: [] }
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

/** A real repository with a committed app file and a pre-sync snapshot. */
async function fixture(): Promise<{ cwd: string; appFile: string }> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "caret-syncbackend-"))
	await fs.mkdir(path.join(cwd, ".caret"), { recursive: true })
	await fs.mkdir(path.join(cwd, "src"), { recursive: true })

	const appFile = path.join(cwd, "src", "App.tsx")
	await fs.writeFile(appFile, "export default function App() { return null }\n")

	const git = (args: string) => child_process.execSync(`git ${args}`, { cwd, stdio: "ignore" })
	git("init -q")
	git("config user.email caret@local")
	git("config user.name Caret")
	git("config commit.gpgSign false")
	git("add -A")
	git('commit -q -m "fixture" --no-verify')

	await writeSyncState(cwd, { lastSyncedCommit: null })
	const snapshot = await captureSyncSnapshot(cwd)
	await registerPendingSync(cwd, {
		syncId: "sync-1",
		commit: "abc123",
		previousBookmark: null,
		preSyncSnapshot: snapshot ?? undefined,
	})

	return { cwd, appFile }
}

describe("runBackendSync", () => {
	it("advances the bookmark when the app actually changed on disk", async () => {
		const { cwd, appFile } = await fixture()
		const { conversation, kinds } = stubConversation({
			approve: true,
			// A tool Caret's event mapping has never heard of would look exactly
			// like this: the file moves, the transcript says nothing.
			onApply: () => fs.writeFile(appFile, "export default function App() { return <h1>Zephyr</h1> }\n"),
		})

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.deepEqual(kinds, ["sync-plan", "sync-apply"])
		assert.equal((await readSyncState(cwd)).lastSyncedCommit, "abc123")
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("leaves the bookmark alone when the apply finished without touching the app", async () => {
		const { cwd } = await fixture()
		const { conversation, notes } = stubConversation({ approve: true })

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.equal((await readSyncState(cwd)).lastSyncedCommit, null, "an empty apply advanced the bookmark")
		assert.ok(
			notes.some((note) => note.includes("offered again")),
			`the user was not told the sync did not happen: ${JSON.stringify(notes)}`,
		)
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("ignores changes confined to the design layer", async () => {
		// `.caret/` is the *source* of a sync, not its result. A stray write there
		// must not be mistaken for the app having been brought in line.
		const { cwd } = await fixture()
		const { conversation } = stubConversation({
			approve: true,
			onApply: () => fs.writeFile(path.join(cwd, ".caret", "scratch.txt"), "written during the apply\n"),
		})

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.equal((await readSyncState(cwd)).lastSyncedCommit, null, "a design-layer write advanced the bookmark")
		await fs.rm(cwd, { recursive: true, force: true })
	})

	it("writes nothing and records nothing when the plan is discarded", async () => {
		const { cwd } = await fixture()
		const { conversation, kinds } = stubConversation({ approve: false })

		await runBackendSync(conversation, { cwd, syncId: "sync-1", prompt: "worklist", changedCount: 1 })

		assert.deepEqual(kinds, ["sync-plan"], "the apply ran despite being discarded")
		assert.equal((await readSyncState(cwd)).lastSyncedCommit, null)
		await fs.rm(cwd, { recursive: true, force: true })
	})
})

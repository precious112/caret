import { expect } from "chai"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { applySyncBookmark, clearPendingSync, readPendingSync, registerPendingSync } from "../sync-completion"
import { readSyncState } from "../sync-state"

describe("applySyncBookmark — reliable, idempotent bookmark advance", () => {
	let cwd: string

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "caret-sync-"))
		await fs.mkdir(path.join(cwd, ".caret"), { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {})
	})

	const register = (taskId: string, commit: string, previousBookmark: string | null = null) =>
		registerPendingSync(cwd, { taskId, commit, previousBookmark, preSyncCheckpoint: "chk-abc" })

	it("advances the bookmark when the matching task applies, and marks the record applied", async () => {
		await register("task-1", "commit-aaa", null)
		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal(null)

		await applySyncBookmark("task-1", cwd)

		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal("commit-aaa")
		const record = await readPendingSync(cwd)
		expect(record?.applied).to.equal(true)
		// Record is kept (rollback still needs previousBookmark + checkpoint).
		expect(record?.previousBookmark).to.equal(null)
		expect(record?.preSyncCheckpoint).to.equal("chk-abc")
	})

	it("is idempotent — a second apply does not change the bookmark and keeps the record", async () => {
		await register("task-1", "commit-aaa")
		await applySyncBookmark("task-1", cwd)
		await applySyncBookmark("task-1", cwd) // repeat (e.g. another plan→act toggle)

		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal("commit-aaa")
		expect(await readPendingSync(cwd)).to.not.equal(null)
	})

	it("does nothing for a different task id", async () => {
		await register("task-1", "commit-aaa")
		await applySyncBookmark("some-other-task", cwd)

		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal(null)
		expect((await readPendingSync(cwd))?.applied).to.not.equal(true)
	})

	it("no-ops cleanly when there is no pending sync", async () => {
		await applySyncBookmark("task-1", cwd)
		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal(null)
		expect(await readPendingSync(cwd)).to.equal(null)
	})

	it("clears the record on final (completion) after advancing", async () => {
		await register("task-1", "commit-aaa")
		await applySyncBookmark("task-1", cwd, true)

		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal("commit-aaa")
		expect(await readPendingSync(cwd)).to.equal(null)
	})

	it("preserves previousBookmark for rollback", async () => {
		await register("task-2", "commit-bbb", "commit-old")
		await applySyncBookmark("task-2", cwd)
		expect((await readPendingSync(cwd))?.previousBookmark).to.equal("commit-old")
	})

	it("clearPendingSync removes the record without advancing", async () => {
		await register("task-1", "commit-aaa")
		await clearPendingSync(cwd)
		expect(await readPendingSync(cwd)).to.equal(null)
		expect((await readSyncState(cwd)).lastSyncedCommit).to.equal(null)
	})
})

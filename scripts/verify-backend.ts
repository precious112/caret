/**
 * Backend certification: drives the real coding backend, end to end.
 *
 * `verify:app` proves the application works; this proves the thing underneath it
 * that actually costs inference. It boots the bundled binary, runs a real turn
 * against a real model, and asserts on **disk** — an agent that says it wrote a
 * file and did not is the failure this exists to catch.
 *
 * Nothing paid is spent by accident. Set `CARET_VERIFY_MODEL` to run this
 * against your own subscription; otherwise it uses a zero-cost model if the
 * backend offers one, and skips rather than fails if it does not. A Caret with
 * no credentials is a supported state, and a red suite would call that broken.
 *
 * Usage:
 *   npx tsx scripts/verify-backend.ts
 *   CARET_VERIFY_MODEL=anthropic/claude-sonnet-5 npx tsx scripts/verify-backend.ts
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { BackendEvent } from "../src/core/design/agent/backend"
import { OpencodeBackend } from "../src/core/design/agent/opencode"
import { stopOpencodeServer } from "../src/core/design/agent/opencode/server"
import { NO_MODEL_REASON, resolveVerifyModel } from "./verify-support"

interface Result {
	name: string
	passed: boolean
	skipped?: boolean
	detail: string
}

const results: Result[] = []
let workspace = ""

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
	try {
		const detail = await run()
		results.push({ name, passed: true, detail })
		console.log(`[verify-backend] PASS ${name} — ${detail}`)
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err)
		results.push({ name, passed: false, detail })
		console.log(`[verify-backend] FAIL ${name} — ${detail}`)
	}
}

function skip(name: string, reason: string): void {
	results.push({ name, passed: true, skipped: true, detail: `SKIPPED — ${reason}` })
	console.log(`[verify-backend] SKIP ${name} — ${reason}`)
}

async function main(): Promise<void> {
	workspace = await fs.mkdtemp(path.join(os.tmpdir(), "caret-backend-"))

	const model = await resolveVerifyModel()
	// Whichever backend the run targets — the bundled one unless told otherwise.
	const backend = model?.backend ?? new OpencodeBackend()
	const MODEL = model?.id
	const EFFORT = model?.effort
	const inference = model ? scenario : (name: string, _run: () => Promise<string>) => void skip(name, NO_MODEL_REASON)

	await scenario(`a. ${backend.displayName} reports itself ready`, async () => {
		const report = await backend.availability()
		assert(report.installed, `not installed: ${report.detail}`)
		assert(report.ready, `not ready: ${report.detail}`)
		return `${report.detail}${model ? ` — running ${model.id}${EFFORT ? ` at ${EFFORT} effort` : ""}` : ""}`
	})

	await inference("b. structured() answers inside the schema's enum", async () => {
		const result = await backend.structured<{ pick: string }>({
			workingDirectory: workspace,
			model: MODEL,
			effort: EFFORT,
			prompt: "Which of these is a fruit that is yellow and curved? Answer with its id.",
			schema: {
				type: "object",
				required: ["pick"],
				additionalProperties: false,
				properties: { pick: { type: "string", enum: ["banana", "granite", "hydrogen"] } },
			},
		})
		assert(result.value.pick === "banana", `expected "banana", got ${JSON.stringify(result.value)}`)
		return `pick=${result.value.pick}${result.emulated ? " (emulated)" : " (native)"}`
	})

	await inference("c. a write session changes a file on disk to exactly what was asked", async () => {
		const target = path.join(workspace, "hello.txt")
		await fs.writeFile(target, "placeholder\n", "utf-8")

		const session = await backend.startSession({ workingDirectory: workspace, mode: "write", model: MODEL, effort: EFFORT })
		const seen = await drain(
			session.send({ text: `Replace the entire contents of hello.txt with exactly: pineapple` }),
			(event) => (event.type === "permission" ? session.respondToPermission(event.requestId, "allow") : undefined),
		)
		await session.close()

		const contents = (await fs.readFile(target, "utf-8")).trim()
		assert(contents === "pineapple", `the file says ${JSON.stringify(contents)}`)
		assert(
			seen.some((event) => event.type === "file-changed"),
			"no file-changed event was emitted for a write that happened",
		)
		return `hello.txt = "pineapple"; events: ${summarise(seen)}`
	})

	/**
	 * The boundary: it asks, and a denial is obeyed.
	 *
	 * This used to branch on a `permissionModel`, because two of the four adapters
	 * could only be confined by a sandbox chosen before the turn and had no
	 * callback to answer. Those adapters are gone and the branch went with them —
	 * an unreachable arm in a certification suite is worse than no arm, because it
	 * reads as coverage. Every backend that ships asks; if one ever cannot, this
	 * scenario is where that difference has to become visible again.
	 */
	await inference("d. Caret's write boundary holds — it asks, and a denial stands", async () => {
		const target = path.join(workspace, "protected.txt")
		await fs.writeFile(target, "untouched\n", "utf-8")
		const instruction = `Replace the entire contents of protected.txt with exactly: changed`

		const session = await backend.startSession({
			workingDirectory: workspace,
			mode: "write",
			model: MODEL,
			effort: EFFORT,
		})
		const seen = await drain(session.send({ text: instruction }), (event) =>
			event.type === "permission" ? session.respondToPermission(event.requestId, "deny") : undefined,
		)
		await session.close()

		const contents = (await fs.readFile(target, "utf-8")).trim()
		assert(contents === "untouched", `a denied edit still landed: ${JSON.stringify(contents)}`)
		assert(
			seen.some((event) => event.type === "permission"),
			"the backend never asked — Caret's boundary was never consulted",
		)
		return "asked, denied, file unchanged"
	})

	/**
	 * A read-only session cannot write. Separate from the denial above, because it
	 * is a different promise: the sync plan phase depends on this one holding even
	 * when nobody is watching to say no.
	 */
	await inference("d2. a read-only session cannot write, with no denial needed", async () => {
		const target = path.join(workspace, "plan-only.txt")
		await fs.writeFile(target, "untouched\n", "utf-8")

		const session = await backend.startSession({
			workingDirectory: workspace,
			mode: "read-only",
			model: MODEL,
			effort: EFFORT,
		})
		// Anything it asks for is allowed, so a refusal to write is the *session*
		// holding rather than Caret quietly saying no on its behalf.
		const seen = await drain(
			session.send({ text: "Replace the contents of plan-only.txt with exactly: changed" }),
			(event) => (event.type === "permission" ? session.respondToPermission(event.requestId, "allow") : undefined),
		)
		await session.close()

		const contents = (await fs.readFile(target, "utf-8")).trim()
		assert(contents === "untouched", `a read-only session wrote to the workspace: ${JSON.stringify(contents)}`)
		return `read-only held with every request allowed; events: ${summarise(seen)}`
	})

	await inference("e. sessions are listable for the history panel", async () => {
		// Optional on the seam, because a backend can genuinely have no listing API
		// — one removed adapter persisted threads to disk with no way to enumerate
		// them. Absent is a different thing from broken, so it says which.
		if (!backend.listSessions) return `${backend.displayName} has no session listing — the history panel is empty there`
		const sessions = await backend.listSessions(workspace)
		assert(sessions.length >= 2, `expected the sessions just run, got ${sessions.length}`)
		return `${sessions.length} session(s)`
	})
}

/** Consumes a turn, running `onEvent` for each, and returns everything seen. */
async function drain(
	stream: AsyncIterable<BackendEvent>,
	onEvent: (event: BackendEvent) => Promise<void> | undefined,
): Promise<BackendEvent[]> {
	const seen: BackendEvent[] = []
	for await (const event of stream) {
		seen.push(event)
		await onEvent(event)
	}
	return seen
}

function summarise(events: BackendEvent[]): string {
	const counts = new Map<string, number>()
	for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
	return [...counts].map(([type, count]) => `${type}×${count}`).join(" ")
}

main()
	.catch((err) => results.push({ name: "harness", passed: false, detail: String(err) }))
	.finally(async () => {
		await stopOpencodeServer()
		if (workspace) await fs.rm(workspace, { recursive: true, force: true }).catch(() => {})

		console.log("\n========== CARET BACKEND CERTIFICATION ==========")
		for (const result of results) {
			const mark = result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL"
			console.log(`${mark}  ${result.name.padEnd(56)} ${result.detail}`)
		}
		const failed = results.filter((r) => !r.passed)
		console.log("================================================")
		console.log(
			failed.length === 0 ? `CERTIFIED: all ${results.length} scenarios pass` : `${failed.length} scenario(s) FAILED`,
		)
		process.exit(failed.length === 0 ? 0 : 1)
	})

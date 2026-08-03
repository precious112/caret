/**
 * Backend certification: drives the real coding backend, end to end.
 *
 * `verify:app` proves the application works; this proves the thing underneath it
 * that actually costs inference. It boots the bundled binary, runs a real turn
 * against a real model, and asserts on **disk** — an agent that says it wrote a
 * file and did not is the failure this exists to catch.
 *
 * Free models are used deliberately: the bundled backend reaches OpenCode Zen's
 * free tier with no credentials, so this runs on a clean machine and in CI
 * without anyone's subscription.
 *
 * Usage:
 *   npx tsx scripts/verify-backend.ts
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { BackendEvent } from "../src/core/design/agent/backend"
import { OpencodeBackend } from "../src/core/design/agent/opencode"
import { stopOpencodeServer } from "../src/core/design/agent/opencode/server"

/** A small, fast, free model. Structured output on it is expected to emulate. */
const MODEL = "opencode/ling-3.0-flash-free"

interface Result {
	name: string
	passed: boolean
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

async function main(): Promise<void> {
	workspace = await fs.mkdtemp(path.join(os.tmpdir(), "caret-backend-"))
	const backend = new OpencodeBackend()

	await scenario("a. the bundled backend reports itself ready", async () => {
		const report = await backend.availability()
		assert(report.installed, `the binary was not found: ${report.detail}`)
		assert(report.ready, `not ready: ${report.detail}`)
		return report.detail
	})

	await scenario("b. structured() answers inside the schema's enum", async () => {
		const result = await backend.structured<{ pick: string }>({
			workingDirectory: workspace,
			model: MODEL,
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

	await scenario("c. a write session changes a file on disk to exactly what was asked", async () => {
		const target = path.join(workspace, "hello.txt")
		await fs.writeFile(target, "placeholder\n", "utf-8")

		const session = await backend.startSession({ workingDirectory: workspace, mode: "write", model: MODEL })
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

	await scenario("d. a denied permission leaves the file alone", async () => {
		const target = path.join(workspace, "protected.txt")
		await fs.writeFile(target, "untouched\n", "utf-8")

		const session = await backend.startSession({ workingDirectory: workspace, mode: "write", model: MODEL })
		const seen = await drain(
			session.send({ text: `Replace the entire contents of protected.txt with exactly: changed` }),
			(event) => (event.type === "permission" ? session.respondToPermission(event.requestId, "deny") : undefined),
		)
		await session.close()

		const contents = (await fs.readFile(target, "utf-8")).trim()
		assert(contents === "untouched", `a denied edit still landed: ${JSON.stringify(contents)}`)
		assert(
			seen.some((event) => event.type === "permission"),
			"the backend never asked — Caret's boundary was never consulted",
		)
		return "edit refused, file unchanged"
	})

	await scenario("e. sessions are listable for the history panel", async () => {
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
			console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name.padEnd(56)} ${result.detail}`)
		}
		const failed = results.filter((r) => !r.passed)
		console.log("================================================")
		console.log(
			failed.length === 0 ? `CERTIFIED: all ${results.length} scenarios pass` : `${failed.length} scenario(s) FAILED`,
		)
		process.exit(failed.length === 0 ? 0 : 1)
	})

/**
 * Certifies Caret against a **real MCP client**, not against JSON-RPC we wrote.
 *
 * `verify:app` exercises the protocol by hand, which proves the transport and
 * the auth but says nothing about whether a client can actually connect —
 * different things fail there: the documented `mcp add` command may be wrong,
 * session semantics may not match, protocol negotiation may pick a version we
 * do not answer, and a tool that blocks for minutes waiting on a human may be
 * abandoned by a client timeout.
 *
 * That last one is the real risk. `present_question` deliberately holds the
 * request open until somebody clicks, and the entire foundation interview
 * depends on a client tolerating that.
 *
 * Requires the `claude` CLI on PATH and an authenticated session. It costs real
 * inference, so it is a separate script rather than part of `verify:app`.
 *
 *   npx tsx scripts/verify-mcp-client.ts
 */
import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { type ElectronApplication, _electron as electron } from "playwright"
import { promisify } from "util"

import { ensureCaretDirectoryExists } from "../src/core/design/scaffold"

const exec = promisify(child_process.exec)

interface ScenarioResult {
	name: string
	passed: boolean
	detail: string
}

const results: ScenarioResult[] = []
let app: ElectronApplication | null = null
let fixture = ""
let registered = false

function log(message: string): void {
	console.log(`[verify-mcp] ${message}`)
}

/** `--only=7` or `--only=5,7` runs a subset. Every scenario costs real inference. */
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean)

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
	if (ONLY.length > 0 && !ONLY.some((n) => name.startsWith(`${n}.`))) {
		log(`SKIP ${name}`)
		return
	}
	try {
		const detail = await run()
		results.push({ name, passed: true, detail })
		log(`PASS ${name}`)
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err)
		results.push({ name, passed: false, detail })
		log(`FAIL ${name} — ${detail}`)
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

/** Runs a `claude` command in the fixture, returning stdout+stderr either way. */
async function claude(args: string, timeoutMs = 180_000): Promise<string> {
	try {
		const { stdout, stderr } = await exec(`claude ${args}`, { cwd: fixture, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 20 })
		return `${stdout}\n${stderr}`
	} catch (err: any) {
		// Non-zero exit still carries useful output; the assertions decide.
		return `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`
	}
}

const PAGE_SOURCE = `export default function Pricing() {
  return (
    <div className="min-h-screen bg-zinc-950 p-12">
      <h1 data-caret-id="pricing-title" className="text-5xl font-bold text-white">Pricing</h1>
    </div>
  )
}
`

/**
 * A word that exists in the fixture ONLY as character codes, so it is not
 * present as a string anywhere on disk. Random per run, so it cannot be
 * memorised or guessed. An agent that reports it back has read pixels.
 */
const VISION_WORD = `ZEPHYR${Math.floor(Math.random() * 9000 + 1000)}`

function visionPageSource(word: string): string {
	const codes = [...word].map((c) => c.charCodeAt(0)).join(",")
	return `export default function Vision() {
  const word = [${codes}].map((c) => String.fromCharCode(c)).join("")
  return (
    <div data-caret-id="vision-root" className="min-h-screen bg-white p-24">
      <h1 data-caret-id="vision-word" className="text-7xl font-bold text-black">{word}</h1>
    </div>
  )
}
`
}

async function buildFixture(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-mcpclient-"))
	await ensureCaretDirectoryExists(dir)

	const visionDir = path.join(dir, ".caret", "pages", "vision")
	await fs.mkdir(visionDir, { recursive: true })
	await fs.writeFile(path.join(visionDir, "index.tsx"), visionPageSource(VISION_WORD))
	await fs.writeFile(
		path.join(visionDir, "meta.json"),
		JSON.stringify({ id: "vision", title: "Vision", type: "page", states: ["default"], tags: [] }, null, 2),
	)

	// One page with a distinctive id, so the agent reporting it back is evidence
	// it actually read this project rather than answering plausibly.
	const pageDir = path.join(dir, ".caret", "pages", "pricing")
	await fs.mkdir(pageDir, { recursive: true })
	await fs.writeFile(path.join(pageDir, "index.tsx"), PAGE_SOURCE)
	await fs.writeFile(
		path.join(pageDir, "meta.json"),
		JSON.stringify({ id: "pricing", title: "Pricing", type: "page", states: ["default"], tags: ["marketing"] }, null, 2),
	)

	const git = (args: string) => child_process.execSync(`git ${args}`, { cwd: dir, stdio: "ignore" })
	git("init -q")
	git("config user.email caret@local")
	git("config user.name Caret")
	git("config commit.gpgSign false")
	git("add -A")
	git('commit -q -m "fixture" --no-verify')
	return dir
}

async function readDiscovery(): Promise<{ url: string; token: string } | null> {
	try {
		return JSON.parse(await fs.readFile(path.join(fixture, ".caret", ".mcp.json"), "utf-8"))
	} catch {
		return null
	}
}

/**
 * A raw JSON-RPC call, used only to establish preconditions. Everything being
 * *certified* here goes through the real client; this is for asking the server
 * "are you ready yet" without spending inference on the answer.
 */
async function rawCall(discovery: { url: string; token: string }, body: unknown): Promise<string> {
	const response = await fetch(discovery.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${discovery.token}`,
		},
		body: JSON.stringify(body),
	})
	return response.text()
}

const RAW_INIT = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "caret-verify", version: "0" } },
}

async function waitFor<T>(label: string, check: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await check()
		if (value) return value
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

async function main(): Promise<void> {
	fixture = await buildFixture()
	log(`fixture at ${fixture}`)

	app = await electron.launch({ args: [path.resolve("out/main/index.js"), fixture] })
	const discovery = await waitFor("the MCP discovery file", readDiscovery, 120_000)
	log(`server at ${discovery.url}`)

	await scenario("1. the documented `claude mcp add` command works verbatim", async () => {
		// Exactly the string Caret shows in its Connect-an-agent panel. If this
		// drifts from what the CLI accepts, the panel is worse than useless.
		const command = `mcp add --transport http caret ${discovery.url} --header "Authorization: Bearer ${discovery.token}" --scope local`
		const output = await claude(command, 60_000)
		assert(/added|success/i.test(output), `mcp add did not report success: ${output.slice(0, 400)}`)
		registered = true
		return "the command in the UI and docs is accepted as written"
	})

	await scenario("2. the client health-checks the server as connected", async () => {
		const output = await claude("mcp get caret", 90_000)
		assert(!/failed|error|✘/i.test(output), `health check reported a problem: ${output.slice(0, 500)}`)
		assert(/connect/i.test(output), `no connection status reported: ${output.slice(0, 500)}`)
		return output.replace(/\s+/g, " ").trim().slice(0, 90)
	})

	await scenario("3. a real agent lists Caret's tools", async () => {
		const output = await claude(
			`-p "List the names of the MCP tools available to you from the caret server. Output only the names, comma separated." --allowed-tools "mcp__caret__get_project"`,
		)
		for (const tool of ["get_project", "get_guide", "present_question", "commit_foundation"]) {
			assert(output.includes(tool), `${tool} missing from what the client sees: ${output.slice(0, 500)}`)
		}
		return "the client sees the read, write and interview tools"
	})

	await scenario("4. a real agent calls a tool and gets this project's data", async () => {
		// The page id is distinctive, so reporting it is evidence the tool actually
		// ran rather than the model answering plausibly.
		const output = await claude(
			`-p "Use the caret MCP server's get_project tool and tell me the id of every design page. Output only the ids." --allowed-tools "mcp__caret__get_project"`,
		)
		assert(output.includes("pricing"), `the agent did not report this project's page: ${output.slice(0, 600)}`)
		return "get_project returned real project data through a real client"
	})

	await scenario("5. a tool that blocks on a human is not abandoned by the client", async () => {
		// The riskiest unknown. `present_question` holds the request open until
		// somebody clicks, which is minutes in the worst case. If a client times
		// that out, the whole foundation interview is broken by design.
		const chrome = await app!.firstWindow()
		await chrome.waitForSelector('[data-testid="top-bar"]', { timeout: 60_000 })

		const agent = claude(
			`-p "Use the caret MCP server's present_question tool to ask the user: 'What are you building?' with choices 'A tool people work in all day' and 'Something people read'. Then report exactly which one they chose." --allowed-tools "mcp__caret__present_question"`,
		)

		await chrome.waitForSelector('[data-testid="interview-question"]', { timeout: 120_000 })

		// Deliberately slow. A fast click would not distinguish "the client waits"
		// from "the client happened not to time out yet".
		log("question rendered — waiting 45s before answering, to test client patience")
		await chrome.waitForTimeout(45_000)
		await chrome.locator('[data-testid="interview-choice"]', { hasText: "Something people read" }).click()

		const output = await agent
		assert(
			output.includes("Something people read"),
			`the agent did not receive the answer after a 45s wait: ${output.slice(0, 600)}`,
		)
		return "client held the call open 45s+ and received the user's answer"
	})

	await scenario("6. a real agent runs the WHOLE interview and commits a foundation", async () => {
		// The scenarios above call one tool each with inputs this script chose.
		// That is not the feature. The feature is a multi-turn loop in which the
		// agent decides what to ask, infers the vibe tags ITSELF, chains
		// present_question → present_options → commit_foundation, and lands on a
		// real foundation. The agent's own tag vocabulary is the risky part: tags
		// that match nothing used to return the first three candidates in
		// declaration order, which is indistinguishable from a real narrowing.
		const chrome = await app!.firstWindow()

		// Start from no foundation, so the agent has a genuine job to do.
		await fs.rm(path.join(fixture, ".caret", "tokens", "foundation.json"), { force: true })

		const agent = claude(
			`-p "Set up this project's visual foundations using the caret MCP server. Run its foundation interview: ask the user a few questions with present_question, then show them options with present_options, then commit what they pick with commit_foundation. Report what was committed." ` +
				`--allowed-tools "mcp__caret__present_question" "mcp__caret__present_options" "mcp__caret__commit_foundation" "mcp__caret__get_project"`,
			600_000,
		)

		// Answer whatever it asks, for as long as it keeps asking. The point is
		// that the loop runs to completion, not that it asks any particular thing.
		let questions = 0
		let picks = 0
		const deadline = Date.now() + 540_000

		while (Date.now() < deadline) {
			const question = chrome.locator('[data-testid="interview-choice"]').first()
			const candidate = chrome.locator('[data-testid="interview-candidate"]').first()

			const which = await Promise.race([
				question
					.waitFor({ timeout: 20_000 })
					.then(() => "question" as const)
					.catch(() => null),
				candidate
					.waitFor({ timeout: 20_000 })
					.then(() => "candidate" as const)
					.catch(() => null),
			])

			if (which === "question") {
				await question.click()
				questions++
			} else if (which === "candidate") {
				await candidate.click()
				picks++
			} else if (picks > 0) {
				break // it showed options, we picked, and it has stopped asking
			}

			// The agent has finished if it committed and the run resolved.
			const settled = await Promise.race([agent.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))])
			if (settled) break
		}

		const output = await agent
		assert(questions > 0, `the agent never asked anything: ${output.slice(0, 500)}`)
		assert(picks > 0, `the agent never presented options to pick from: ${output.slice(0, 500)}`)

		// The decisive assertion is on disk: a foundation that matches a real
		// library entry, not something the model invented.
		const tokens = await waitFor(
			"the committed foundation",
			async () => {
				try {
					return JSON.parse(await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8"))
				} catch {
					return null
				}
			},
			60_000,
		)

		const { TYPEFACE_PAIRINGS, SHAPE_PRESETS } = await import("../src/core/design/foundation-library")
		const families = new Set(TYPEFACE_PAIRINGS.map((t) => t.body.family))
		assert(
			families.has(tokens.typography?.fontFamily),
			`committed a typeface that is not in the curated library: ${tokens.typography?.fontFamily}`,
		)
		assert(
			SHAPE_PRESETS.some((preset) => preset.baseSize === tokens.typography?.baseSize),
			`committed a base size no preset produces: ${tokens.typography?.baseSize}`,
		)
		assert(Object.keys(tokens.color?.brand?.scale ?? {}).length === 11, "the brand scale was not derived")

		// And the rules files every future session reads must reflect it.
		const rules = await waitFor(
			"the regenerated rules",
			async () => {
				const text = await fs.readFile(path.join(fixture, "AGENTS.md"), "utf-8").catch(() => "")
				return text.includes(tokens.color.brand.seed) ? text : null
			},
			60_000,
		)
		assert(rules.includes(tokens.typography.fontFamily), "the committed typeface never reached the rules files")

		return `${questions} question(s), ${picks} pick(s) → ${tokens.typography.fontFamily} @ ${tokens.typography.baseSize}px, seed ${tokens.color.brand.seed}`
	})

	await scenario("7. the connected agent can actually SEE a rendered page", async () => {
		// Caret returns MCP `image` content from get_screenshot, but a server
		// emitting image blocks proves nothing on its own: the CLIENT decides what
		// reaches the model, and a client that drops or stringifies the block would
		// look identical from here. Everything visual — the overlay editor,
		// judging a generated asset, checking its own work — rests on this being
		// true, so it is asserted against a real client rather than assumed.
		//
		// The controls: the word is on the page only as character codes, it is
		// random per run, and the agent is allowed no tool but get_screenshot, so
		// it cannot read the file. Reporting it back means it read pixels.
		//
		// Screenshots load offscreen from the design session's URL, so Vite has to
		// be up first — without this wait the tool refuses and the scenario fails
		// for a reason that has nothing to do with vision.
		const chrome = await app!.firstWindow()
		await chrome.waitForSelector('[data-testid="top-bar"]', { timeout: 60_000 })
		await waitFor(
			"the design session to be able to screenshot",
			async () => {
				await rawCall(discovery, RAW_INIT)
				await rawCall(discovery, { jsonrpc: "2.0", method: "notifications/initialized" })
				const body = await rawCall(discovery, {
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "get_screenshot", arguments: { pageId: "vision" } },
				})
				if (body.includes('"type":"image"')) return true
				log(`  canvas not ready yet: ${body.replace(/\s+/g, " ").slice(-120)}`)
				return null
			},
			600_000,
		)

		const output = await claude(
			`-p "Call the caret MCP server's get_screenshot tool with pageId 'vision'. Then tell me the single word printed in large text on that page, and the background colour. If you cannot see the image, say NO_IMAGE." ` +
				`--allowed-tools "mcp__caret__get_screenshot"`,
			300_000,
		)
		assert(!/NO_IMAGE/.test(output), `the client did not deliver the image to the model: ${output.slice(0, 600)}`)
		assert(
			output.toUpperCase().includes(VISION_WORD),
			`the agent could not read the rendered word "${VISION_WORD}": ${output.slice(0, 600)}`,
		)
		return `agent read "${VISION_WORD}" off the rendered pixels — vision works end to end`
	})
}

async function cleanup(): Promise<void> {
	if (registered) {
		await claude("mcp remove caret --scope local", 30_000).catch(() => {})
	}
	await app?.close().catch(() => {})
	if (fixture) await fs.rm(fixture, { recursive: true, force: true }).catch(() => {})
}

main()
	.catch((err) => results.push({ name: "harness", passed: false, detail: String(err) }))
	.finally(async () => {
		await cleanup()
		console.log("\n========== CARET × REAL MCP CLIENT ==========")
		for (const r of results) console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name.padEnd(58)} ${r.detail}`)
		const failed = results.filter((r) => !r.passed)
		console.log("=============================================")
		console.log(
			failed.length === 0 ? `CERTIFIED: all ${results.length} scenarios pass` : `${failed.length} scenario(s) FAILED`,
		)
		process.exit(failed.length === 0 ? 0 : 1)
	})

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

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
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

async function buildFixture(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-mcpclient-"))
	await ensureCaretDirectoryExists(dir)

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

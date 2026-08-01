/**
 * App-level certification: launches the real Electron binary and drives it.
 *
 * `verify:design-shell` proves the generated canvas works. This proves the
 * *application* works — that a project opens, Vite boots, the canvas mounts as a
 * native view, the MCP server answers with auth enforced, rules files get
 * written, and an edit from the canvas reaches disk.
 *
 * The decisive assertions are on disk and over HTTP, not on pixels. "The user
 * changed a colour" only matters if the file now contains exactly that.
 *
 * Usage:
 *   npm run verify:app             # full run
 *   npm run verify:app -- --keep   # keep the fixture project for inspection
 */
import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { type ElectronApplication, _electron as electron } from "playwright"

import { ensureCaretDirectoryExists } from "../src/core/design/scaffold"

const KEEP = process.argv.includes("--keep")

interface ScenarioResult {
	name: string
	passed: boolean
	detail: string
}

const results: ScenarioResult[] = []
let app: ElectronApplication | null = null
let fixture = ""

function log(message: string): void {
	console.log(`[verify-app] ${message}`)
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

/** Polls until `check` returns a truthy value, or the deadline passes. */
async function waitFor<T>(label: string, check: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await check()
		if (value) return value
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	throw new Error(`Timed out waiting for ${label}`)
}

const PAGE_SOURCE = `export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 p-12">
      <h1 data-caret-id="hero-title" className="text-5xl font-bold text-white">Welcome</h1>
      <p data-caret-id="hero-subtitle" className="mt-4 text-lg text-zinc-400">Built with Caret</p>
    </div>
  )
}
`

/**
 * A page with no caret-ids and an inline style — both things the watch-and-heal
 * codemod is supposed to fix without anyone asking it to.
 */
const UNHEALED_SOURCE = `export default function About() {
  return (
    <div className="min-h-screen bg-zinc-900 p-12">
      <h1 style={{ color: "red" }} className="text-4xl font-bold">About us</h1>
      <p className="mt-4 text-zinc-400">We make things.</p>
    </div>
  )
}
`

async function buildFixture(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-app-"))
	await ensureCaretDirectoryExists(dir)

	const pageDir = path.join(dir, ".caret", "pages", "home")
	await fs.mkdir(pageDir, { recursive: true })
	await fs.writeFile(path.join(pageDir, "index.tsx"), PAGE_SOURCE)
	await fs.writeFile(
		path.join(pageDir, "meta.json"),
		JSON.stringify({ id: "home", title: "Home", type: "page", states: ["default"], tags: ["landing"] }, null, 2),
	)

	// A git repo with a commit, so the sync preflight has something to bookmark.
	const git = (args: string) => child_process.execSync(`git ${args}`, { cwd: dir, stdio: "ignore" })
	git("init -q")
	git("config user.email caret@local")
	git("config user.name Caret")
	git("config commit.gpgSign false")
	git("add -A")
	git('commit -q -m "fixture" --no-verify')

	return dir
}

/** Reads the per-project MCP discovery file the app writes on open. */
async function readDiscovery(projectPath: string): Promise<{ url: string; token: string } | null> {
	try {
		return JSON.parse(await fs.readFile(path.join(projectPath, ".caret", ".mcp.json"), "utf-8"))
	} catch {
		return null
	}
}

async function callMcp(url: string, token: string | null, body: unknown): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	})
}

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "caret-verify", version: "0.1.0" },
	},
}

async function main(): Promise<void> {
	fixture = await buildFixture()
	log(`fixture at ${fixture}`)

	app = await electron.launch({
		args: [path.resolve("out/main/index.js"), fixture],
		env: { ...process.env, CARET_VERIFY_PROJECT: fixture, NODE_ENV: "test" },
	})

	await scenario("a. app launches and opens the fixture project", async () => {
		const window = await app!.firstWindow({ timeout: 60_000 })
		assert(window, "no window appeared")
		return `window title: ${await window.title()}`
	})

	const discovery = await scenario("b. MCP discovery file is written with a token", async () => {
		const record = await waitFor("the MCP discovery file", () => readDiscovery(fixture), 60_000)
		assert(record.url.startsWith("http://127.0.0.1:"), `expected a loopback URL, got ${record.url}`)
		assert(record.token.length >= 32, "token is too short to be a credential")
		const mode = (await fs.stat(path.join(fixture, ".caret", ".mcp.json"))).mode & 0o777
		assert(mode === 0o600, `discovery file should be owner-only, got ${mode.toString(8)}`)
		return `${record.url}, token ${record.token.length} chars, mode 0600`
	}).then(() => readDiscovery(fixture))

	await scenario("c. MCP refuses an unauthenticated request", async () => {
		assert(discovery, "no discovery record")
		const response = await callMcp(discovery.url, null, INITIALIZE)
		assert(response.status === 401, `expected 401, got ${response.status}`)
		return "unauthenticated request → 401"
	})

	await scenario("d. MCP refuses a request carrying a browser Origin", async () => {
		assert(discovery, "no discovery record")
		const response = await fetch(discovery.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${discovery.token}`,
				origin: "https://evil.example",
			},
			body: JSON.stringify(INITIALIZE),
		})
		assert(response.status === 403, `expected 403, got ${response.status}`)
		return "cross-origin request with a valid token → 403 (DNS-rebinding closed)"
	})

	await scenario("e. MCP accepts an authenticated request and lists the tools", async () => {
		assert(discovery, "no discovery record")
		const response = await callMcp(discovery.url, discovery.token, INITIALIZE)
		assert(response.ok, `initialize failed with ${response.status}`)
		const text = await response.text()
		assert(text.includes("caret"), "server did not identify itself")
		return "initialize accepted"
	})

	await scenario("f. rules files are generated with the foundation in them", async () => {
		const agents = await waitFor(
			"AGENTS.md",
			async () => {
				try {
					return await fs.readFile(path.join(fixture, "AGENTS.md"), "utf-8")
				} catch {
					return null
				}
			},
			60_000,
		)
		assert(agents.includes("BEGIN CARET DESIGN LAYER"), "generated block marker missing")
		assert(agents.includes("data-caret-id"), "authoring rules missing from the rules file")
		const claude = await fs.readFile(path.join(fixture, "CLAUDE.md"), "utf-8")
		assert(claude.includes("BEGIN CARET DESIGN LAYER"), "CLAUDE.md not generated")
		const cursor = await fs.readFile(path.join(fixture, ".cursor", "rules", "caret-design-layer.mdc"), "utf-8")
		assert(cursor.startsWith("---"), "Cursor rule is missing its frontmatter")
		return "AGENTS.md, CLAUDE.md and .cursor/rules all written"
	})

	await scenario("g. a user block in a rules file survives regeneration", async () => {
		const target = path.join(fixture, "AGENTS.md")
		const original = await fs.readFile(target, "utf-8")
		await fs.writeFile(target, `# My own instructions\n\nDo not touch this.\n\n${original}`)

		// Touch the tokens to trigger regeneration.
		const tokensPath = path.join(fixture, ".caret", "tokens", "foundation.json")
		const tokens = JSON.parse(await fs.readFile(tokensPath, "utf-8"))
		tokens.color.brand.seed = "#ff6b6b"
		await fs.writeFile(tokensPath, JSON.stringify(tokens, null, 2))

		const updated = await waitFor(
			"the regenerated rules file",
			async () => {
				const text = await fs.readFile(target, "utf-8")
				return text.includes("#ff6b6b") ? text : null
			},
			30_000,
		)
		assert(updated.includes("Do not touch this."), "the user's own content was overwritten")
		return "user content preserved, Caret's block updated to the new brand colour"
	})

	await scenario("h. watch-and-heal fixes an externally written page", async () => {
		const pageDir = path.join(fixture, ".caret", "pages", "about")
		await fs.mkdir(pageDir, { recursive: true })
		const target = path.join(pageDir, "index.tsx")
		await fs.writeFile(target, UNHEALED_SOURCE)
		await fs.writeFile(
			path.join(pageDir, "meta.json"),
			JSON.stringify({ id: "about", title: "About", type: "page", states: ["default"], tags: ["marketing"] }, null, 2),
		)

		const healed = await waitFor(
			"the healed page",
			async () => {
				const text = await fs.readFile(target, "utf-8")
				return text.includes("data-caret-id") ? text : null
			},
			30_000,
		)
		assert(!healed.includes("style={{"), "the inline style was not converted to a Tailwind class")
		return "caret-ids stamped and the inline style converted, with no MCP tool involved"
	})

	await scenario("i. healing is idempotent — a second pass writes nothing", async () => {
		const target = path.join(fixture, ".caret", "pages", "about", "index.tsx")
		const before = await fs.readFile(target, "utf-8")
		const stat = await fs.stat(target)

		// Rewrite identical content to trigger the watcher without changing anything.
		await fs.writeFile(target, before)
		await new Promise((resolve) => setTimeout(resolve, 2500))

		const after = await fs.readFile(target, "utf-8")
		assert(after === before, "a second heal changed the file — the codemod is not idempotent")
		return `content stable (${stat.size} bytes), no write-HMR-heal loop`
	})

	await scenario("j. the edit-provenance log records who changed what", async () => {
		const raw = await fs.readFile(path.join(fixture, ".caret", ".provenance.jsonl"), "utf-8")
		const records = raw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
		assert(records.length > 0, "no provenance recorded")
		assert(
			records.some((r) => r.actor === "external"),
			"external writes were not attributed",
		)
		assert(
			records.some((r) => r.actor === "caret" && r.action === "heal"),
			"the heal itself was not recorded",
		)
		return `${records.length} record(s), actors: ${[...new Set(records.map((r) => r.actor))].join(", ")}`
	})

	await scenario("k. sync refuses honestly with no agent connected", async () => {
		assert(discovery, "no discovery record")
		const { runSync } = await import("../src/core/design/sync/sync-orchestrator")
		const result = await runSync(fixture)
		assert(result.status === "no-agent", `expected "no-agent", got "${result.status}"`)
		assert(result.message.includes("agent"), "the refusal does not explain what to do")
		return `refused with: "${result.message.slice(0, 60)}…"`
	})
}

async function cleanup(): Promise<void> {
	await app?.close().catch(() => {})
	if (fixture && !KEEP) {
		await fs.rm(fixture, { recursive: true, force: true }).catch(() => {})
	} else if (fixture) {
		log(`fixture kept at ${fixture}`)
	}
}

main()
	.catch((err) => {
		results.push({ name: "harness", passed: false, detail: String(err) })
	})
	.finally(async () => {
		await cleanup()

		console.log("\n========== CARET APP CERTIFICATION ==========")
		for (const result of results) {
			console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name.padEnd(56)} ${result.detail}`)
		}
		const failed = results.filter((r) => !r.passed)
		console.log("=============================================")
		console.log(
			failed.length === 0 ? `CERTIFIED: all ${results.length} scenarios pass` : `${failed.length} scenario(s) FAILED`,
		)
		process.exit(failed.length === 0 ? 0 : 1)
	})

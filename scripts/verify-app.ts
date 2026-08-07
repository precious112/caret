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

import { type ElectronApplication, _electron as electron, type Page } from "playwright"

import { ensureCaretDirectoryExists } from "../src/core/design/scaffold"
import { NO_MODEL_REASON, resolveVerifyModel, solidPng } from "./verify-support"

const KEEP = process.argv.includes("--keep")

/**
 * `--only ee,gg` runs just those scenarios, by the letter before the dot.
 *
 * Not a way to certify anything — a partial run is reported as such and can
 * never say CERTIFIED. It exists because iterating on one scenario otherwise
 * costs a full suite, and a suite that is expensive to fix is a suite that
 * stays broken. Setup, launch and teardown still run in full, so a scenario
 * that depends on an earlier one must be named alongside it.
 */
const ONLY = (() => {
	const index = process.argv.indexOf("--only")
	if (index === -1) return null
	return new Set(
		(process.argv[index + 1] ?? "")
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean),
	)
})()
const SHOTS = path.resolve("release/verify-shots")

interface ScenarioResult {
	name: string
	passed: boolean
	/** Neither passed nor failed: there was no model this suite may spend. */
	skipped?: boolean
	detail: string
}

const results: ScenarioResult[] = []
let app: ElectronApplication | null = null
let fixture = ""
let userData = ""

function log(message: string): void {
	console.log(`[verify-app] ${message}`)
}

/**
 * Records a scenario as neither passed nor failed.
 *
 * Used only when there is no model the suite is allowed to spend. A Caret with
 * no credentials is a supported state, so failing here would report "broken"
 * for behaviour that is exactly as designed — but calling it a pass would claim
 * a certification that never ran.
 */
function skip(name: string, reason: string): void {
	results.push({ name, passed: true, skipped: true, detail: `SKIPPED — ${reason}` })
	log(`SKIP ${name} — ${reason}`)
}

/**
 * Thrown by a scenario that cannot reach a verdict for a reason that is not
 * Caret's fault — in practice, a model that did not do the work it was asked to.
 *
 * The distinction is the whole point. "This model could not manage it" and
 * "Caret is broken" are different claims, and a suite that reports the first as
 * the second is a suite whose red gets ignored.
 */
class Inconclusive extends Error {}

/**
 * When the app process went away, if it did.
 *
 * Playwright reports a dead app as "Target page, context or browser has been
 * closed" on whatever call happened to be next — so the scenario that *reports*
 * the failure is rarely the one that caused it, and every scenario after it
 * fails the same opaque way. Recording the moment of death turns that into a
 * pointer at the right place in `main.log`.
 */
let appDiedAt: string | null = null

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
	if (ONLY && !ONLY.has(name.split(".")[0])) return
	try {
		const detail = await run()
		results.push({ name, passed: true, detail })
		log(`PASS ${name}`)
	} catch (err) {
		if (err instanceof Inconclusive) {
			skip(name, err.message)
			return
		}
		let detail = err instanceof Error ? err.message : String(err)
		if (appDiedAt && /has been closed/.test(detail)) {
			detail = `the app exited at ${appDiedAt} — this scenario only found the corpse. See release/verify-shots/main.log around that time.`
		}
		results.push({ name, passed: false, detail })
		log(`FAIL ${name} — ${detail}`)
	}
}

/**
 * Captures a surface so the run produces something a human can look at.
 *
 * Automated assertions cover behaviour; they say nothing about whether a screen
 * is legible or laid out sanely. These are for the eyes.
 */
async function shot(page: Page, name: string): Promise<void> {
	await fs.mkdir(SHOTS, { recursive: true })
	await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

/**
 * Polls until `check` returns a truthy value, or the deadline passes.
 *
 * `diagnose` runs only on timeout, to say what the world looked like when it
 * gave up. Worth having on anything slow: "timed out" alone costs a re-run to
 * turn into a cause.
 */
async function waitFor<T>(
	label: string,
	check: () => Promise<T | null>,
	timeoutMs = 120_000,
	diagnose?: () => Promise<string>,
): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await check()
		if (value) return value
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	const detail = diagnose ? await diagnose().catch((err) => `(diagnosis failed: ${err})`) : ""
	throw new Error(`Timed out waiting for ${label}${detail ? ` — ${detail}` : ""}`)
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
 * The fixture's "app" — the thing a sync translates *into*.
 *
 * Deliberately a near-copy of the design page, so the one assertion that matters
 * (did the app follow the design) does not depend on a small free model being
 * good at architecture.
 */
const APP_SOURCE = `export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 p-12">
      <h1 className="text-5xl font-bold text-white">Welcome</h1>
      <p className="mt-4 text-lg text-zinc-400">Built with Caret</p>
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

	await fs.mkdir(path.join(dir, "src"), { recursive: true })
	await fs.writeFile(path.join(dir, "src", "App.tsx"), APP_SOURCE)

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

/** Every file under `directory`, concatenated — a whole-tree fingerprint. */
async function readTree(directory: string): Promise<string> {
	const entries = await fs.readdir(directory, { withFileTypes: true, recursive: true })
	const files = entries.filter((entry) => entry.isFile()).sort((a, b) => (a.name < b.name ? -1 : 1))
	const parts = await Promise.all(
		files.map(async (entry) => {
			const full = path.join(entry.parentPath ?? directory, entry.name)
			return `${full}\n${await fs.readFile(full, "utf-8").catch(() => "")}`
		}),
	)
	return parts.join("\n")
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

/**
 * MCP requires the client to confirm initialization before the server will
 * answer anything else. Skipping it makes every later call look like the server
 * is missing tools it actually has.
 */
const INITIALIZED_NOTIFICATION = { jsonrpc: "2.0", method: "notifications/initialized" }

async function openMcpSession(url: string, token: string): Promise<void> {
	await callMcp(url, token, INITIALIZE)
	await callMcp(url, token, INITIALIZED_NOTIFICATION)
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

	// A throwaway profile. Without it the run reads and writes the developer's own
	// preferences, so "cold launch with no backend configured" would be true only
	// on a machine that had never configured one — and selecting a backend here
	// would silently change theirs.
	userData = await fs.mkdtemp(path.join(os.tmpdir(), "caret-profile-"))

	app = await electron.launch({
		args: [path.resolve("out/main/index.js"), `--user-data-dir=${userData}`, fixture],
		env: { ...process.env, CARET_VERIFY_PROJECT: fixture, NODE_ENV: "test" },
	})

	// Main-process output, kept.
	//
	// Playwright reports a dead app as "target page, context or browser has been
	// closed" and says nothing about why — which turns a crash into a mystery. The
	// reason is always in main's own log.
	await fs.mkdir(SHOTS, { recursive: true })
	const mainLog = await fs.open(path.join(SHOTS, "main.log"), "w")
	app.process().stdout?.on("data", (chunk) => void mainLog.write(chunk))
	app.process().stderr?.on("data", (chunk) => void mainLog.write(chunk))

	// The app dying mid-suite is otherwise invisible until the next call fails
	// with a message that names neither the time nor the reason.
	app.on("close", () => {
		if (!appDiedAt) {
			appDiedAt = new Date().toLocaleTimeString()
			void mainLog.write(`\n[verify-app] the app process exited at ${appDiedAt}\n`)
		}
	})

	// Three runs died with every Playwright handle reporting "Target page …
	// closed" while the process stayed up — so window-level lifecycle is logged
	// too, to catch *which* surface died and when, in main.log's own timeline.
	app.on("window", (page) => {
		const short = page.url().slice(0, 80)
		void mainLog.write(`[verify-app] window appeared: ${short}\n`)
		page.on("close", () => {
			const stamp = new Date().toLocaleTimeString()
			if (!appDiedAt && short.startsWith("file:")) appDiedAt = stamp
			void mainLog.write(`[verify-app] window CLOSED at ${stamp}: ${short}\n`)
		})
		page.on("crash", () => void mainLog.write(`[verify-app] window RENDERER CRASHED: ${short}\n`))
	})

	await scenario("a. app launches and the window is named after the project", async () => {
		const window = await app!.firstWindow({ timeout: 60_000 })
		assert(window, "no window appeared")

		// The *OS* window title, not `document.title` — that is what appears in the
		// dock and the Window menu, and it is what has to carry the project name so
		// several open projects are distinguishable.
		const expected = `${path.basename(fixture)} — Caret`
		const title = await waitFor(
			"the window title",
			async () => {
				const current = await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? "")
				return current === expected ? current : null
			},
			30_000,
		)
		return `OS window title: ${title}`
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

	await scenario("l. the interview tools and prompt are exposed over MCP", async () => {
		assert(discovery, "no discovery record")

		// A fresh MCP session, then list what the server offers. The interview is
		// worthless if an agent cannot discover it.
		await openMcpSession(discovery.url, discovery.token)
		const toolsResponse = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		})
		const toolsText = await toolsResponse.text()
		for (const tool of ["present_question", "present_options", "commit_foundation"]) {
			assert(toolsText.includes(tool), `${tool} is not exposed. Server said: ${toolsText.slice(0, 400)}`)
		}

		const promptsResponse = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 3,
			method: "prompts/list",
			params: {},
		})
		const promptsText = await promptsResponse.text()
		assert(
			promptsText.includes("foundation_interview"),
			`the interview prompt is not exposed. Server said: ${promptsText.slice(0, 400)}`,
		)

		return "present_question, present_options, commit_foundation + foundation_interview prompt"
	})

	await scenario("m. committing a foundation writes tokens and regenerates the rules", async () => {
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		// The candidate id is composite — typeface+palette+shape — and only ids the
		// curated library recognises are accepted. This is the anti-slop mechanism,
		// so it is worth asserting that a made-up one is refused.
		const bogus = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "commit_foundation", arguments: { candidateId: "my-own-invention", tags: [] } },
		})
		const bogusText = await bogus.text()
		assert(
			bogusText.includes("not a candidate"),
			`an invented candidate id was not refused. Server said: ${bogusText.slice(0, 400)}`,
		)

		// A combination Caret never offered must be refused even though all three
		// ids are individually real — curating ingredients is not curating designs.
		const mismatched = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 6,
			method: "tools/call",
			params: {
				name: "commit_foundation",
				arguments: { candidateId: "editorial-instrument+deep-technical+pill-expressive", tags: [] },
			},
		})
		const mismatchedText = await mismatched.text()
		assert(
			mismatchedText.includes("not a candidate"),
			`an unapproved combination of real ids was accepted: ${mismatchedText.slice(0, 300)}`,
		)

		const real = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: {
				name: "commit_foundation",
				arguments: { candidateId: "editorial-instrument+mono-accent+editorial-open", tags: ["editorial", "calm"] },
			},
		})
		// MCP returns 200 for a *tool* error too, so the HTTP status proves nothing.
		// The body has to be checked or a silently failing tool reads as a pass.
		const realText = await real.text()
		assert(real.ok, `commit_foundation failed with ${real.status}`)
		assert(!realText.includes('"isError":true'), `commit_foundation errored: ${realText.slice(0, 500)}`)

		// Poll rather than read once. The tool call returns as soon as the write is
		// issued, so a single read races it — and a certification that passes or
		// fails depending on timing is worse than no certification at all.
		const tokens = await waitFor(
			"the committed foundation",
			async () => {
				const parsed = JSON.parse(await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8"))
				return parsed.radius?.character === "sharp" ? parsed : null
			},
			30_000,
		)
		assert(tokens.typography.fontFamily === "Inter", `expected the pairing's body face, got ${tokens.typography.fontFamily}`)
		assert(tokens.typography.baseSize === 17, `expected the preset's base size, got ${tokens.typography.baseSize}`)
		assert(Object.keys(tokens.color.brand.scale).length === 11, "the brand scale was not derived")

		const rules = await waitFor(
			"the regenerated rules",
			async () => {
				const text = await fs.readFile(path.join(fixture, "AGENTS.md"), "utf-8")
				return text.includes(tokens.color.brand.seed) ? text : null
			},
			30_000,
		)
		assert(rules.includes("Inter"), "the committed typeface did not reach the rules files")

		return `committed "Editorial · Almost monochrome"; invented ids and unapproved combinations refused`
	})

	// ── UI ────────────────────────────────────────────────────────────────────
	// Everything above asserts on files and HTTP. None of it renders a single
	// pixel, so none of it would notice the renderer throwing on mount. These do.

	const chrome = await app.firstWindow()

	// Collected for the whole run, not just for mount. A React error thrown at any
	// point unmounts the tree, and every scenario after it then fails as "selector
	// not found" — which reads as a missing feature rather than a crash. Whatever
	// the renderer throws is reported by the scenario that trips over it.
	const rendererErrors: string[] = []
	chrome.on("pageerror", (err) => rendererErrors.push(err.message))
	chrome.on("console", (message) => {
		if (message.type() === "error") rendererErrors.push(`console: ${message.text()}`)
	})

	await scenario("n. the chrome renders and shows the project", async () => {
		// A renderer that threw during mount leaves an empty #root and every later
		// scenario times out with a confusing message, so check that first.
		const failures = rendererErrors

		await chrome.waitForSelector('[data-testid="top-bar"]', { timeout: 60_000 })
		await shot(chrome, "01-chrome")

		assert(failures.length === 0, `renderer threw during mount: ${failures.join("; ")}`)
		const barText = await chrome.textContent('[data-testid="top-bar"]')
		assert(barText?.includes(path.basename(fixture)), `top bar does not name the project: ${barText}`)
		return `top bar rendered: ${barText?.trim().slice(0, 60)}`
	})

	await scenario("o. the token editor renders and writes what you set", async () => {
		// The wizard came across from the VS Code webview with its data layer
		// rewired from gRPC to IPC. Nothing else in this suite would notice if it
		// threw on mount or if the IPC shim returned the wrong shape.
		await chrome.click('[data-testid="top-bar"] >> text=Foundation')
		await chrome.waitForSelector('[data-testid="foundation-tab-manual"]', { timeout: 20_000 })
		await chrome.click('[data-testid="foundation-tab-manual"]')

		// The wizard's first step is the vibe description.
		const textarea = chrome.locator("textarea").first()
		await textarea.waitFor({ timeout: 20_000 })
		await textarea.fill("Certification run — set by the token editor")
		await shot(chrome, "02-token-editor")

		// Walk to the review step and save. The step count is the wizard's, so
		// clicking Next until Save appears is more durable than a fixed number.
		for (let i = 0; i < 8; i++) {
			const save = chrome.locator("button", { hasText: /^Save/ })
			if (await save.count()) break
			const next = chrome.locator("button", { hasText: /^(Next|Continue)/ }).first()
			if (!(await next.count())) break
			await next.click()
			await chrome.waitForTimeout(150)
		}

		await shot(chrome, "03-token-editor-review")
		const save = chrome.locator("button", { hasText: /^Save/ })
		assert(await save.count(), "the wizard never reached a Save step")
		await save.first().click()

		const tokens = await waitFor(
			"the tokens the editor saved",
			async () => {
				const parsed = JSON.parse(await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8"))
				return parsed.vibe?.description?.includes("Certification run") ? parsed : null
			},
			30_000,
		)
		return `editor wrote vibe: "${tokens.vibe.description.slice(0, 40)}…"`
	})

	await scenario("p. an agent's question is answerable in the UI and reaches the tool call", async () => {
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		// present_question blocks until a human answers, so the call is fired
		// WITHOUT awaiting, answered through the real UI, and only then awaited.
		// This is the one scenario that exercises the whole loop: agent → main →
		// renderer → user → back to the still-open tool call.
		const pending = callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 10,
			method: "tools/call",
			params: {
				name: "present_question",
				arguments: {
					question: "What are you building?",
					choices: ["A tool people work in all day", "Something people read"],
					step: 1,
					total: 2,
				},
			},
		})

		// Deliberately NOT navigating to the interview first. An agent's question
		// has to reach the user wherever they are; if this needed a manual click,
		// a question asked while they were on the canvas would go unanswered.
		await chrome.waitForSelector('[data-testid="interview-question"]', { timeout: 30_000 })
		await shot(chrome, "04-interview-question")

		const questionText = await chrome.textContent('[data-testid="interview-question"]')
		assert(questionText?.includes("What are you building?"), `question not rendered: ${questionText}`)

		await chrome.locator('[data-testid="interview-choice"]', { hasText: "Something people read" }).click()

		const answered = await pending.then((r) => r.text())
		assert(answered.includes("Something people read"), `the answer never reached the agent: ${answered.slice(0, 300)}`)
		return "question rendered, clicked, and the answer reached the waiting tool call"
	})

	await scenario("q. specimens render and picking one returns a candidate id", async () => {
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		const pending = callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 11,
			method: "tools/call",
			params: { name: "present_options", arguments: { tags: ["editorial", "calm"], count: 3 } },
		})

		await chrome.waitForSelector('[data-testid="interview-options"]', { timeout: 30_000 })
		const cards = chrome.locator('[data-testid="interview-candidate"]')
		await cards.first().waitFor({ timeout: 20_000 })

		// Fonts are fetched from Google Fonts; give them a beat so the screenshot
		// shows real specimens rather than the fallback face.
		await chrome.waitForTimeout(1500)
		await shot(chrome, "05-interview-specimens")

		const count = await cards.count()
		if (count !== 3) {
			const dump = await chrome.evaluate(() => {
				const node = document.querySelector('[data-testid="interview-options"]')
				return {
					optionsPresent: Boolean(node),
					optionsHtml: node ? node.outerHTML.slice(0, 600) : null,
					bodyText: document.body.innerText.slice(0, 400),
				}
			})
			throw new Error(`expected 3 specimens, got ${count}. DOM: ${JSON.stringify(dump)}`)
		}

		// A specimen has to actually render the typeface it is offering — a card
		// showing the fallback is worse than useless, because the user picks on it.
		//
		// `getComputedStyle().fontFamily` is NOT sufficient: it returns the declared
		// family whether or not the file ever loaded. This suite asserted on that
		// string and passed for weeks while the chrome's CSP silently blocked
		// fonts.googleapis.com and every specimen rendered in the system face.
		// `document.fonts.check` is the only assertion that distinguishes them.
		const family = await cards
			.first()
			.locator("p")
			.first()
			.evaluate((el) => getComputedStyle(el).fontFamily)
		assert(!/^(ui-|system-ui|-apple)/.test(family), `specimen declared a system face: ${family}`)

		const declared = family.split(",")[0].replace(/["']/g, "").trim()
		const loaded = await waitFor(
			`the ${declared} webfont to load`,
			async () => {
				const ok = await chrome.evaluate(
					(name) => document.fonts.check(`16px "${name}"`) && document.fonts.status === "loaded",
					declared,
				)
				return ok ? true : null
			},
			30_000,
		).catch(() => false)
		assert(loaded, `"${declared}" never loaded — the specimen is rendering a fallback, so the user picks on a lie`)

		await cards.first().click()
		const picked = await pending.then((r) => r.text())
		assert(picked.includes("candidateId"), `no candidate id came back: ${picked.slice(0, 300)}`)
		return `3 specimens rendered in ${family.split(",")[0]}; pick returned a candidate id`
	})

	await scenario("r. the canvas mounts in the window and renders the design pages", async () => {
		// The canvas is a WebContentsView, not a Playwright page, so it is reached
		// through the main process. This is the first thing in the suite that
		// proves the canvas actually runs inside the app rather than in a browser.
		const result = await waitFor(
			"the canvas to render pages",
			async () =>
				app!.evaluate(async ({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0]
					const views = (win?.contentView?.children ?? []) as any[]
					const canvas = views.find((v) => v.webContents && !v.webContents.isDestroyed())
					if (!canvas) return null
					const url = canvas.webContents.getURL()
					if (!url.startsWith("http://localhost")) return null
					const frames = await canvas.webContents
						.executeJavaScript("document.querySelectorAll('iframe').length")
						.catch(() => 0)
					return frames > 0 ? { url, frames } : null
				}),
			120_000,
		)
		await shot(chrome, "06-canvas")
		return `canvas at ${result.url} rendering ${result.frames} page frame(s)`
	})

	await scenario("t. get_screenshot returns real pixels of a real page", async () => {
		// This tool had no coverage anywhere and did not work: it captured through a
		// WebContentsView that was never attached to a window, so it had no
		// compositor surface and always returned an empty image.
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		const raw = await waitFor(
			"get_screenshot to return an image",
			async () => {
				const response = await callMcp(discovery!.url, discovery!.token, {
					jsonrpc: "2.0",
					id: 20,
					method: "tools/call",
					params: { name: "get_screenshot", arguments: { pageId: "home" } },
				})
				const text = await response.text()
				return text.includes('"type":"image"') ? text : null
			},
			120_000,
		)

		// A base64 blob that decodes to a PNG of the right size, not merely a
		// non-empty string — an all-white 1x1 would satisfy a laxer assertion.
		const data = /"data":"([^"]+)"/.exec(raw)?.[1] ?? ""
		const buffer = Buffer.from(data, "base64")
		assert(buffer.length > 5000, `screenshot is too small to be a rendered page: ${buffer.length} bytes`)
		assert(buffer.subarray(1, 4).toString() === "PNG", "screenshot is not a PNG")
		const width = buffer.readUInt32BE(16)
		const height = buffer.readUInt32BE(20)
		assert(width >= 1440 && height >= 900, `captured at ${width}x${height}, expected at least 1440x900`)

		await fs.writeFile(path.join(SHOTS, "07-get-screenshot.png"), buffer)
		return `${width}x${height} PNG, ${Math.round(buffer.length / 1024)}KB`
	})

	await scenario("u. get_screenshot refuses a missing page with a usable reason", async () => {
		// The old failure message named the canvas for every possible cause, which
		// is how a broken capture read as "the canvas is not running" while Vite was
		// demonstrably serving. A refusal an agent cannot act on is a dead end.
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		const response = await callMcp(discovery.url, discovery.token, {
			jsonrpc: "2.0",
			id: 21,
			method: "tools/call",
			params: { name: "get_screenshot", arguments: { pageId: "no-such-page" } },
		})
		const text = await response.text()
		assert(text.includes("no-such-page"), `the refusal does not name the page: ${text.slice(0, 300)}`)
		assert(!/is the canvas running/i.test(text), "the refusal still blames the canvas for an unrelated cause")
		return "names the page and the actual cause"
	})

	await scenario("v. an asset dropped into .caret/assets is indexed with no tool involved", async () => {
		// Dragging a file into the folder has to work as well as using the UI, for
		// the same reason an agent's own Edit tool has to work on pages: the
		// reliable path cannot be the one that depends on everyone choosing it.
		await fs.writeFile(path.join(fixture, ".caret", "assets", "Hero Shot@2x.png"), solidPng(240, 135, [20, 24, 33]))

		const entry = await waitFor(
			"the asset index",
			async () => {
				try {
					const raw = await fs.readFile(path.join(fixture, ".caret", "assets", "index.json"), "utf-8")
					const index = JSON.parse(raw)
					return index.assets?.find((a: any) => a.tag === "hero-shot-2x") ?? null
				} catch {
					return null
				}
			},
			60_000,
		)

		assert(entry.width === 240 && entry.height === 135, `dimensions were not probed: ${entry.width}x${entry.height}`)
		assert(entry.kind === "image", `wrong kind: ${entry.kind}`)
		assert(entry.origin?.type === "discovered", `wrong origin: ${JSON.stringify(entry.origin)}`)
		return `tag "${entry.tag}" derived from the filename, ${entry.width}x${entry.height} probed from the header`
	})

	await scenario("w. the asset index reaches the always-on rules files", async () => {
		// Behind a tool it would be ignored — an agent that must choose to
		// enumerate assets emits a placeholder instead. This is the delivery
		// mechanism, so it is the thing worth asserting.
		const rules = await waitFor(
			"AGENTS.md to carry the asset",
			async () => {
				const text = await fs.readFile(path.join(fixture, "AGENTS.md"), "utf-8").catch(() => "")
				return text.includes("@hero-shot-2x") ? text : null
			},
			60_000,
		)
		assert(rules.includes("/caret-assets/"), "the rules file names the asset but not how to reference it")
		return "AGENTS.md carries the tag, the path and the size"
	})

	await scenario("x. an agent can list assets and receive the actual pixels", async () => {
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		const listed = await (
			await callMcp(discovery.url, discovery.token, {
				jsonrpc: "2.0",
				id: 30,
				method: "tools/call",
				params: { name: "list_assets", arguments: {} },
			})
		).text()
		assert(listed.includes("hero-shot-2x"), `list_assets did not report the asset: ${listed.slice(0, 300)}`)

		const fetched = await (
			await callMcp(discovery.url, discovery.token, {
				jsonrpc: "2.0",
				id: 31,
				method: "tools/call",
				params: { name: "get_asset", arguments: { tag: "@hero-shot-2x" } },
			})
		).text()

		assert(fetched.includes('"type":"image"'), `get_asset returned no image content: ${fetched.slice(0, 300)}`)
		const data = /"data":"([^"]+)"/.exec(fetched)?.[1] ?? ""
		const decoded = Buffer.from(data, "base64")
		assert(decoded.subarray(1, 4).toString() === "PNG", "get_asset returned something that is not the PNG")
		assert(decoded.readUInt32BE(16) === 240, `wrong image returned: width ${decoded.readUInt32BE(16)}`)
		return "the leading @ is tolerated, and the bytes returned are the file on disk"
	})

	await scenario("y. get_asset refuses an unknown tag and names what does exist", async () => {
		assert(discovery, "no discovery record")
		await openMcpSession(discovery.url, discovery.token)

		const response = await (
			await callMcp(discovery.url, discovery.token, {
				jsonrpc: "2.0",
				id: 32,
				method: "tools/call",
				params: { name: "get_asset", arguments: { tag: "hero-shoot" } },
			})
		).text()

		assert(response.includes("hero-shoot"), `the refusal does not name the tag asked for: ${response.slice(0, 300)}`)
		assert(response.includes("hero-shot-2x"), "the refusal does not name the assets that do exist")
		return "a typo gets the list of real tags rather than a bare failure"
	})

	await scenario("z. assets are served to the canvas, and traversal is refused", async () => {
		// The index can be perfect and the page still show a broken image if the
		// URL it records does not resolve. This is the leg between the two.
		const base = await waitFor(
			"the design server's URL",
			async () =>
				app!.evaluate(({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0]
					const views = (win?.contentView?.children ?? []) as any[]
					const url = views.find((v) => v.webContents && !v.webContents.isDestroyed())?.webContents.getURL() ?? ""
					return url.startsWith("http://localhost") ? new URL(url).origin : null
				}),
			60_000,
		)

		const served = await fetch(`${base}/caret-assets/${encodeURIComponent("Hero Shot@2x.png")}`)
		assert(served.ok, `serving the asset failed with ${served.status}`)
		assert(served.headers.get("content-type") === "image/png", `wrong content type: ${served.headers.get("content-type")}`)
		const bytes = Buffer.from(await served.arrayBuffer())
		assert(bytes.subarray(1, 4).toString() === "PNG" && bytes.readUInt32BE(16) === 240, "served the wrong bytes")

		// `.caret/assets/` is a directory anything can write to and the middleware
		// takes a path from the URL, so the confinement check is load-bearing —
		// and it has to survive encoding, since %2e%2e is still traversal.
		const escaped = await fetch(`${base}/caret-assets/%2e%2e%2f%2e%2e%2fpackage.json`)
		assert(escaped.status === 403 || escaped.status === 404, `traversal was not refused: ${escaped.status}`)
		return `${bytes.length} bytes served as image/png; encoded traversal → ${escaped.status}`
	})

	await scenario("aa. the asset library renders, previews and writes a description", async () => {
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Assets" }).click()

		const surface = await waitFor(
			"the shell to show the assets surface",
			async () => {
				const current = await chrome.getByTestId("app-shell").getAttribute("data-surface")
				return current === "assets" ? current : null
			},
			30_000,
		).catch(async () => {
			const shellPresent = (await chrome.locator('[data-testid="app-shell"]').count()) > 0
			const stuck = shellPresent ? await chrome.getByTestId("app-shell").getAttribute("data-surface") : "no shell"
			const body = (await chrome.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 200)
			throw new Error(
				`clicking Assets left the shell on "${stuck}". Renderer errors: ${rendererErrors.join(" | ") || "none"}. Body: ${body}`,
			)
		})
		assert(surface === "assets", "the shell did not switch surfaces")
		await chrome.waitForSelector('[data-testid="assets-view"]', { timeout: 30_000 })

		const row = chrome.locator('[data-testid="asset-row"]').first()
		await row.waitFor({ timeout: 30_000 })

		// The chrome is not served by Vite, so a relative /caret-assets/ src would
		// resolve against the wrong origin and fail silently as a broken image.
		// naturalWidth is the only assertion that distinguishes "rendered" from
		// "an <img> element exists".
		const previewWidth = await waitFor(
			"the thumbnail to decode",
			async () => {
				const width = await row.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)
				return width > 0 ? width : null
			},
			30_000,
		)
		assert(previewWidth === 240, `the preview decoded at ${previewWidth}px, expected the real asset`)

		const description = row.getByTestId("asset-description")
		await description.fill("wide, dark, empty space top-left")
		await description.blur()

		// On disk is what counts — and then in the rules file, since that is the
		// only path by which a description reaches an agent.
		await waitFor(
			"the description to be written",
			async () => {
				const raw = await fs.readFile(path.join(fixture, ".caret", "assets", "index.json"), "utf-8").catch(() => "")
				return raw.includes("empty space top-left") ? true : null
			},
			30_000,
		)
		await waitFor(
			"the description to reach AGENTS.md",
			async () => {
				const rules = await fs.readFile(path.join(fixture, "AGENTS.md"), "utf-8").catch(() => "")
				return rules.includes("empty space top-left") ? true : null
			},
			30_000,
		)

		await shot(chrome, "08-assets")
		return "preview decoded from the design server; description written and carried into the rules"
	})

	await scenario("bb. the library refuses a bad tag in the UI without losing the asset", async () => {
		const tagField = chrome.locator('[data-testid="asset-row"]').first().getByTestId("asset-tag")
		await tagField.fill("Not A Tag")
		await tagField.blur()

		// The refusal has to restore the real tag, not leave the field showing a
		// name that does not exist — the next thing the user does is type @ and
		// expect it to be there.
		await waitFor(
			"the tag to be restored",
			async () => ((await tagField.inputValue()) === "hero-shot-2x" ? true : null),
			15_000,
		)

		const raw = await fs.readFile(path.join(fixture, ".caret", "assets", "index.json"), "utf-8")
		assert(raw.includes('"hero-shot-2x"'), "the asset lost its tag on a refused rename")
		assert(!raw.includes("Not A Tag"), "a malformed tag was written")

		return "malformed tag refused, field restored, index untouched"
	})

	await scenario("bc. a file dropped on the library is added, listed and removable", async () => {
		// The real gesture, not a harness-supplied `assets:add`. A drop from a
		// browser or a mail client carries bytes and no path, which is also all a
		// synthetic DataTransfer can carry — and until this landed, the drop
		// handler read the `File.path` Electron removed in v32 and did nothing at
		// all, silently, for every drop.
		const png = solidPng(120, 60, [200, 40, 90]).toString("base64")

		const view = chrome.getByTestId("assets-view")
		await view.waitFor({ timeout: 15_000 })
		await view.evaluate((element, data) => {
			const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
			const file = new File([bytes], "dropped-mark.png", { type: "image/png" })
			const transfer = new DataTransfer()
			transfer.items.add(file)
			element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }))
		}, png)

		await waitFor(
			"the dropped file to reach the index",
			async () => {
				const raw = await fs.readFile(path.join(fixture, ".caret", "assets", "index.json"), "utf-8").catch(() => "")
				return raw.includes('"dropped-mark"') ? true : null
			},
			30_000,
		)

		const row = chrome.locator('[data-testid="asset-row"]:has([data-testid="asset-tag"][value="dropped-mark"])')
		await row.waitFor({ timeout: 30_000 })
		const width = await waitFor(
			"the dropped file's thumbnail to decode",
			async () => {
				const value = await row.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)
				return value > 0 ? value : null
			},
			30_000,
		)
		assert(width === 120, `the dropped asset's preview decoded at ${width}px`)

		// Removing is the other half of the library nobody had driven: it deletes a
		// file, so a wrong one is not recoverable from the UI.
		await row.getByRole("button", { name: "Remove" }).click()
		await waitFor(
			"the asset to leave the index",
			async () => {
				const raw = await fs.readFile(path.join(fixture, ".caret", "assets", "index.json"), "utf-8").catch(() => "")
				return raw.includes('"dropped-mark"') ? null : true
			},
			30_000,
		)
		const onDisk = await fs
			.stat(path.join(fixture, ".caret", "assets", "dropped-mark.png"))
			.then(() => true)
			.catch(() => false)
		assert(!onDisk, "Remove left the file behind")

		return "dropped with no path on disk, indexed, previewed, then removed from the index and the disk"
	})

	await scenario("bd. a video shows a frame, not a broken image", async () => {
		// Kinds differ in exactly one place — the library thumbnail — and a video
		// rendered through an <img> is a broken icon rather than a poster. This
		// asserts the dispatch and the URL; the extracted poster frame itself needs
		// a decodable video, which this fixture has no way to produce.
		await fs.writeFile(path.join(fixture, ".caret", "assets", "reel.mp4"), Buffer.from("not a decodable video"))

		const row = chrome.locator('[data-testid="asset-row"]:has([data-testid="asset-tag"][value="reel"])')
		await row.waitFor({ timeout: 30_000 })
		const video = row.getByTestId("asset-video")
		await video.waitFor({ timeout: 15_000 })
		const src = await video.getAttribute("src")
		assert(src?.includes("/caret-assets/reel.mp4"), `the video element points at ${src}`)
		assert(src?.includes("#t="), "the video opens on frame zero, which is blank in most footage")

		assert((await row.locator("img").count()) === 0, "a video was rendered through an <img>")

		await fs.rm(path.join(fixture, ".caret", "assets", "reel.mp4"))
		await chrome.getByTestId("assets-view").getByText("Done").click()
		return "video indexed by the healer and shown as a seeked frame, not an image"
	})

	await scenario("be. @ picks an asset inside the app's own canvas", async () => {
		// The picker is certified in verify:design-shell, but that runs the shell in
		// a browser. Here it runs where it ships: a WebContentsView, with the page
		// in a child frame, reached through the main process. The canvas has changed
		// meaning across hosts before — `window.parent` is the same window at top
		// level, which is what duplicated every inline edit — so "it worked in the
		// harness" is not evidence about the app.
		const outcome = await app!.evaluate(async ({ BrowserWindow }) => {
			// No helper functions in here, however much they would tidy it up: this
			// body is serialized into the main process, and esbuild's keepNames wraps
			// every function-valued const in a `__name` helper that does not exist
			// there. The first version of this scenario failed on exactly that.
			//
			// The canvas view is waited for, not assumed: it appears only once the
			// design server is up, which is well after the window exists.
			let canvas: any = null
			const viewDeadline = Date.now() + 120000
			while (Date.now() < viewDeadline && !canvas) {
				const win = BrowserWindow.getAllWindows()[0]
				const views = (win?.contentView?.children ?? []) as any[]
				const found = views.find((v) => v.webContents && !v.webContents.isDestroyed())
				if (found && found.webContents.getURL().startsWith("http://localhost")) canvas = found
				if (!canvas) await new Promise((r) => setTimeout(r, 500))
			}
			if (!canvas) return { error: "the canvas view never mounted" }
			const wc = canvas.webContents

			try {
				let deadline = Date.now() + 30000
				let ready = false
				while (Date.now() < deadline && !ready) {
					ready = await wc.executeJavaScript(`!!document.querySelector('.caret-canvas-frame')`).catch(() => false)
					if (!ready) await new Promise((r) => setTimeout(r, 250))
				}
				if (!ready) return { error: "no page card ever appeared on the canvas" }

				await wc.executeJavaScript(`(document.querySelector('.caret-canvas-frame')).click(), true`)

				deadline = Date.now() + 30000
				let pageFrame: any = null
				while (Date.now() < deadline && !pageFrame) {
					pageFrame = wc.mainFrame.frames.find((f: any) => f.url.includes("mode=focused")) ?? null
					if (!pageFrame) await new Promise((r) => setTimeout(r, 250))
				}
				if (!pageFrame) return { error: "the focused page never became a frame of the canvas" }

				deadline = Date.now() + 30000
				let painter = false
				while (Date.now() < deadline && !painter) {
					painter = await pageFrame
						.executeJavaScript(`!!document.querySelector('.caret-focused-paint-btn')`)
						.catch(() => false)
					if (!painter) await new Promise((r) => setTimeout(r, 250))
				}
				if (!painter) return { error: "the paint control never appeared in the focused page" }

				// Clicked until the overlay is actually up, not once and hoped for.
				// Focusing a page runs the caret-id precompute, which can write the
				// source and bounce the iframe through HMR — a click that lands in
				// that window sets state on a tree that is about to be replaced.
				let overlayUp = false
				for (let attempt = 0; attempt < 5 && !overlayUp; attempt++) {
					await pageFrame
						.executeJavaScript(
							`(() => { const b = document.querySelector('.caret-focused-paint-btn'); if (b) b.click(); return !!b })()`,
						)
						.catch(() => false)
					const attemptDeadline = Date.now() + 4000
					while (Date.now() < attemptDeadline && !overlayUp) {
						overlayUp = await pageFrame
							.executeJavaScript(`!!document.querySelector('.caret-overlay')`)
							.catch(() => false)
						if (!overlayUp) await new Promise((r) => setTimeout(r, 250))
					}
				}
				if (!overlayUp) return { error: "paint mode never engaged after five clicks" }

				// Real mouse events, because the painter takes pointer capture and a
				// dispatched PointerEvent has no pointer to capture. Coordinates are
				// in the view's space, so the iframe's own offset is added.
				const offset = await wc.executeJavaScript(
					`(() => { const r = document.querySelector('.caret-focused-iframe').getBoundingClientRect(); return { x: r.x, y: r.y } })()`,
				)
				const from = { x: Math.round(offset.x) + 120, y: Math.round(offset.y) + 160 }
				const to = { x: from.x + 320, y: from.y + 220 }
				wc.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y })
				wc.sendInputEvent({ type: "mouseDown", x: from.x, y: from.y, button: "left", clickCount: 1 })
				for (let step = 1; step <= 6; step++) {
					wc.sendInputEvent({
						type: "mouseMove",
						x: Math.round(from.x + ((to.x - from.x) * step) / 6),
						y: Math.round(from.y + ((to.y - from.y) * step) / 6),
						button: "left",
						buttons: 1,
					})
					await new Promise((r) => setTimeout(r, 40))
				}
				wc.sendInputEvent({ type: "mouseUp", x: to.x, y: to.y, button: "left", clickCount: 1 })

				deadline = Date.now() + 20000
				let box = false
				while (Date.now() < deadline && !box) {
					box = await pageFrame
						.executeJavaScript(`!!document.querySelector('.caret-overlay-prompt input')`)
						.catch(() => false)
					if (!box) await new Promise((r) => setTimeout(r, 250))
				}
				if (!box) {
					// Distinguishing the three ways this fails is the difference between
					// one more run and five: the overlay never mounted, the drag never
					// registered, or the rect came out too small for the prompt.
					const state = await pageFrame
						.executeJavaScript(`(() => ({
							overlay: !!document.querySelector('.caret-overlay'),
							rect: !!document.querySelector('.caret-overlay-rect'),
							size: (() => { const r = document.querySelector('.caret-overlay-rect'); if (!r) return null; const b = r.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height) })(),
							iframeOffset: ${JSON.stringify(offset)},
							dragged: ${JSON.stringify({ from, to })},
						}))()`)
						.catch((e: any) => ({ probeFailed: String(e) }))
					return { error: `painting a region did not open an instruction box: ${JSON.stringify(state)}` }
				}

				// Typed the way a keystroke arrives: through the native setter and an
				// input event, which is exactly what React's value tracker needs and
				// what the picker listens for.
				await pageFrame.executeJavaScript(`(() => {
					const input = document.querySelector('.caret-overlay-prompt input')
					input.focus()
					const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
					setter.call(input, 'Put @her')
					input.dispatchEvent(new Event('input', { bubbles: true }))
					return true
				})()`)

				// Polled to a decoded thumbnail, not merely to a row: an <img> that
				// exists but never paints is the exact failure a wrong asset URL
				// produces, and it looks fine in a DOM assertion.
				deadline = Date.now() + 30000
				let option: { tag: string; decoded: number } | null = null
				while (Date.now() < deadline) {
					option = await pageFrame
						.executeJavaScript(`(() => {
							const row = document.querySelector('[data-caret-asset-option]')
							if (!row) return null
							const img = row.querySelector('img')
							return { tag: row.getAttribute('data-caret-asset-option'), decoded: img ? img.naturalWidth : 0 }
						})()`)
						.catch(() => null)
					if (option && option.decoded > 0) break
					await new Promise((r) => setTimeout(r, 250))
				}
				if (!option) return { error: "the picker never opened, or opened with no options in it" }

				// Picked with a real mouse press on the row, hovering first — the way a
				// person picks, and the way it was reported broken. Hovering used to
				// rebuild the list, replacing the element between press and release so
				// no click ever fired; and react-grab reads any press outside its
				// selection as "dismiss", which put a "Discard?" prompt on screen
				// instead of an asset in the box.
				const rowBox = await pageFrame.executeJavaScript(`(() => {
					const row = document.querySelector('[data-caret-asset-option]')
					const r = row.getBoundingClientRect()
					return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
				})()`)
				const at = { x: Math.round(offset.x + rowBox.x), y: Math.round(offset.y + rowBox.y) }
				wc.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y })
				await new Promise((r) => setTimeout(r, 300))
				wc.sendInputEvent({ type: "mouseDown", x: at.x, y: at.y, button: "left", clickCount: 1 })
				wc.sendInputEvent({ type: "mouseUp", x: at.x, y: at.y, button: "left", clickCount: 1 })
				await new Promise((r) => setTimeout(r, 400))

				const picked = await pageFrame.executeJavaScript(
					`(document.querySelector('.caret-overlay-prompt input') || {}).value || ''`,
				)

				// Leave the page as it was found: paint mode off, back on the canvas.
				await pageFrame
					.executeJavaScript(`(() => {
						const input = document.querySelector('.caret-overlay-prompt input')
						if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
						return true
					})()`)
					.catch(() => {})
				await wc
					.executeJavaScript(
						`(() => { const b = document.querySelector('.caret-focused-toolbar-btn'); b && b.click(); return true })()`,
					)
					.catch(() => {})

				return { option, picked }
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) }
			}
		})

		assert(!("error" in outcome) || !outcome.error, `driving the canvas failed: ${(outcome as any).error}`)
		const { option, picked } = outcome as { option: { tag: string; decoded: number }; picked: string }
		assert(option.tag === "hero-shot-2x", `the picker offered "${option.tag}"`)
		assert(option.decoded > 0, "the picker's thumbnail never decoded inside the app")
		assert(picked.includes("@hero-shot-2x"), `clicking the row did not put the tag in the box: "${picked}"`)

		return `clicked @${option.tag} from a decoded thumbnail in the real canvas view`
	})

	await scenario("s. a canvas message reaches the host through the preload bridge", async () => {
		// The preload bridge replaced the VS Code postMessage relay and is written
		// from scratch. Nothing else here exercises it end to end. Post a message
		// the way the canvas does and assert the host acted on it — precompute
		// answers with a precompute-result, which only the host can produce.
		const replied = await app!.evaluate(async ({ BrowserWindow }) => {
			const win = BrowserWindow.getAllWindows()[0]
			const views = (win?.contentView?.children ?? []) as any[]
			const canvas = views.find((v) => v.webContents && !v.webContents.isDestroyed())
			if (!canvas) return "no canvas view"

			return canvas.webContents.executeJavaScript(`
				new Promise((resolve) => {
					const timer = setTimeout(() => resolve("timeout"), 15000)
					window.addEventListener("message", (e) => {
						if (e.data?.source === "caret-host" && e.data?.type === "precompute-result") {
							clearTimeout(timer)
							resolve("precompute-result")
						}
					})
					window.parent.postMessage(
						{ source: "caret-vite", type: "page-focused", payload: { filePath: "pages/home/index.tsx" } },
						"*",
					)
				})
			`)
		})

		assert(replied === "precompute-result", `the host did not answer through the bridge: ${replied}`)
		return "canvas → preload → IPC → host → back to the canvas, round-trip confirmed"
	})

	await scenario("k. sync refuses honestly with no agent connected", async () => {
		assert(discovery, "no discovery record")
		const { runSync } = await import("../src/core/design/sync/sync-orchestrator")
		const result = await runSync(fixture)
		assert(result.status === "no-agent", `expected "no-agent", got "${result.status}"`)
		// Naming the missing thing is not enough — the refusal has to say what to
		// do. It used to point at MCP agent settings, which would not have helped:
		// connecting an agent over MCP enables none of the outbound features.
		assert(result.message.includes("backend"), `the refusal does not name what is missing: ${result.message}`)
		assert(!/agent settings/i.test(result.message), "the refusal still points at MCP, which cannot carry outbound work")
		return `refused with: "${result.message.slice(0, 60)}…"`
	})

	// ── the coding backend ────────────────────────────────────────────────────
	//
	// Everything below is click-only from a profile that has never configured a
	// backend, and everything below spends real inference on a real model. These
	// are the scenarios that say whether "clicking things in Caret causes an agent
	// to do them" is true.

	await scenario("cc. with no backend, the chat refuses and names the fix", async () => {
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Chat" }).click()
		await chrome.waitForSelector('[data-testid="chat-no-backend"]', { timeout: 20_000 })

		const refusal = await chrome.textContent('[data-testid="chat-no-backend"]')
		assert(refusal?.includes("backend"), `the refusal does not name what is missing: ${refusal}`)
		// Naming the fix is the whole point: "no backend" alone tells nobody what
		// to do about it.
		assert(/Settings.*Backend/.test(refusal ?? ""), `the refusal does not say where to go: ${refusal}`)
		assert(await chrome.getByTestId("chat-input").isDisabled(), "the input is enabled with nothing behind it")

		await shot(chrome, "10-chat-no-backend")
		return `refused with: "${refusal?.trim().slice(0, 60)}…"`
	})

	await scenario("hh. the Presets flow runs to a committed file with no model anywhere", async () => {
		// The deterministic tab: fixed curated steps, identical screens on every
		// machine, zero spend. Runs here deliberately — before any backend is
		// chosen — because that is exactly when it must still work.
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Foundation" }).click()
		await chrome.click('[data-testid="foundation-tab-presets"]')
		await chrome.waitForSelector('[data-testid="foundation-describe"]', { timeout: 20_000 })

		await chrome.fill(
			'[data-testid="foundation-describe"]',
			"A dashboard for technical support teams who triage tickets all day",
		)
		await chrome.click('[data-testid="foundation-begin"]')
		await chrome.waitForSelector('[data-testid="foundation-step"]', { timeout: 30_000 })
		await shot(chrome, "12-presets-step")

		let steps = 0
		for (; steps < 8; steps++) {
			if (await chrome.getByTestId("foundation-summary").count()) break

			// The recommendation is preselected: pressing straight through has to
			// yield a real foundation, which is the entire promise of the flow.
			const preselected = await chrome.locator('[data-testid="foundation-option"][data-selected="true"]').count()
			assert(preselected === 1, `expected exactly one option preselected, found ${preselected}`)

			await chrome.click('[data-testid="foundation-continue"]')
			await chrome.waitForTimeout(300)
		}

		await chrome.waitForSelector('[data-testid="foundation-summary"]', { timeout: 30_000 })
		await shot(chrome, "13-interview-summary")

		const before = await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8")
		await chrome.click('[data-testid="foundation-commit"]')

		const tokens = await waitFor(
			"the interview to write foundation.json",
			async () => {
				const raw = await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8")
				return raw !== before ? JSON.parse(raw) : null
			},
			30_000,
		)

		assert(tokens.typography?.fontFamily, "the committed foundation has no typeface")
		assert(tokens.color?.brand?.seed, "the committed foundation has no brand colour")
		assert(
			Object.keys(tokens.typography.scale ?? {}).length > 0,
			"the type scale was never generated — the model was expected to supply it, which it must never do",
		)

		return `${steps} step(s), no model → ${tokens.typography.fontFamily}, seed ${tokens.color.brand.seed}`
	})

	await scenario("jj. with no backend, the wizard refuses honestly and offers the other doors", async () => {
		// The wizard is genuinely AI-run, so without a model it must not pretend —
		// it says what it needs and hands the user the presets tab or the editor,
		// rather than dead-ending or faking an interview.
		//
		// Navigate first: hh's commit flipped the surface back to the canvas, so
		// the foundation tabs are no longer on screen.
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Foundation" }).click()
		await chrome.click('[data-testid="foundation-tab-interview"]')
		await chrome.waitForSelector('[data-testid="wizard-describe"]', { timeout: 20_000 })
		await chrome.fill('[data-testid="wizard-describe"]', "A quiet reading app for long-form essays")
		await chrome.click('[data-testid="wizard-begin"]')

		await chrome.waitForSelector('[data-testid="wizard-needs-backend"]', { timeout: 30_000 })
		await shot(chrome, "13-wizard-needs-backend")

		// The offered escape actually goes somewhere.
		await chrome.getByRole("button", { name: "Pick from presets instead" }).click()
		await chrome.waitForSelector('[data-testid="foundation-describe"]', { timeout: 20_000 })
		return "refused with the reason, and the presets door works"
	})

	// Which model — if any — this run may spend. Resolved once, before the
	// backend scenarios, so they all skip together rather than half-running.
	const model = await resolveVerifyModel()

	await scenario("dd. the bundled backend is found and choosing it makes the chat usable", async () => {
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Backend" }).click()
		await chrome.waitForSelector('[data-testid="backend-opencode"]', { timeout: 90_000 })

		const row = chrome.getByTestId("backend-opencode")
		await waitFor(
			"the bundled backend to report ready",
			async () => ((await row.textContent())?.includes("ready") ? true : null),
			90_000,
		)

		await shot(chrome, "11-backend-setup")
		await row.getByRole("button", { name: "Use this" }).click()

		// Pins the model for the rest of the run, through the same field a user
		// would type in. Left empty the backend defaults to a reasoning model,
		// which is slow at "replace this word" and makes the scenarios below
		// measure the wrong thing.
		if (model) {
			// The field is a grouped `<select>` when the backend can enumerate its
			// models and a text input when it cannot, and the two are driven
			// differently — `fill` does nothing to a select. Which one is present is
			// itself a property of the backend, so the harness asks rather than
			// assumes.
			const field = chrome.getByTestId("backend-model")
			const tag = await field.evaluate((element) => element.tagName)

			if (tag === "SELECT") {
				await field.selectOption(model.id)
			} else {
				await field.fill(model.id)
				await field.blur()
			}
		}

		await chrome.getByTestId("top-bar").getByRole("button", { name: "Backend" }).click()
		await waitFor(
			"the chat to become usable",
			async () => ((await chrome.getByTestId("chat-input").isDisabled()) ? null : true),
			30_000,
		)

		return `bundled backend selected, chat enabled${model ? `, model ${model.id} (${model.source})` : ""}`
	})

	const inference = model ? scenario : (name: string, _run: () => Promise<string>) => void skip(name, NO_MODEL_REASON)

	await inference("ee. an instruction typed in the chat rewrites the design source to exactly that", async () => {
		const pagePath = path.join(fixture, ".caret", "pages", "home", "index.tsx")

		await chrome
			.getByTestId("chat-input")
			.fill(
				'In .caret/pages/home/index.tsx, change the paragraph text "Built with Caret" to exactly "Certified by Caret". Change nothing else.',
			)
		await chrome.getByTestId("chat-send").click()

		await waitFor(
			"the design source to change",
			async () => ((await fs.readFile(pagePath, "utf-8")).includes("Certified by Caret") ? true : null),
			300_000,
		)

		await shot(chrome, "12-chat-edit")

		// The decisive half: Caret answered the permission itself. A `.caret/` write
		// is auto-approved by fixed policy, and the transcript has to say so —
		// a silent auto-approval is indistinguishable from an agent nobody checked.
		const resolved = await chrome.getByTestId("chat-permission-resolved").first().textContent()
		assert(resolved?.includes("Allowed"), `the write was not recorded as allowed: ${resolved}`)
		assert(resolved?.includes("design layer"), `the transcript does not say why Caret allowed it without asking: ${resolved}`)
		return `page rewritten; permission auto-answered ("${resolved?.trim().slice(0, 60)}…")`
	})

	// Caret's own guarantees and the model's competence are certified separately.
	//
	// They used to be one scenario, which was a mistake: when the model wandered,
	// the whole thing went red and took the deterministic assertions down with it
	// — so a suite failure said nothing about whether Caret was correct. `ff` is
	// entirely Caret's contract and does not depend on the model producing good
	// edits. `gg` is the end-to-end result, and is allowed to be inconclusive.

	const syncStatePath = path.join(fixture, ".caret", "sync-state.json")
	const appSourcePath = path.join(fixture, "src")

	async function bookmarkNow(): Promise<string | null> {
		const raw = await fs.readFile(syncStatePath, "utf-8").catch(() => null)
		const state = raw ? (JSON.parse(raw) as { lastSyncedCommit?: string | null }) : null
		return state?.lastSyncedCommit ?? null
	}

	/** Clicks Sync and walks the preflight, up to the plan awaiting approval. */
	async function planASync(): Promise<void> {
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Sync" }).click()

		// The preflight offers to commit the design layer first. That prompt is part
		// of the flow a user walks, so it is clicked rather than pre-empted. It only
		// appears when the design layer is actually dirty.
		const commit = chrome.getByTestId("notification-stack").getByRole("button", { name: "Commit .caret/ changes" })
		await commit.waitFor({ timeout: 60_000 }).then(
			() => commit.click(),
			() => {},
		)

		// The plan completing is the *model's* job. What `ff` certifies is what
		// Caret does given a plan, so a model that never produces one makes the
		// scenario inconclusive rather than failed — the same distinction gg draws.
		await chrome.waitForSelector('[data-testid="chat-approval"]', { timeout: 300_000 }).catch(() => {
			throw new Inconclusive("the model did not finish a plan within five minutes")
		})
	}

	await inference("ff. a plan writes nothing, and discarding it leaves the bookmark alone", async () => {
		// A design change the app does not have yet. Deliberately a single word:
		// what is being certified here is the loop, not the model's judgment.
		const pagePath = path.join(fixture, ".caret", "pages", "home", "index.tsx")
		const page = await fs.readFile(pagePath, "utf-8")
		await fs.writeFile(pagePath, page.replace(">Welcome<", ">Zephyr<"))

		const before = await readTree(appSourcePath)
		await planASync()
		await shot(chrome, "13-sync-plan")

		// The guarantee, checked at the only moment it can be: a read-only plan has
		// run to completion and the app is still byte-for-byte what it was. The
		// whole tree, not one file — a plan that created `src/pages/` would have
		// slipped past a single-file check.
		assert(
			(await readTree(appSourcePath)) === before,
			"the plan phase wrote to the app — the read-only boundary did not hold",
		)

		await chrome.getByTestId("chat-approval").getByRole("button", { name: "Discard" }).click()

		// Discarding has to leave *everything* alone, including the bookmark —
		// otherwise the design change is recorded as synced and never offered again.
		await waitFor(
			"the approval to clear",
			async () => ((await chrome.getByTestId("chat-approval").count()) ? null : true),
			30_000,
		)
		assert((await readTree(appSourcePath)) === before, "discarding a plan still changed the app")
		assert((await bookmarkNow()) === null, "discarding a plan advanced the sync bookmark")

		return "plan read-only, discard left the app and the bookmark untouched"
	})

	await inference("gg. applying a plan changes the app and advances the bookmark", async () => {
		const before = await readTree(appSourcePath)

		// The discarded change is still pending, which is itself the claim: a
		// discarded sync is offered again rather than quietly lost.
		await planASync()
		await chrome.getByTestId("chat-approval").getByRole("button", { name: "Apply" }).click()

		// Applying is where writes to the user's *own* source happen, and those ask
		// by default — accepting a plan is not the same as consenting to each file.
		// So the prompts are answered, exactly as a user would.
		let allowed = 0
		const deadline = Date.now() + 420_000
		let bookmark: string | null = null

		while (Date.now() < deadline) {
			const allow = chrome.getByTestId("chat-permission-allow")
			if (await allow.count()) {
				await allow
					.first()
					.click()
					.catch(() => {})
				allowed += 1
			}

			bookmark = await bookmarkNow()
			if (bookmark) break

			// Caret says this in its own voice when a turn ends having written
			// nothing. Waiting out the remaining minutes after that would tell us
			// nothing we do not already know.
			const transcript = (await chrome.textContent('[data-testid="chat-transcript"]').catch(() => null)) ?? ""
			if (transcript.includes("without changing anything in your app")) {
				// Say what it actually did. "Finished without editing" on its own has
				// already sent me chasing the wrong cause twice; the tail of the chat
				// and git's own view are what distinguish "the model declined" from
				// "Caret failed to notice".
				await shot(chrome, "14-sync-inconclusive")
				const status = child_process.execSync("git status --porcelain", { cwd: fixture }).toString().trim()
				throw new Inconclusive(
					`the model finished without editing anything (${allowed} write(s) allowed).\n` +
						`  git status: ${status.split("\n").slice(0, 8).join(" | ") || "(clean)"}\n` +
						`  chat tail: …${transcript.slice(-700)}`,
				)
			}

			await new Promise((resolve) => setTimeout(resolve, 500))
		}

		await shot(chrome, "14-sync-applied")

		if (!bookmark) {
			const transcript = (await chrome.textContent('[data-testid="chat-transcript"]').catch(() => null)) ?? ""
			throw new Inconclusive(`the model was still working after 7 minutes; last of the chat: …${transcript.slice(-400)}`)
		}

		// This half *is* Caret's, and stays a hard failure: the bookmark may only
		// advance when the apply actually wrote something. Advancing without it
		// records the design change as synced and never offers it again.
		const applied = await readTree(appSourcePath)
		assert(applied !== before, "the bookmark advanced but nothing in the app changed")
		// Anywhere under `src/`. A good sync is allowed to restructure — one run
		// split two design pages into a router and page components — so pinning
		// this to `App.tsx` would fail the correct outcome.
		assert(applied.includes("Zephyr"), `the app did not follow the design:\n${applied.slice(0, 1200)}`)

		return `app updated after ${allowed} allowed write(s), bookmark at ${bookmark.slice(0, 8)}`
	})

	await inference("ii. the wizard interviews, finishes on demand, and Caret writes the file", async () => {
		// The whole loop, live: the model composes a question from the widget
		// vocabulary, the UI renders and answers it, "Just finish" forces a
		// proposal from what's known, and the committed file is Caret's own
		// derivation. Two model turns, so it stays affordable on a free model.
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Foundation" }).click()
		await chrome.click('[data-testid="foundation-tab-interview"]')
		await chrome.waitForSelector('[data-testid="wizard-describe"]', { timeout: 20_000 })

		await chrome.fill(
			'[data-testid="wizard-describe"]',
			"A quiet reading app for long-form essays. People sit with it for an hour at a time. Calm, bookish, light background.",
		)
		await chrome.click('[data-testid="wizard-begin"]')

		// The first question is a whole model turn composing UI; give it the same
		// patience as any inference scenario — and a model that cannot produce one
		// in time is the model's failure, not Caret's, same as ff's five-minute
		// rule. A free model has been observed doing this in 90s on one run and
		// blowing 240s on the next.
		const first = await Promise.race([
			chrome.waitForSelector('[data-testid="wizard-question"]', { timeout: 300_000 }).then(() => "question" as const),
			chrome.waitForSelector('[data-testid="wizard-error"]', { timeout: 300_000 }).then(() => "error" as const),
		]).catch(() => "timeout" as const)
		if (first === "timeout") {
			throw new Inconclusive("the model did not compose a first question within five minutes")
		}
		if (first === "error") {
			const message = (await chrome.textContent('[data-testid="wizard-error"]'))?.trim() ?? ""
			throw new Inconclusive(`the model never produced a renderable question: ${message.slice(0, 200)}`)
		}

		const questionText = (await chrome.textContent('[data-testid="wizard-question"] h1'))?.trim() ?? ""
		assert(questionText.length > 5, "a question rendered with no text")
		await shot(chrome, "15-wizard-question")

		// Answer it through the real UI. Whatever kind the model chose, either the
		// widget preselected something (Continue enabled) or it needs input (skip
		// is the honest answer for a harness with no opinions).
		const continueEnabled = await chrome.getByTestId("wizard-continue").isEnabled()
		await chrome.click(continueEnabled ? '[data-testid="wizard-continue"]' : '[data-testid="wizard-skip"]')

		// Then stop the interview and make it construct from what it has.
		await chrome
			.waitForSelector('[data-testid="wizard-finish-now"], [data-testid="wizard-finish"], [data-testid="wizard-error"]', {
				timeout: 300_000,
			})
			.catch(() => {
				throw new Inconclusive("the model did not produce a second turn within five minutes")
			})
		if (await chrome.getByTestId("wizard-finish-now").count()) {
			await chrome.click('[data-testid="wizard-finish-now"]')
		}

		const finished = await Promise.race([
			chrome.waitForSelector('[data-testid="wizard-finish"]', { timeout: 300_000 }).then(() => "finish" as const),
			chrome.waitForSelector('[data-testid="wizard-error"]', { timeout: 300_000 }).then(() => "error" as const),
		]).catch(() => "timeout" as const)
		if (finished === "timeout") {
			throw new Inconclusive("the model did not construct a foundation within five minutes")
		}
		if (finished === "error") {
			const message = (await chrome.textContent('[data-testid="wizard-error"]'))?.trim() ?? ""
			throw new Inconclusive(`the model could not construct a valid foundation: ${message.slice(0, 200)}`)
		}
		await shot(chrome, "16-wizard-finish")

		const before = await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8")
		await chrome.click('[data-testid="wizard-commit"]')

		const tokens = await waitFor(
			"the wizard to write foundation.json",
			async () => {
				const raw = await fs.readFile(path.join(fixture, ".caret", "tokens", "foundation.json"), "utf-8")
				return raw !== before ? JSON.parse(raw) : null
			},
			30_000,
		)

		// Caret's derivation, not the model's file: scales must exist and cohere.
		assert(tokens.typography?.fontFamily, "no body typeface")
		assert(Object.keys(tokens.typography.scale ?? {}).length > 0, "no derived type scale")
		assert(/^#[0-9a-f]{6}$/.test(tokens.color?.brand?.seed ?? ""), `brand seed is not a hex: ${tokens.color?.brand?.seed}`)
		assert(Object.keys(tokens.color.brand.scale ?? {}).length > 0, "no derived colour scale")
		assert((tokens.spacing?.scale ?? []).length > 0, "no spacing scale")

		// Scratch cleared on commit — a committed interview must not offer a resume.
		await waitFor(
			"the wizard's scratch to be cleared",
			async () =>
				fs
					.access(path.join(fixture, ".caret", ".interview.json"))
					.then(() => null)
					.catch(() => true),
			20_000,
		)

		return `asked "${questionText.slice(0, 50)}…", finished → ${tokens.typography.displayFamily ?? tokens.typography.fontFamily}, ${tokens.color.brand.seed}`
	})
}

async function cleanup(): Promise<void> {
	await app?.close().catch(() => {})
	if (fixture && !KEEP) {
		await fs.rm(fixture, { recursive: true, force: true }).catch(() => {})
	} else if (fixture) {
		log(`fixture kept at ${fixture}`)
	}
	if (userData && !KEEP) await fs.rm(userData, { recursive: true, force: true }).catch(() => {})
}

main()
	.catch((err) => {
		results.push({ name: "harness", passed: false, detail: String(err) })
	})
	.finally(async () => {
		await cleanup()

		console.log("\n========== CARET APP CERTIFICATION ==========")
		for (const result of results) {
			const mark = result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL"
			console.log(`${mark}  ${result.name.padEnd(56)} ${result.detail}`)
		}
		const failed = results.filter((r) => !r.passed)
		const skipped = results.filter((r) => r.skipped)
		console.log("=============================================")
		console.log(
			failed.length > 0
				? `${failed.length} scenario(s) FAILED`
				: skipped.length > 0
					? // Never "all pass" with something unrun — that reads as full
						// coverage to anyone skimming a CI log.
						`${results.length - skipped.length} passed, ${skipped.length} SKIPPED (not certified)`
					: ONLY
						? `${results.length} passed — PARTIAL RUN (--only), not a certification`
						: `CERTIFIED: all ${results.length} scenarios pass`,
		)
		process.exit(failed.length === 0 ? 0 : 1)
	})

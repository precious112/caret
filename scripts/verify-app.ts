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

const KEEP = process.argv.includes("--keep")
const SHOTS = path.resolve("release/verify-shots")

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

	app = await electron.launch({
		args: [path.resolve("out/main/index.js"), fixture],
		env: { ...process.env, CARET_VERIFY_PROJECT: fixture, NODE_ENV: "test" },
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

	await scenario("n. the chrome renders and shows the project", async () => {
		// A renderer that threw during mount leaves an empty #root and every later
		// scenario times out with a confusing message, so check that first.
		const failures: string[] = []
		chrome.on("pageerror", (err) => failures.push(err.message))

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
		const family = await cards
			.first()
			.locator("p")
			.first()
			.evaluate((el) => getComputedStyle(el).fontFamily)
		assert(!/^(ui-|system-ui|-apple)/.test(family), `specimen fell back to a system face: ${family}`)

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

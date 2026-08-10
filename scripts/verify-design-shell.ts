/**
 * Design-shell reliability certification harness.
 *
 * Generates a fixture .caret project from the CURRENT templates, boots the
 * real Vite dev server, drives the canvas in a headless browser, and runs a
 * scenario suite covering both happy paths and adversarial AI-output cases
 * (corrupt flow files, missing page files, corrupt layout, racing writes).
 * Prints a PASS/FAIL certification matrix and exits non-zero on any failure.
 *
 * Usage:
 *   npm run verify:design-shell                # full run (first run installs deps, ~60s)
 *   npm run verify:design-shell -- --keep      # keep the fixture dir for inspection
 *   npm run verify:design-shell -- --node-modules /path/to/.caret/node_modules
 */
import * as child_process from "child_process"
import * as crypto from "crypto"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { DESIGN_CHECKS_DOM_SCRIPT } from "../src/core/design/design-checks"
import { mutateFlowDefinition } from "../src/core/design/flow-meta"
import { generateEntryFiles, writeThemeCss } from "../src/core/design/rendering-shell/entry-template"
import { generateViteConfig } from "../src/core/design/rendering-shell/vite-config-template"
import { ensureCaretDirectoryExists } from "../src/core/design/scaffold"
import { solidPng } from "./verify-support"

/** A real decodable PNG — the picker's thumbnail has to actually paint. */
const FIXTURE_PNG = solidPng(240, 135, [20, 24, 33])

// Mirrors REQUIRED_DEPS in rendering-shell/index.ts (which we can't import here
// without dragging in the whole extension graph).
const EXTRA_DEPS: Record<string, string> = {
	"react-grab": "^0.1.37",
	tailwindcss: "^4.1.0",
	"@tailwindcss/vite": "^4.1.0",
	"modern-screenshot": "^4.6.0",
}

const args = process.argv.slice(2)
const KEEP = args.includes("--keep")
const nmFlagIdx = args.indexOf("--node-modules")
const NODE_MODULES_OVERRIDE = nmFlagIdx !== -1 ? args[nmFlagIdx + 1] : null

interface ScenarioResult {
	name: string
	passed: boolean
	detail: string
}

const results: ScenarioResult[] = []
let viteProc: child_process.ChildProcess | null = null
let viteOutput = ""

function log(msg: string) {
	console.log(`[verify] ${msg}`)
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const PAGE_TEMPLATE = (id: string, title: string) => `export default function ${title.replace(/\s/g, "")}() {
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-3xl font-bold text-zinc-900">${title}</h1>
      <p className="text-zinc-600">Fixture page ${id}.</p>
      <button className="bg-blue-600 text-white px-4 py-2 rounded-lg">Go</button>
      <div style={{ height: 1600 }} />
      <div data-testid="below-fold" style={{ background: "rgb(255,0,255)", width: 320, height: 160 }}>below fold</div>
    </div>
  )
}
`

const FIXTURE_PAGES = [
	{ id: "home", title: "Home" },
	{ id: "about", title: "About" },
	{ id: "contact", title: "Contact" },
	{ id: "dashboard", title: "Dashboard" },
]
// FIXTURE_PAGES plus the pages seeded separately: "listing", "fragmented", and
// "renamed" (the folder/meta id mismatch of scenario `p`). This arithmetic
// breaking silently is exactly what happened when `renamed` was added — three
// scenarios failed with "expected 6 frames, got 7" — so if you seed another
// page below, this line is the other half of that change.
const EXTRA_SEEDED_PAGES = 3
const TOTAL_PAGES = FIXTURE_PAGES.length + EXTRA_SEEDED_PAGES

// JSX fragments used to break the source-capture plugin (its old regex only
// matched jsxDEV-only imports). Scenario (o) asserts exact line resolution
// for an element inside a fragment. The h1 below sits on line 5 — keep in
// sync with FRAGMENT_H1_LINE.
const FRAGMENT_PAGE = `export default function Fragmented() {
  return (
    <>
      <div className="min-h-screen bg-white p-8">
        <h1 data-testid="frag-title" className="text-3xl font-bold text-zinc-900">Fragment Title</h1>
        <p className="text-zinc-600">Inside a fragment.</p>
      </div>
    </>
  )
}
`
const FRAGMENT_H1_LINE = 5

// Canonical responsive dual-view pattern: mobile cards (md:hidden) + desktop
// table (hidden md:block). Historically broken by react-grab's unlayered
// utility CSS beating the page's layered md:block — scenario (n) locks it.
const RESPONSIVE_PAGE = `export default function Listing() {
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-2xl font-bold text-zinc-900">Listing</h1>
      <div data-testid="mobile-cards" className="md:hidden space-y-2">
        <div className="p-3 rounded-lg border border-zinc-200">Card A</div>
        <div className="p-3 rounded-lg border border-zinc-200">Card B</div>
      </div>
      <div data-testid="desktop-table" className="hidden md:block">
        <table className="w-full text-left">
          <thead><tr><th className="px-4 py-2">Name</th></tr></thead>
          <tbody><tr><td className="px-4 py-2">Row A</td></tr></tbody>
        </table>
      </div>
    </div>
  )
}
`

// One global flow root (home) so the simulate scenario is deterministic.
const FIXTURE_FLOWS: Record<string, object> = {
	"main.flow.json": {
		id: "main",
		name: "Main Flow",
		steps: [
			{ page: "home", next: ["about", "dashboard"] },
			{ page: "about", next: ["contact"] },
		],
	},
	"billing.flow.json": {
		id: "billing",
		name: "Billing",
		steps: [{ page: "dashboard", next: ["about"] }],
	},
}

async function buildFixture(): Promise<{ workspace: string; caretDir: string }> {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "caret-verify-"))
	const caretDir = await ensureCaretDirectoryExists(workspace)

	const pkgPath = path.join(caretDir, "package.json")
	const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
	pkg.dependencies = { ...pkg.dependencies, ...EXTRA_DEPS }
	await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))

	for (const page of FIXTURE_PAGES) {
		const dir = path.join(caretDir, "pages", page.id)
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(path.join(dir, "index.tsx"), PAGE_TEMPLATE(page.id, page.title))
		await fs.writeFile(
			path.join(dir, "meta.json"),
			JSON.stringify({ id: page.id, title: page.title, type: "page", states: [], tags: ["fixture"] }, null, 2),
		)
	}
	const listingDir = path.join(caretDir, "pages", "listing")
	await fs.mkdir(listingDir, { recursive: true })
	await fs.writeFile(path.join(listingDir, "index.tsx"), RESPONSIVE_PAGE)
	await fs.writeFile(
		path.join(listingDir, "meta.json"),
		JSON.stringify({ id: "listing", title: "Listing", type: "page", states: [], tags: ["fixture"] }, null, 2),
	)
	const fragmentedDir = path.join(caretDir, "pages", "fragmented")
	await fs.mkdir(fragmentedDir, { recursive: true })
	await fs.writeFile(path.join(fragmentedDir, "index.tsx"), FRAGMENT_PAGE)
	await fs.writeFile(
		path.join(fragmentedDir, "meta.json"),
		JSON.stringify({ id: "fragmented", title: "Fragmented", type: "page", states: [], tags: ["fixture"] }, null, 2),
	)

	// A page whose meta.json claims an id its folder does not have. AI-written
	// meta.json does this, and it used to render and thumbnail perfectly while
	// being silently impossible to open — see scenario `p`.
	const renamedDir = path.join(caretDir, "pages", "renamed")
	await fs.mkdir(renamedDir, { recursive: true })
	await fs.writeFile(path.join(renamedDir, "index.tsx"), PAGE_TEMPLATE("renamed", "Renamed"))
	await fs.writeFile(
		path.join(renamedDir, "meta.json"),
		JSON.stringify({ id: "a-different-id", title: "Renamed", type: "page", states: [], tags: ["fixture"] }, null, 2),
	)
	for (const [file, flow] of Object.entries(FIXTURE_FLOWS)) {
		await fs.writeFile(path.join(caretDir, "flows", file), JSON.stringify(flow, null, 2))
	}

	// An asset for the @ picker to autocomplete over. Written as bytes plus an
	// index, exactly as a direct write would arrive, so the fixture exercises
	// the same path a user's own drop produces.
	const assetsDir = path.join(caretDir, "assets")
	await fs.mkdir(assetsDir, { recursive: true })
	await fs.writeFile(path.join(assetsDir, "hero-shot.png"), FIXTURE_PNG)
	await fs.writeFile(
		path.join(assetsDir, "index.json"),
		JSON.stringify(
			{
				version: 1,
				assets: [
					{
						tag: "hero-shot",
						file: "hero-shot.png",
						kind: "image",
						mime: "image/png",
						width: 240,
						height: 135,
						bytes: FIXTURE_PNG.length,
						hash: "sha256:fixture",
						alt: "A workbench",
						description: "wide, dark, empty space top-left",
						origin: { type: "uploaded" },
						addedAt: "2026-08-07T00:00:00Z",
					},
				],
			},
			null,
			2,
		),
	)

	await generateViteConfig(caretDir)
	await generateEntryFiles(caretDir)
	return { workspace, caretDir }
}

async function provisionNodeModules(caretDir: string): Promise<void> {
	const target = path.join(caretDir, "node_modules")
	if (NODE_MODULES_OVERRIDE) {
		log(`linking node_modules from ${NODE_MODULES_OVERRIDE}`)
		await fs.symlink(path.resolve(NODE_MODULES_OVERRIDE), target)
		return
	}
	const pkgText = await fs.readFile(path.join(caretDir, "package.json"), "utf-8")
	const hash = crypto.createHash("sha256").update(pkgText).digest("hex").slice(0, 16)
	const cacheDir = path.join(os.tmpdir(), "caret-design-shell-cache", hash)
	const cachedModules = path.join(cacheDir, "node_modules")

	// A cache that exists is not a cache that works: an interrupted install
	// leaves the directory present and the vite binary absent, and every later
	// run then fails with "vite did not start" — two whole suite runs were lost
	// to exactly that. The binary the suite is about to spawn is the validity
	// check, so a poisoned cache heals itself instead of failing forever.
	if (fsSync.existsSync(cachedModules) && !fsSync.existsSync(path.join(cachedModules, ".bin", "vite"))) {
		log(`cached node_modules has no vite binary — discarding poisoned cache: ${cacheDir}`)
		await fs.rm(cacheDir, { recursive: true, force: true })
	}

	if (!fsSync.existsSync(cachedModules)) {
		log(`installing fixture dependencies into cache (first run, ~60s): ${cacheDir}`)
		await fs.mkdir(cacheDir, { recursive: true })
		await fs.writeFile(path.join(cacheDir, "package.json"), pkgText)
		await new Promise<void>((resolve, reject) => {
			const proc = child_process.spawn("npm", ["install", "--no-audit", "--no-fund"], {
				cwd: cacheDir,
				stdio: "inherit",
				shell: true,
			})
			proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`npm install exited ${code}`))))
			proc.on("error", reject)
		})
	} else {
		log(`reusing cached node_modules: ${cachedModules}`)
	}
	await fs.symlink(cachedModules, target)
}

// ---------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------

async function bootVite(caretDir: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const viteBin = path.join(caretDir, "node_modules", ".bin", "vite")
		viteProc = child_process.spawn(viteBin, ["--host", "localhost"], { cwd: caretDir, stdio: "pipe", shell: true })
		const timeout = setTimeout(() => reject(new Error(`vite did not start in 60s.\n${viteOutput}`)), 60000)
		viteProc.stdout?.on("data", (d: Buffer) => {
			viteOutput += d.toString()
			const match = viteOutput.match(/Local:\s+http:\/\/localhost:(\d+)/)
			if (match) {
				clearTimeout(timeout)
				resolve(Number.parseInt(match[1], 10))
			}
		})
		viteProc.stderr?.on("data", (d: Buffer) => {
			viteOutput += d.toString()
		})
		viteProc.on("error", reject)
	})
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser() {
	const { chromium } = await import("playwright")
	try {
		return await chromium.launch({ headless: true })
	} catch {
		// Installed playwright version may not have its browser downloaded; fall
		// back to whatever revision exists in the ms-playwright cache.
		const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright")
		const candidates: string[] = []
		for (const dir of fsSync.existsSync(cacheRoot) ? fsSync.readdirSync(cacheRoot) : []) {
			if (dir.startsWith("chromium_headless_shell-")) {
				candidates.push(path.join(cacheRoot, dir, "chrome-mac", "headless_shell"))
				candidates.push(path.join(cacheRoot, dir, "chrome-headless-shell-mac-x64", "chrome-headless-shell"))
			}
			if (dir.startsWith("chromium-")) {
				candidates.push(path.join(cacheRoot, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"))
			}
		}
		for (const executablePath of candidates.reverse()) {
			if (fsSync.existsSync(executablePath)) {
				log(`using fallback browser: ${executablePath}`)
				return await chromium.launch({ headless: true, executablePath })
			}
		}
		throw new Error("No Chromium available. Run: npx playwright install chromium")
	}
}

// ---------------------------------------------------------------------------
// Scenario plumbing
// ---------------------------------------------------------------------------

interface Ctx {
	browser: Awaited<ReturnType<typeof launchBrowser>>
	port: number
	workspace: string
	caretDir: string
}

async function openCanvas(ctx: Ctx) {
	const page = await ctx.browser.newPage({ viewport: { width: 1600, height: 1000 } })
	const counters = { navigations: 0, fullReloads: 0, flowsChanged: 0 }
	page.on("framenavigated", (f) => {
		if (f === page.mainFrame()) counters.navigations++
	})
	page.on("websocket", (ws) =>
		ws.on("framereceived", (d) => {
			try {
				const m = JSON.parse(typeof d.payload === "string" ? d.payload : d.payload.toString())
				if (m.type === "full-reload") counters.fullReloads++
				if (m.type === "custom" && m.event === "caret:flows-changed") counters.flowsChanged++
			} catch {}
		}),
	)
	await page.goto(`http://localhost:${ctx.port}/`)
	await page.waitForSelector(".caret-canvas-container", { timeout: 20000 })
	await page.waitForTimeout(2500) // let thumbnails/iframes settle
	return { page, counters }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await check()) return
		await new Promise((r) => setTimeout(r, 250))
	}
	throw new Error(`timed out waiting for ${label}`)
}

async function scenario(name: string, fn: () => Promise<string>) {
	try {
		const detail = await fn()
		results.push({ name, passed: true, detail })
		log(`PASS ${name}`)
	} catch (err) {
		results.push({ name, passed: false, detail: err instanceof Error ? err.message : String(err) })
		log(`FAIL ${name}: ${err}`)
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	log("building fixture from current templates...")
	const { workspace, caretDir } = await buildFixture()
	fixtureWorkspace = workspace
	log(`fixture: ${caretDir}`)
	await provisionNodeModules(caretDir)

	// (l) needs no browser/server: hammer the flow file with concurrent
	// reassign-style mutation pairs and require valid JSON throughout.
	await scenario("l. 200 concurrent flow mutations keep file valid", async () => {
		for (let i = 0; i < 100; i++) {
			const oldT = i % 2 === 0 ? "about" : "contact"
			const newT = i % 2 === 0 ? "contact" : "about"
			await Promise.all([
				mutateFlowDefinition(workspace, "main", (f) => {
					const s = f.steps.find((s) => s.page === "home")
					if (s) s.next = s.next.filter((p) => p !== oldT)
				}),
				mutateFlowDefinition(workspace, "main", (f) => {
					const s = f.steps.find((s) => s.page === "home")
					if (s && !s.next.includes(newT)) s.next.push(newT)
				}),
			])
			JSON.parse(await fs.readFile(path.join(caretDir, "flows", "main.flow.json"), "utf-8"))
		}
		// restore seed state
		await fs.writeFile(
			path.join(caretDir, "flows", "main.flow.json"),
			JSON.stringify(FIXTURE_FLOWS["main.flow.json"], null, 2),
		)
		return "200 mutation pairs, file parsed valid after every pair"
	})

	log("booting vite...")
	const port = await bootVite(caretDir)
	log(`vite on :${port}`)
	const browser = await launchBrowser()
	const ctx: Ctx = { browser, port, workspace, caretDir }

	await scenario("a. canvas renders all fixture pages", async () => {
		const { page } = await openCanvas(ctx)
		const frames = await page.locator(".caret-canvas-frame").count()
		await page.close()
		if (frames !== TOTAL_PAGES) throw new Error(`expected ${TOTAL_PAGES} frames, got ${frames}`)
		return `${frames} page frames rendered`
	})

	await scenario("b. flow edge create/delete live-update with zero reloads", async () => {
		const { page, counters } = await openCanvas(ctx)
		await page.click('button[title="Show flows"]')
		await page.waitForTimeout(500)
		const dotsBefore = await page.locator(".caret-canvas-flow-overlay circle").count()
		const baseNav = counters.navigations
		// what the extension writes on edge create
		await mutateFlowDefinition(workspace, "billing", (f) => {
			const s = f.steps.find((s) => s.page === "dashboard")
			if (s && !s.next.includes("contact")) s.next.push("contact")
		})
		await waitFor(
			async () => (await page.locator(".caret-canvas-flow-overlay circle").count()) > dotsBefore,
			10000,
			"new edge to appear",
		)
		// edge delete
		await mutateFlowDefinition(workspace, "billing", (f) => {
			const s = f.steps.find((s) => s.page === "dashboard")
			if (s) s.next = s.next.filter((p) => p !== "contact")
		})
		await waitFor(
			async () => (await page.locator(".caret-canvas-flow-overlay circle").count()) === dotsBefore,
			10000,
			"edge to disappear",
		)
		const navDelta = counters.navigations - baseNav
		const reloads = counters.fullReloads
		const flowFile = JSON.parse(await fs.readFile(path.join(caretDir, "flows", "billing.flow.json"), "utf-8"))
		await page.close()
		if (navDelta > 0 || reloads > 0) throw new Error(`navigations=${navDelta} fullReloads=${reloads} (expected 0)`)
		if (flowFile.id !== "billing") throw new Error("flow file invalid after CRUD")
		return `live updates, 0 navigations, 0 full-reloads, ${counters.flowsChanged} flows-changed events`
	})

	await scenario("c. edge endpoints keep clear of connectors and each other", async () => {
		const { page } = await openCanvas(ctx)
		await page.click('button[title="Show flows"]')
		await page.waitForTimeout(500)
		const m = await page.evaluate(() => {
			const dots = [...document.querySelectorAll(".caret-canvas-flow-overlay circle")].map((c) => {
				const r = c.getBoundingClientRect()
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
			})
			const conns = [...document.querySelectorAll(".caret-edge-connector")].map((c) => {
				const r = c.getBoundingClientRect()
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
			})
			let dc = Number.POSITIVE_INFINITY
			let dd = Number.POSITIVE_INFINITY
			for (const d of dots) for (const c of conns) dc = Math.min(dc, Math.hypot(d.x - c.x, d.y - c.y))
			for (let i = 0; i < dots.length; i++)
				for (let j = i + 1; j < dots.length; j++)
					dd = Math.min(dd, Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y))
			return { dots: dots.length, dc, dd }
		})
		await page.close()
		if (m.dots === 0) throw new Error("no edge endpoints rendered")
		if (m.dc < 12) throw new Error(`endpoint within ${m.dc.toFixed(1)}px of a connector`)
		if (m.dd < 12) throw new Error(`endpoints within ${m.dd.toFixed(1)}px of each other`)
		return `${m.dots} endpoints; min dist to connector ${m.dc.toFixed(0)}px, between endpoints ${m.dd.toFixed(0)}px`
	})

	await scenario("d. simulate opens at the flow root page", async () => {
		const { page } = await openCanvas(ctx)
		await page.click('button[title="Simulate"]')
		await page.waitForSelector(".caret-simulation-shell", { timeout: 10000 })
		const src = await page.locator(".caret-simulation-iframe").getAttribute("src")
		await page.close()
		if (!src?.includes("page=home")) throw new Error(`simulation started at ${src}, expected page=home (flow root)`)
		return "simulation starts at page=home (the only flow root)"
	})

	await scenario("e. corrupt flow file is visibly flagged, canvas stays alive", async () => {
		const { page, counters } = await openCanvas(ctx)
		await page.click('button[title="Show flows"]')
		await page.waitForTimeout(500)
		const billingPath = path.join(caretDir, "flows", "billing.flow.json")
		const original = await fs.readFile(billingPath, "utf-8")
		const baseNav = counters.navigations
		try {
			await fs.writeFile(billingPath, '{"id": "billing", "name": ') // torn write
			await waitFor(
				async () => (await page.locator(".caret-flow-legend-item.invalid").count()) > 0,
				10000,
				"invalid flow legend entry",
			)
			const warnings = await page.locator(".caret-canvas-warnings").count()
			const mainEdges = await page.locator(".caret-canvas-flow-overlay circle").count()
			const navDelta = counters.navigations - baseNav
			if (warnings === 0) throw new Error("warnings chip not shown")
			if (mainEdges === 0) throw new Error("valid flows stopped rendering")
			if (navDelta > 0) throw new Error("canvas reloaded")
			return "invalid legend entry + warnings chip shown; other flows intact; no reload"
		} finally {
			await fs.writeFile(billingPath, original)
			await page.close()
		}
	})

	await scenario("f. missing index.tsx shows broken-page card, canvas stays alive", async () => {
		const { page } = await openCanvas(ctx)
		const indexPath = path.join(caretDir, "pages", "contact", "index.tsx")
		const original = await fs.readFile(indexPath, "utf-8")
		try {
			await fs.rm(indexPath)
			await waitFor(async () => (await page.locator(".caret-canvas-frame-broken").count()) > 0, 15000, "broken-page card")
			const frames = await page.locator(".caret-canvas-frame").count()
			if (frames !== TOTAL_PAGES) throw new Error(`expected ${TOTAL_PAGES} frames, got ${frames}`)
			return "broken-page card rendered; all other pages still on canvas"
		} finally {
			await fs.writeFile(indexPath, original)
			await page.close()
		}
	})

	await scenario("g. corrupt canvas-layout.json falls back cleanly", async () => {
		const layoutPath = path.join(caretDir, "canvas-layout.json")
		await fs.writeFile(layoutPath, "{{{{ not json")
		try {
			const { page } = await openCanvas(ctx)
			const frames = await page.locator(".caret-canvas-frame").count()
			await page.close()
			if (frames !== TOTAL_PAGES) throw new Error(`canvas broke: ${frames} frames`)
			return "canvas renders in auto layout despite corrupt layout file"
		} finally {
			await fs.rm(layoutPath, { force: true })
		}
	})

	await scenario("g2. layout endpoint rejects garbage writes", async () => {
		const res = await fetch(`http://localhost:${port}/__caret/canvas-layout`, { method: "PUT", body: "garbage" })
		const res2 = await fetch(`http://localhost:${port}/__caret/canvas-layout`, {
			method: "PUT",
			body: JSON.stringify({ mode: "manual", positions: { home: { x: 1, y: Number.NaN } } }),
		})
		const ok = await fetch(`http://localhost:${port}/__caret/canvas-layout`, {
			method: "PUT",
			body: JSON.stringify({ mode: "manual", positions: { home: { x: 1, y: 2 } } }),
		})
		if (res.status !== 400 || res2.status !== 400) throw new Error(`garbage accepted: ${res.status}/${res2.status}`)
		if (ok.status !== 200) throw new Error(`valid payload rejected: ${ok.status}`)
		await fs.rm(path.join(caretDir, "canvas-layout.json"), { force: true })
		return "garbage → 400, NaN positions → 400, valid → 200"
	})

	await scenario("h. edges to missing pages raise the warnings chip", async () => {
		const { page } = await openCanvas(ctx)
		try {
			await mutateFlowDefinition(workspace, "billing", (f) => {
				f.steps.push({ page: "dashboard-v2-does-not-exist", next: ["home"] })
			})
			await waitFor(async () => (await page.locator(".caret-canvas-warnings").count()) > 0, 10000, "warnings chip")
			const text = await page.locator(".caret-canvas-warnings").textContent()
			if (!text?.includes("missing pages")) throw new Error(`chip text: ${text}`)
			return `chip: "${text?.trim()}"`
		} finally {
			await fs.writeFile(
				path.join(caretDir, "flows", "billing.flow.json"),
				JSON.stringify(FIXTURE_FLOWS["billing.flow.json"], null, 2),
			)
			await page.close()
		}
	})

	await scenario("i. react-grab lives only in the focused iframe", async () => {
		const { page } = await openCanvas(ctx)
		const outer = await page.evaluate(() => ({
			toolbars: document.querySelectorAll("[data-react-grab]").length,
			rg: !!(window as any).__REACT_GRAB__,
		}))
		await page.click(".caret-canvas-frame >> nth=0")
		await page.waitForSelector(".caret-focused-iframe", { timeout: 10000 })
		await page.waitForTimeout(3000)
		const innerFrame = page.frames().find((f) => f.url().includes("mode=focused"))
		const inner = innerFrame
			? await innerFrame.evaluate(() => ({
					toolbars: document.querySelectorAll("[data-react-grab]").length,
					rg: !!(window as any).__REACT_GRAB__,
				}))
			: null
		await page.close()
		if (outer.toolbars !== 0 || outer.rg) throw new Error(`canvas doc has react-grab: ${JSON.stringify(outer)}`)
		if (!inner || inner.toolbars !== 1 || !inner.rg) throw new Error(`focused iframe wrong: ${JSON.stringify(inner)}`)
		return "0 instances in canvas doc, 1 in focused iframe"
	})

	await scenario("j. overlay painter screenshot matches the cropped region", async () => {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=home&mode=focused`)
		await page.waitForSelector(".caret-focused-paint-btn", { timeout: 15000 })
		await page.waitForTimeout(2500)
		await page.evaluate(() => {
			;(window as any).__POSTED__ = []
			window.addEventListener("message", (e) => {
				if (e.data?.type === "overlay-edit")
					(window as any).__POSTED__.push({ shot: e.data.payload?.screenshotDataUrl || "" })
			})
			;(window as any).__REACT_GRAB__?.deactivate?.()
		})
		// crop exactly the blue "Go" button so we can pixel-verify the content
		const target = await page.evaluate(() => {
			const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Go")!
			const r = btn.getBoundingClientRect()
			return { x: r.x, y: r.y, w: r.width, h: r.height }
		})
		await page.click(".caret-focused-paint-btn", { force: true })
		await page.waitForTimeout(400)
		await page.mouse.move(target.x, target.y)
		await page.mouse.down()
		await page.mouse.move(target.x + target.w, target.y + target.h, { steps: 5 })
		await page.mouse.up()
		await page.waitForSelector(".caret-overlay-prompt textarea, .caret-overlay-prompt input", { timeout: 5000 })
		await page.fill(".caret-overlay-prompt textarea, .caret-overlay-prompt input", "make this blue")
		await page.keyboard.press("Enter")
		await waitFor(
			async () => ((await page.evaluate(() => (window as any).__POSTED__)) as any[]).length > 0,
			20000,
			"overlay-edit message",
		)
		const check = await page.evaluate(async () => {
			const shot = (window as any).__POSTED__[0].shot as string
			if (!shot) return { error: "no screenshot" }
			const img = new Image()
			await new Promise((res, rej) => {
				img.onload = res
				img.onerror = rej
				img.src = shot
			})
			const c = document.createElement("canvas")
			c.width = img.width
			c.height = img.height
			const ctx = c.getContext("2d")!
			ctx.drawImage(img, 0, 0)
			// The crop is the blue button: most pixels must be blue-dominant
			// (the white "Go" glyph and rounded corners account for the rest).
			const d = ctx.getImageData(0, 0, img.width, img.height).data
			let blue = 0
			const total = img.width * img.height
			for (let i = 0; i < d.length; i += 4) {
				if (d[i + 2] > 150 && d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 40) blue++
			}
			return { size: `${img.width}x${img.height}`, blueFraction: blue / total }
		})
		if ("error" in check) throw new Error(String(check.error))
		if (check.blueFraction! < 0.3)
			throw new Error(`only ${Math.round(check.blueFraction! * 100)}% of crop pixels are blue — offset crop?`)

		// --- scrolled crop: paint the magenta marker far below the fold ---
		// This only passes if the crop translates the painted (viewport) rect by the
		// scroll offset onto the full-page capture; otherwise it grabs top content.
		await page.evaluate(() => {
			;(window as any).__POSTED__ = []
		})
		const marker = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="below-fold"]') as HTMLElement
			el.scrollIntoView({ block: "center" })
			const r = el.getBoundingClientRect()
			// The focused page scrolls inside `.caret-focused`, not the window.
			const scroller = document.querySelector(".caret-focused") as HTMLElement
			return { x: r.x, y: r.y, w: r.width, h: r.height, scrollTop: scroller ? scroller.scrollTop : window.scrollY }
		})
		if (marker.scrollTop < 200) throw new Error(`expected the page to scroll for the marker, scrollTop=${marker.scrollTop}`)
		await page.click(".caret-focused-paint-btn", { force: true })
		await page.waitForTimeout(400)
		await page.mouse.move(marker.x + 5, marker.y + 5)
		await page.mouse.down()
		await page.mouse.move(marker.x + marker.w - 5, marker.y + marker.h - 5, { steps: 5 })
		await page.mouse.up()
		await page.waitForSelector(".caret-overlay-prompt textarea, .caret-overlay-prompt input", { timeout: 5000 })
		await page.fill(".caret-overlay-prompt textarea, .caret-overlay-prompt input", "describe this")
		await page.keyboard.press("Enter")
		await waitFor(
			async () => ((await page.evaluate(() => (window as any).__POSTED__)) as any[]).length > 0,
			20000,
			"scrolled overlay-edit message",
		)
		const scrolled = await page.evaluate(async () => {
			const shot = (window as any).__POSTED__[0].shot as string
			if (!shot) return { error: "no screenshot" }
			const img = new Image()
			await new Promise((res, rej) => {
				img.onload = res
				img.onerror = rej
				img.src = shot
			})
			const c = document.createElement("canvas")
			c.width = img.width
			c.height = img.height
			const ctx = c.getContext("2d")!
			ctx.drawImage(img, 0, 0)
			const d = ctx.getImageData(0, 0, img.width, img.height).data
			let magenta = 0
			const total = img.width * img.height
			for (let i = 0; i < d.length; i += 4) {
				if (d[i] > 150 && d[i + 2] > 150 && d[i + 1] < 100) magenta++
			}
			return { size: `${img.width}x${img.height}`, magentaFraction: magenta / total }
		})
		await page.close()
		if ("error" in scrolled) throw new Error(String(scrolled.error))
		if (scrolled.magentaFraction! < 0.3)
			throw new Error(
				`scrolled crop only ${Math.round(scrolled.magentaFraction! * 100)}% magenta — scroll offset not applied to the crop`,
			)
		return `unscrolled ${Math.round(check.blueFraction! * 100)}% blue; scrolled (y=${marker.scrollTop}) ${Math.round(scrolled.magentaFraction! * 100)}% magenta — crop tracks scroll`
	})

	await scenario("k. focused FABs adapt to a light page background", async () => {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=home&mode=focused`)
		await page.waitForSelector(".caret-focused-fab", { timeout: 15000 })
		await waitFor(
			async () =>
				await page.evaluate(() => document.querySelector(".caret-focused")?.classList.contains("fabs-on-light") || false),
			8000,
			"fabs-on-light class",
		)
		const bg = await page.evaluate(
			() => window.getComputedStyle(document.querySelector(".caret-focused-fab")!).backgroundColor,
		)
		await page.close()
		return `fabs-on-light applied, fab background ${bg}`
	})

	await scenario("m. broken page iframe shows a readable error card", async () => {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=does-not-exist`)
		await waitFor(
			async () => ((await page.textContent("body")) || "").includes("Page not found"),
			10000,
			"page-not-found card",
		)
		await page.close()
		return "route-not-found error card rendered in isolated page mode"
	})

	await scenario("n. responsive variants work (hidden md:block toggles across viewports)", async () => {
		const readState = async (p: import("playwright").Page) =>
			p.evaluate(() => ({
				table: getComputedStyle(document.querySelector('[data-testid="desktop-table"]')!).display,
				cards: getComputedStyle(document.querySelector('[data-testid="mobile-cards"]')!).display,
			}))
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=listing`)
		await page.waitForSelector('[data-testid="desktop-table"]', { state: "attached", timeout: 15000 })
		const desktop = await readState(page)
		await page.setViewportSize({ width: 390, height: 844 })
		await page.waitForTimeout(500)
		const mobile = await readState(page)
		await page.close()
		if (desktop.table === "none" || desktop.cards !== "none")
			throw new Error(`desktop wrong: table=${desktop.table} cards=${desktop.cards} (md:block must beat hidden)`)
		if (mobile.table !== "none" || mobile.cards === "none")
			throw new Error(`mobile wrong: table=${mobile.table} cards=${mobile.cards}`)
		// Same page in focused mode with react-grab active: responsive variants
		// must still win, and the editor's shadow-root styles must be intact.
		const fpage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await fpage.goto(`http://localhost:${port}/?page=listing&mode=focused`)
		await fpage.waitForSelector('[data-testid="desktop-table"]', { state: "attached", timeout: 15000 })
		await fpage.waitForTimeout(2500)
		const focused = await fpage.evaluate(() => {
			const sr = document.querySelector("[data-react-grab]")?.shadowRoot
			return {
				table: getComputedStyle(document.querySelector('[data-testid="desktop-table"]')!).display,
				editorStyleBytes: sr
					? [...sr.querySelectorAll("style")].reduce((n, s) => n + (s.textContent || "").length, 0)
					: 0,
			}
		})
		await fpage.close()
		if (focused.table === "none") throw new Error("focused mode: md:block still loses to hidden")
		if (focused.editorStyleBytes < 1000)
			throw new Error(`react-grab shadow styles missing (${focused.editorStyleBytes} bytes)`)
		return `desktop: table ${desktop.table}/cards ${desktop.cards}; mobile inverse; focused-mode table ${focused.table}, editor styles ${Math.round(focused.editorStyleBytes / 1024)}KB intact`
	})

	await scenario("o. element click resolves the exact source line (fragment page)", async () => {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=fragmented&mode=focused`)
		await page.waitForSelector('[data-testid="frag-title"]', { state: "attached", timeout: 15000 })
		await page.waitForTimeout(2500)
		await page.evaluate(() => {
			;(window as any).__SELECTED__ = []
			window.addEventListener("message", (e) => {
				if (e.data?.type === "element-selected") (window as any).__SELECTED__.push(e.data.payload)
			})
		})
		const h1 = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="frag-title"]')!
			const r = el.getBoundingClientRect()
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
		})
		await page.mouse.click(h1.x, h1.y)
		await waitFor(
			async () => ((await page.evaluate(() => (window as any).__SELECTED__)) as any[]).length > 0,
			10000,
			"element-selected message",
		)
		// Exactly one, not at-least-one. At top level `window.parent === window`,
		// and the focused view's iframe relay used to re-post every message onto
		// its own window — so each user action reached the host TWICE. In the
		// desktop app that duplicate applied every inline edit twice and corrupted
		// text ("lane" -> "lanes" -> "laness"). One click, one message, is the
		// contract this pins.
		await page.waitForTimeout(600)
		const selected = (await page.evaluate(() => (window as any).__SELECTED__)) as any[]
		const sel = selected[0]
		await page.close()
		if (selected.length !== 1) {
			throw new Error(
				`one click delivered ${selected.length} element-selected messages — the iframe relay is duplicating again`,
			)
		}
		if (!String(sel.filePath).includes("pages/fragmented")) throw new Error(`wrong file: ${JSON.stringify(sel)}`)
		if (sel.lineNumber !== FRAGMENT_H1_LINE)
			throw new Error(`resolved line ${sel.lineNumber}, expected ${FRAGMENT_H1_LINE} (source capture broken?)`)
		return `clicked h1 in a fragment file resolves to ${sel.filePath}:${sel.lineNumber} exactly`
	})

	await scenario("p. a page opens from the canvas even when meta.json disagrees about its id", async () => {
		// The canvas decides a card is openable with
		// `routes.some(r => r.name === page.id)` — route names being folders. When
		// the id came from meta.json instead, a page with a mismatched id rendered
		// and thumbnailed perfectly and silently could not be opened, with no
		// error anywhere. The folder is the identity; this pins that.
		const { page } = await openCanvas(ctx)

		const card = page.locator('.caret-canvas-frame:has-text("Renamed")')
		await card.waitFor({ timeout: 20000 })

		const cursor = await card.evaluate((element) => getComputedStyle(element as HTMLElement).cursor)
		if (cursor !== "pointer") {
			await page.close()
			throw new Error(`the card is not clickable (cursor=${cursor}) — its meta.json id is winning over its folder`)
		}

		await card.click()
		await page.waitForSelector(".caret-focused-iframe", { timeout: 15000 })
		const opened = await page.evaluate(
			() => (document.querySelector(".caret-focused-iframe") as HTMLIFrameElement | null)?.src ?? "",
		)
		await page.close()

		// The folder name is what the route and the editor must both use.
		if (!opened.includes("page=renamed")) throw new Error(`focused the wrong page: ${opened}`)
		return "a folder/meta id mismatch still opens, on the folder's own id"
	})

	await scenario("q. a page added while the canvas is open becomes clickable without a reload", async () => {
		// The reported shape: the agent adds a terms page mid-session, its
		// thumbnail appears (metas refresh over REST), and it cannot be opened —
		// `hasRoute` consulted the routes array from the canvas's initial static
		// import, which nothing ever refreshed. The router module is now
		// self-accepting HMR and announces its routes on every evaluation; this
		// adds a page to the LIVE server and requires the click to work with zero
		// page reloads.
		const { page, counters } = await openCanvas(ctx)
		await page.waitForSelector(".caret-canvas-frame", { timeout: 20000 })
		const navsBefore = counters.navigations

		const termsDir = path.join(ctx.caretDir, "pages", "terms")
		await fs.mkdir(termsDir, { recursive: true })
		await fs.writeFile(path.join(termsDir, "index.tsx"), PAGE_TEMPLATE("terms", "Terms"))
		await fs.writeFile(
			path.join(termsDir, "meta.json"),
			JSON.stringify({ id: "terms", title: "Terms", type: "page", states: [], tags: ["fixture"] }, null, 2),
		)

		const card = page.locator('.caret-canvas-frame:has-text("Terms")')
		await card.waitFor({ timeout: 20000 })

		// Clickability, not just presence — presence was never the bug.
		await waitFor(
			async () => (await card.evaluate((el) => getComputedStyle(el as HTMLElement).cursor)) === "pointer",
			15000,
			"the new page's card to become clickable",
		)
		await card.click()
		await page.waitForSelector(".caret-focused-iframe", { timeout: 15000 })

		const navs = counters.navigations - navsBefore
		await page.close()

		// Cleanup so the fixture stays canonical for anything after us.
		await fs.rm(termsDir, { recursive: true, force: true })

		if (navs > 0) throw new Error(`the route refresh caused ${navs} page reload(s) — the zero-reload contract broke`)
		return "added live, clickable, opened — 0 reloads"
	})

	await scenario("r. @ picks an asset in the instruction box without sending it", async () => {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=home&mode=focused`)
		await page.waitForSelector(".caret-focused-paint-btn", { timeout: 15000 })
		await page.waitForTimeout(2000)
		await page.evaluate(() => {
			;(window as any).__POSTED__ = []
			window.addEventListener("message", (e) => {
				if (e.data?.type === "overlay-edit") (window as any).__POSTED__.push(e.data.payload?.instruction || "")
			})
			;(window as any).__REACT_GRAB__?.deactivate?.()
		})

		await page.click(".caret-focused-paint-btn", { force: true })
		await page.waitForTimeout(300)
		await page.mouse.move(200, 200)
		await page.mouse.down()
		await page.mouse.move(500, 400, { steps: 5 })
		await page.mouse.up()

		const input = page.locator(".caret-overlay-prompt input, .caret-overlay-prompt textarea")
		await input.waitFor({ timeout: 5000 })
		await input.click()
		await page.keyboard.type("Put @her")

		await page.waitForSelector("[data-caret-asset-picker]", { timeout: 5000 })
		const option = page.locator('[data-caret-asset-option="hero-shot"]')
		await option.waitFor({ timeout: 5000 })

		// The thumbnail decoding is the assertion that the picker's URL is the same
		// one the canvas and the agent use. An <img> that exists but never paints
		// would look identical in a screenshot of the DOM.
		const thumbWidth = await waitFor2(
			async () => {
				const width = await option.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)
				return width > 0 ? width : null
			},
			10000,
			"the picker thumbnail to decode",
		)
		if (thumbWidth !== 240) throw new Error(`the picker thumbnail decoded at ${thumbWidth}px, not the real asset`)

		// **Clicking** the row, which is how a person picks and how this was
		// reported broken: hovering used to rebuild the list, so the element under
		// the cursor was replaced between mousedown and mouseup, no click ever
		// fired, and the bare "@" stayed in the box. Hovering first is the point.
		await option.hover()
		await page.waitForTimeout(150)
		await option.click()
		await page.waitForTimeout(300)
		const afterClick = await input.inputValue()
		if (!afterClick.includes("@hero-shot")) throw new Error(`clicking the row left the box as "${afterClick}"`)

		// Enter must reach the picker before the submit handler on the same
		// element, or choosing an asset also sends a half-written instruction.
		await page.fill(".caret-overlay-prompt input, .caret-overlay-prompt textarea", "")
		await input.click()
		await page.keyboard.type("Put @her")
		await page.waitForSelector("[data-caret-asset-picker]", { timeout: 5000 })
		await page.keyboard.press("Enter")
		await page.waitForTimeout(400)
		const afterPick = await input.inputValue()
		if (!afterPick.includes("@hero-shot")) throw new Error(`the pick did not reach the input: "${afterPick}"`)
		const sentEarly = (await page.evaluate(() => (window as any).__POSTED__)) as string[]
		if (sentEarly.length > 0) throw new Error(`choosing an asset also sent the instruction: ${JSON.stringify(sentEarly)}`)

		await page.keyboard.type("behind the headline")
		await page.keyboard.press("Enter")
		await waitFor(
			async () => ((await page.evaluate(() => (window as any).__POSTED__)) as string[]).length > 0,
			15000,
			"the overlay-edit message",
		)
		const sent = (await page.evaluate(() => (window as any).__POSTED__)) as string[]
		await page.close()
		if (!sent[0].includes("@hero-shot")) throw new Error(`the tag did not survive into the instruction: "${sent[0]}"`)

		return `picked by click and by Enter, neither sent early, instruction carried the tag: "${sent[0]}"`
	})

	await scenario("s. picking in react-grab's own prompt box does not read as 'discard'", async () => {
		// The AI-edit box belongs to react-grab and lives in its shadow root. In
		// prompt mode it watches window pointerdown in the capture phase and reads
		// any press outside its selection as a dismissal — which put "Discard?" on
		// screen when the user clicked an asset. Their escape hatch is an
		// attribute matched through composedPath(), so this asserts the outcome
		// rather than the attribute: no discard prompt, and the tag in the box.
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		await page.goto(`http://localhost:${port}/?page=home&mode=focused`)
		await page.waitForSelector(".caret-focused-paint-btn", { timeout: 15000 })
		await page.waitForTimeout(2500)

		await page.evaluate(() => {
			;(window as any).__POSTED_AI__ = []
			window.addEventListener("message", (e) => {
				if (e.data?.type === "ai-edit-request") (window as any).__POSTED_AI__.push(e.data.payload?.instruction || "")
			})
			;(window as any).__REACT_GRAB__?.activate?.()
		})
		await page.waitForTimeout(500)

		// Driven through the mouse rather than a locator click: react-grab's overlay
		// sits over the page, so Playwright's actionability check never clears.
		const target = await page.evaluate(() => {
			const el = document.querySelector("h1") as HTMLElement
			const r = el.getBoundingClientRect()
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
		})
		await page.mouse.move(target.x, target.y)
		await page.waitForTimeout(300)
		await page.mouse.click(target.x, target.y, { button: "right" })
		await page.waitForTimeout(600)

		const aiEdit = page.getByText("AI Edit", { exact: true }).first()
		try {
			await aiEdit.waitFor({ timeout: 8000 })
		} catch {
			const menu = await page.evaluate(() => {
				const host = document.querySelector("[data-react-grab]") as HTMLElement | null
				return host?.shadowRoot?.textContent?.slice(0, 300) ?? "no shadow root"
			})
			await page.close()
			throw new Error(`react-grab's menu never offered AI Edit. Menu text: ${menu}`)
		}
		await aiEdit.click()

		const promptBox = page.locator("[data-react-grab-input]").first()
		await promptBox.waitFor({ timeout: 8000 })
		await promptBox.click()
		await page.keyboard.type("Put @her")

		await page.waitForSelector("[data-caret-asset-picker]", { timeout: 8000 })
		const option = page.locator('[data-caret-asset-option="hero-shot"]')
		await option.waitFor({ timeout: 8000 })
		// Which events actually carry the picker on their path is the whole question
		// here: react-grab's guard is `composedPath().some(hasAttribute)`, so an
		// event that misses it is an event react-grab will act on.
		await page.evaluate(() => {
			;(window as any).__EV__ = []
			for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "focusout", "blur"]) {
				window.addEventListener(
					type,
					(e: Event) => {
						const onPath = e.composedPath().some((n) => (n as HTMLElement)?.hasAttribute?.("data-caret-asset-picker"))
						;(window as any).__EV__.push(`${type}:${onPath ? "picker" : "elsewhere"}`)
					},
					true,
				)
			}
		})

		const row = await option.evaluate((el) => {
			const r = el.getBoundingClientRect()
			const x = r.x + r.width / 2
			const y = r.y + r.height / 2
			// What the browser would actually deliver a press to. react-grab's
			// overlay sits at the maximum z-index, and losing this hit test is
			// invisible — the popup still paints, it just never receives anything.
			const onTop = document.elementFromPoint(x, y) as HTMLElement | null
			return {
				x,
				y,
				hitsPicker: !!onTop?.closest?.("[data-caret-asset-picker]"),
				onTop: onTop
					? `${onTop.tagName.toLowerCase()}${[...onTop.attributes].map((a) => `[${a.name}]`).join("")}`
					: "nothing",
				stack: document
					.elementsFromPoint(x, y)
					.slice(0, 4)
					.map((n) => (n as HTMLElement).tagName.toLowerCase())
					.join(">"),
				popupRect: (() => {
					const p = document.querySelector("[data-caret-asset-picker]") as HTMLElement | null
					if (!p) return "no popup"
					const b = p.getBoundingClientRect()
					const cs = getComputedStyle(p)
					return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} pe=${cs.pointerEvents} disp=${cs.display} vis=${cs.visibility} parent=${p.parentElement?.tagName.toLowerCase()}`
				})(),
				rowRect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
			}
		})
		if (!row.hitsPicker) {
			await page.close()
			throw new Error(
				`${row.onTop} is stacked over the picker (stack ${row.stack}); popup ${row.popupRect}; row ${row.rowRect}`,
			)
		}
		await page.mouse.move(row.x, row.y)
		await page.waitForTimeout(200)
		await page.mouse.click(row.x, row.y)
		await page.waitForTimeout(500)

		const state = await page.evaluate(() => {
			const host = document.querySelector("[data-react-grab]") as HTMLElement | null
			const input = host?.shadowRoot?.querySelector("[data-react-grab-input]") as HTMLTextAreaElement | null
			const popup = document.querySelector("[data-caret-asset-picker]") as HTMLElement | null
			return {
				discarding: (host?.shadowRoot?.querySelectorAll("[data-react-grab-discard-prompt]").length ?? 0) > 0,
				promptBoxPresent: !!input,
				value: input?.value ?? null,
				pickerPresent: !!popup,
				popupHasIgnoreAttr: popup?.hasAttribute("data-react-grab-ignore-events") ?? null,
				posted: (window as any).__POSTED_AI__ ?? [],
				events: (window as any).__EV__ ?? [],
				shadowText: host?.shadowRoot?.textContent?.slice(0, 160) ?? "",
			}
		})
		await page.close()

		if (state.discarding)
			throw new Error(`choosing an asset put react-grab into its discard prompt: ${JSON.stringify(state)}`)
		if (!state.promptBoxPresent) throw new Error(`choosing an asset closed react-grab's prompt box: ${JSON.stringify(state)}`)
		if (!state.value?.includes("@hero-shot")) throw new Error(`the pick did not reach the box: ${JSON.stringify(state)}`)

		return `picked inside react-grab's shadow-root box: "${state.value}", no discard prompt`
	})

	await scenario("t. a token edit restyles a bound page live, with no reload", async () => {
		// Phase 7's live bindings: pages reference `text-brand-500`, the theme
		// defines it from foundation.json, and editing the token restyles every
		// bound element via one CSS hot update. Runs last — it rewrites a fixture
		// page and the foundation.
		const foundationPath = path.join(caretDir, "tokens", "foundation.json")
		const foundation = JSON.parse(await fs.readFile(foundationPath, "utf-8"))
		foundation.color.brand.scale = { "500": "#0b7aff" }
		foundation.color.neutral.scale = { "600": "#5b6472" }
		foundation.typography.scale = { base: 16, "2xl": 31.25 }
		await fs.writeFile(foundationPath, JSON.stringify(foundation, null, 2))
		// What the desktop watcher does on every foundation change.
		await writeThemeCss(caretDir)

		const themeCss = await fs.readFile(path.join(caretDir, "caret-theme.css"), "utf-8")
		for (const expected of [
			"--color-brand-500: #0b7aff;",
			"--color-neutral-600: #5b6472;",
			"--text-2xl: 31.25px;",
			"--radius-lg: 8px;",
		]) {
			if (!themeCss.includes(expected)) throw new Error(`caret-theme.css is missing ${expected}`)
		}

		// Bind an element to the token; HMR delivers the page edit.
		const aboutPath = path.join(caretDir, "pages", "about", "index.tsx")
		const aboutSource = await fs.readFile(aboutPath, "utf-8")
		await fs.writeFile(
			aboutPath,
			aboutSource.replace('<p className="text-zinc-600">', '<p data-testid="bound-copy" className="text-brand-500">'),
		)

		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
		await page.goto(`http://localhost:${port}/?page=about`)
		await page.waitForSelector('[data-testid="bound-copy"]', { timeout: 15000 })
		await waitFor(
			async () =>
				(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="bound-copy"]')!).color)) ===
				"rgb(11, 122, 255)",
			15000,
			"text-brand-500 to resolve to the foundation's own colour",
		)

		// A full reload would clear this — the point is a LIVE binding.
		await page.evaluate(() => {
			;(window as any).__NO_RELOAD__ = true
		})

		foundation.color.brand.scale["500"] = "#dc2626"
		await fs.writeFile(foundationPath, JSON.stringify(foundation, null, 2))
		await writeThemeCss(caretDir)

		await waitFor(
			async () =>
				(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="bound-copy"]')!).color)) ===
				"rgb(220, 38, 38)",
			15000,
			"the bound element to follow the token edit",
		)
		const survived = await page.evaluate(() => (window as any).__NO_RELOAD__ === true)
		await page.close()
		if (!survived) throw new Error("the colour changed, but via a full reload — that is not a live binding")
		return "text-brand-500 followed a token edit through one CSS hot update, no reload"
	})

	await scenario("u. the variant compare surface renders takes and a click picks one", async () => {
		// The pick half of generate-and-pick, without a model: seed two takes and
		// the set on disk, the canvas must overlay the compare surface, keep the
		// takes out of the grid, and post variant-pick on a real click. The apply
		// half needs the host router and is certified in verify:app.
		const contactDir = path.join(caretDir, "pages", "contact")
		for (const n of [1, 2]) {
			const dir = path.join(caretDir, "pages", `contact--v${n}`)
			await fs.mkdir(dir, { recursive: true })
			await fs.copyFile(path.join(contactDir, "index.tsx"), path.join(dir, "index.tsx"))
			await fs.writeFile(
				path.join(dir, "meta.json"),
				JSON.stringify({
					id: `contact--v${n}`,
					title: `Contact — take ${n}`,
					type: "page",
					states: [],
					tags: [],
					variantOf: "contact",
				}),
			)
		}
		await fs.writeFile(
			path.join(caretDir, ".variants.json"),
			JSON.stringify({
				version: 1,
				pageId: "contact",
				instruction: "make it feel warmer",
				startedAt: new Date().toISOString(),
				source: "caret",
				variants: [
					{ id: "contact--v1", label: "Take 1", angle: "a", status: "ready" },
					{ id: "contact--v2", label: "Take 2", angle: "b", status: "ready" },
				],
			}),
		)

		const { page } = await openCanvas(ctx)
		try {
			await page.waitForSelector('[data-testid="variant-compare"]', { timeout: 20000 })
			await page.waitForSelector('[data-testid="variant-card-contact--v1"]', { timeout: 10000 })
			await page.waitForSelector('[data-testid="variant-use-contact--v2"]', { timeout: 10000 })

			// The takes never reach the grid — they are working copies, not pages.
			const gridTakes = await page.evaluate(
				() =>
					Array.from(document.querySelectorAll(".caret-canvas-frame")).filter((f) =>
						(f.textContent || "").includes("take"),
					).length,
			)
			if (gridTakes > 0) throw new Error(`${gridTakes} variant take(s) leaked into the canvas grid`)

			await page.evaluate(() => {
				;(window as any).__PICKED__ = []
				window.addEventListener("message", (e) => {
					if (e.data?.type === "variant-pick") (window as any).__PICKED__.push(e.data.payload?.variantId)
				})
			})
			await page.click('[data-testid="variant-use-contact--v2"]')
			await waitFor(
				async () => ((await page.evaluate(() => (window as any).__PICKED__)) as string[]).length > 0,
				10000,
				"the variant-pick message",
			)
			const picked = (await page.evaluate(() => (window as any).__PICKED__)) as string[]
			if (picked[0] !== "contact--v2") throw new Error(`picked "${picked[0]}", expected contact--v2`)

			return `compare overlay rendered 2 takes + original, grid stayed clean, click posted variant-pick contact--v2`
		} finally {
			await page.close()
			await fs.rm(path.join(caretDir, ".variants.json"), { force: true })
			await fs.rm(path.join(caretDir, "pages", "contact--v1"), { recursive: true, force: true })
			await fs.rm(path.join(caretDir, "pages", "contact--v2"), { recursive: true, force: true })
		}
	})

	await scenario("v. the design-check script finds planted slop tells in a real render", async () => {
		// The checker's DOM half runs inside pages Caret does not control, so it
		// is certified against a real browser render, not a DOM stub. One page,
		// four planted tells; each must be found and nothing else may crash.
		const flawedDir = path.join(caretDir, "pages", "flawed")
		await fs.mkdir(flawedDir, { recursive: true })
		await fs.writeFile(
			path.join(flawedDir, "index.tsx"),
			`export default function Flawed() {
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-2xl font-bold text-zinc-900">Flawed</h1>
      <div style={{ width: 320, height: 200, background: "#d4d4d4" }} />
      <img src="/caret-assets/hero-shot.png" style={{ width: 600 }} />
      <div>
        <div className="p-4">Exactly the same testimonial text repeated here</div>
        <div className="p-4">Exactly the same testimonial text repeated here</div>
        <div className="p-4">A different card so the container has three children</div>
      </div>
    </div>
  )
}
`,
		)
		await fs.writeFile(
			path.join(flawedDir, "meta.json"),
			JSON.stringify({ id: "flawed", title: "Flawed", type: "page", states: [], tags: [] }),
		)

		const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
		try {
			await waitFor(
				async () => {
					await page.goto(`http://localhost:${port}/?page=flawed`).catch(() => {})
					return await page.evaluate(() => !!document.querySelector("img")).catch(() => false)
				},
				20000,
				"the flawed page to render",
			)
			await page.waitForFunction(() => [...document.images].every((img) => img.complete), { timeout: 10000 })

			const findings = (await page.evaluate(DESIGN_CHECKS_DOM_SCRIPT)) as Array<{ check: string; severity: string }>
			const found = new Set(findings.map((f) => f.check))
			for (const expected of ["placeholder-box", "missing-alt", "image-upscaled", "identical-cards"]) {
				if (!found.has(expected)) {
					throw new Error(`planted "${expected}" was not found — findings: ${JSON.stringify(findings)}`)
				}
			}
			return `found all four planted tells: ${[...found].join(", ")}`
		} finally {
			await page.close()
			await fs.rm(flawedDir, { recursive: true, force: true })
		}
	})

	await browser.close()
}

/** `waitFor` for a value rather than a boolean. */
async function waitFor2<T>(probe: () => Promise<T | null>, timeoutMs: number, what: string): Promise<T> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const value = await probe()
		if (value !== null) return value
		await new Promise((resolve) => setTimeout(resolve, 200))
	}
	throw new Error(`timed out waiting for ${what}`)
}

async function cleanup(workspace: string | null) {
	if (viteProc) {
		viteProc.kill()
		viteProc = null
	}
	if (workspace && !KEEP) {
		await fs.rm(workspace, { recursive: true, force: true }).catch(() => {})
	} else if (workspace) {
		log(`fixture kept at ${workspace}`)
	}
}

let fixtureWorkspace: string | null = null
main()
	.catch((err) => {
		console.error("[verify] harness error:", err)
		results.push({ name: "harness", passed: false, detail: String(err) })
	})
	.finally(async () => {
		await cleanup(fixtureWorkspace)
		const width = Math.max(...results.map((r) => r.name.length)) + 2
		console.log("\n========== DESIGN SHELL RELIABILITY CERTIFICATION ==========")
		for (const r of results) {
			console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name.padEnd(width)} ${r.detail}`)
		}
		const failed = results.filter((r) => !r.passed)
		console.log("=============================================================")
		console.log(
			failed.length === 0 ? `CERTIFIED: all ${results.length} scenarios pass` : `${failed.length} scenario(s) FAILED`,
		)
		process.exitCode = failed.length === 0 ? 0 : 1
	})

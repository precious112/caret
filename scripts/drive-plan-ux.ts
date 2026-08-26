/**
 * Drives the built app through the Plan/Act chat UX and screenshots every
 * state a user would see. Not a certification — a pair of eyes.
 *
 * Exists because the toggle shipped once on green unit tests and a verify
 * subset while the composer was visibly broken at its real width. This is the
 * "open the app and look" step, automated so it always happens:
 *
 *   npx tsx scripts/drive-plan-ux.ts
 *
 * Writes shots to /tmp/plan-ux/ and main-process output to
 * /tmp/plan-ux/main.log. Spends a few short model turns on the configured
 * verify model.
 */
import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { _electron as electron, type Page } from "playwright"

import { ensureCaretDirectoryExists } from "../src/core/design"
import { resolveVerifyModel } from "./verify-support"

const OUT = "/tmp/plan-ux"

const PAGE_SOURCE = `export default function Home() {
  return (
    <div data-caret-id="home-root" className="min-h-screen bg-white p-12">
      <h1 data-caret-id="hero-title" className="text-5xl font-bold">Welcome</h1>
      <p data-caret-id="hero-copy" className="mt-4 text-zinc-500">A fixture page.</p>
    </div>
  )
}
`

const APP_SOURCE = `export default function App() {
  return <main><h1>Welcome</h1></main>
}
`

async function buildFixture(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-driveux-"))
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
	const git = (args: string) => child_process.execSync(`git ${args}`, { cwd: dir, stdio: "ignore" })
	git("init -q")
	git("config user.email caret@local")
	git("config user.name Caret")
	git("config commit.gpgSign false")
	git("add -A")
	git('commit -q -m "fixture" --no-verify')
	return dir
}

async function shot(page: Page, name: string): Promise<void> {
	// Animations disabled and one retry: the thinking orb and the fade-ins can
	// hold Playwright's stability wait hostage, and a hung screenshot killed a
	// whole drive once.
	const take = () => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", timeout: 20_000 })
	await take().catch(take)
	console.log(`[drive] shot ${name}`)
}

/** Opens the chat sidebar if it is not already open — the Chat button toggles. */
async function ensureChatOpen(page: Page): Promise<void> {
	if ((await page.locator('[data-testid="chat-transcript"]').count()) > 0) return
	await page.getByTestId("top-bar").getByRole("button", { name: "Chat" }).click()
	await page.waitForSelector('[data-testid="chat-transcript"]', { timeout: 15_000 })
}

/** A copy of the real project the sync failures happen in. DRIVE_SYNC mode. */
async function copyTest2(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-driveux-t2-"))
	child_process.execSync(
		`rsync -a --exclude node_modules --exclude .git --exclude .mcp.json /Users/apple/dev/test-frontend/test2/ ${dir}/`,
		{ stdio: "ignore" },
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

async function main(): Promise<void> {
	await fs.rm(OUT, { recursive: true, force: true })
	await fs.mkdir(OUT, { recursive: true })

	const fixture = process.env.DRIVE_SYNC ? await copyTest2() : await buildFixture()
	const userData = await fs.mkdtemp(path.join(os.tmpdir(), "caret-driveux-profile-"))
	console.log(`[drive] fixture ${fixture}`)

	const app = await electron.launch({
		args: [path.resolve("out/main/index.js"), `--user-data-dir=${userData}`, fixture],
		env: { ...process.env, CARET_VERIFY_PROJECT: fixture, NODE_ENV: "test" },
	})
	const mainLog = await fs.open(path.join(OUT, "main.log"), "w")
	app.process().stdout?.on("data", (chunk) => void mainLog.write(chunk))
	app.process().stderr?.on("data", (chunk) => void mainLog.write(chunk))

	try {
		const chrome = await app.firstWindow({ timeout: 60_000 })
		await chrome.waitForSelector('[data-testid="top-bar"]', { timeout: 60_000 })

		// 1 — chat with no backend: the composer must render sanely even disabled.
		await ensureChatOpen(chrome)
		await shot(chrome, "01-chat-no-backend")

		// 2 — select the bundled backend and pin the verify model, as dd does.
		// DRIVE_MODEL overrides — the point of DRIVE_SYNC is the user's own route.
		const model = process.env.DRIVE_MODEL ? { id: process.env.DRIVE_MODEL, source: "env" } : await resolveVerifyModel()
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Backend" }).click()
		await chrome.waitForSelector('[data-testid="backend-opencode"]', { timeout: 90_000 })
		const row = chrome.getByTestId("backend-opencode")
		const deadline = Date.now() + 90_000
		let ready = false
		while (Date.now() < deadline) {
			if ((await row.textContent())?.includes("ready")) {
				ready = true
				break
			}
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
		if (!ready) throw new Error("the bundled backend never reported ready")
		await row.getByRole("button", { name: "Use this" }).click()
		if (model) {
			const field = chrome.getByTestId("backend-model")
			const tag = await field.evaluate((element) => element.tagName)
			if (tag === "SELECT") await field.selectOption(model.id)
			else {
				await field.fill(model.id)
				await field.blur()
			}
			console.log(`[drive] model pinned: ${model.id}`)
		}
		// A visible effort value, so the composer shows BOTH pills — the exact
		// pair that overlapped into garble at this width once.
		const effortField = chrome.getByTestId("backend-effort")
		if (await effortField.count()) {
			const tag = await effortField.evaluate((element) => element.tagName)
			if (tag === "SELECT") await effortField.selectOption("high").catch(() => {})
			else {
				await effortField.fill("high")
				await effortField.blur()
			}
			console.log("[drive] effort pinned: high")
		}
		await shot(chrome, "02a-backend-selected")
		await chrome.getByTestId("top-bar").getByRole("button", { name: "Backend" }).click()
		await ensureChatOpen(chrome)

		// The pill row, measured rather than eyeballed: the model pill and the
		// effort pill overlapped once, and a screenshot can show it but not say
		// why. Dump each control's box and the row's HTML.
		if (process.env.DRIVE_INSPECT) {
			const rowInfo = await chrome.evaluate(() => {
				const pill = document.querySelector('[data-testid="chat-model-pill"]')
				const row = pill?.parentElement?.parentElement
				if (!row) return "no row"
				const boxes = [...row.children].map((child) => {
					const rect = child.getBoundingClientRect()
					return `${child.tagName}.${(child as HTMLElement).className.split(" ").slice(0, 4).join(".")} x=${Math.round(rect.x)} w=${Math.round(rect.width)}`
				})
				return `${boxes.join("\n")}\n---\n${row.outerHTML.slice(0, 1500)}`
			})
			console.log(`[drive] control row:\n${rowInfo}`)
			await shot(chrome, "inspect-composer")
			return
		}
		const usable = Date.now() + 60_000
		while (Date.now() < usable) {
			if (
				(await chrome
					.getByTestId("chat-input")
					.isDisabled()
					.catch(() => true)) === false
			)
				break
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
		if (await chrome.getByTestId("chat-input").isDisabled()) throw new Error("the chat never became usable")
		await shot(chrome, "02-composer-ready-act")

		// DRIVE_SYNC: the user's actual gesture — click Sync, wait for the plan
		// card. This is the flow that failed every time on their route.
		if (process.env.DRIVE_SYNC) {
			await chrome.getByTestId("top-bar").getByRole("button", { name: "Sync" }).click()
			const commit = chrome.getByTestId("notification-stack").getByRole("button", { name: "Commit .caret/ changes" })
			await commit.waitFor({ timeout: 30_000 }).then(
				() => commit.click(),
				() => {},
			)
			console.log(`[drive] sync started, waiting for the plan card…`)
			await chrome.waitForSelector('[data-testid="chat-plan"]', { timeout: 600_000 }).catch(async () => {
				const tail = (await chrome.textContent('[data-testid="chat-transcript"]').catch(() => null)) ?? ""
				await shot(chrome, "sync-no-plan")
				throw new Error(`no plan card within 10 minutes; chat tail: …${tail.slice(-500)}`)
			})
			await shot(chrome, "sync-plan-card")
			const cardText = (await chrome.textContent('[data-testid="chat-plan"]').catch(() => null)) ?? ""
			console.log(`[drive] PLAN CARD SETTLED: ${cardText.trim().slice(0, 200)}…`)
			return
		}

		// 3 — flip to Plan with nothing settled: mode change only.
		await chrome.getByTestId("chat-mode-plan").click()
		await new Promise((resolve) => setTimeout(resolve, 500))
		await shot(chrome, "03-composer-plan-mode")

		// 4 — a real plan turn. Mid-stream there must be NO live card.
		await chrome
			.getByTestId("chat-input")
			.fill("In one short paragraph, propose a plan: which design page would you edit to rename the hero, and how?")
		await chrome.getByTestId("chat-input").press("Enter")
		await new Promise((resolve) => setTimeout(resolve, 6000))
		await shot(chrome, "04-plan-turn-streaming")

		await chrome.waitForSelector('[data-testid="chat-plan"]', { timeout: 300_000 })
		await new Promise((resolve) => setTimeout(resolve, 500))
		await shot(chrome, "05-plan-card-settled")

		// 5 — a revision: while it streams, the old card must demote.
		await chrome.getByTestId("chat-input").fill("Shorter. One sentence only.")
		await chrome.getByTestId("chat-input").press("Enter")
		await new Promise((resolve) => setTimeout(resolve, 4000))
		const midStreamCards = await chrome.locator('[data-testid="chat-plan"]').count()
		console.log(`[drive] live cards mid-revision: ${midStreamCards} (want 0)`)
		await shot(chrome, "06-revision-streaming-card-demoted")

		await chrome.waitForSelector('[data-testid="chat-plan"]', { timeout: 300_000 })
		await new Promise((resolve) => setTimeout(resolve, 500))
		await shot(chrome, "07-revised-plan-card")

		console.log("[drive] done — inspect /tmp/plan-ux/*.png and main.log")
	} finally {
		await app.close().catch(() => {})
		await mainLog.close()
	}
}

void main().catch((err) => {
	console.error("[drive] FAILED:", err)
	process.exit(1)
})

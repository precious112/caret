/**
 * Drives Caret's own colour popover (the replacement for the Chromium
 * <input type=color> popup) in the real app: right-click → Edit color →
 * the popover opens beside the element with token swatches, a hex field
 * that accepts a pasted value, and Enter commits ONE write.
 *
 *   npm run build && npx tsx scripts/probe-color-popover.ts
 */
import * as child_process from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { _electron as electron } from "playwright"

import { ensureCaretDirectoryExists } from "../src/core/design/scaffold"

const PAGE = `export default function Page() {
  return (
    <div className="p-12">
      <h1 data-caret-id="title" className="text-3xl">Colour probe</h1>
      <a data-caret-id="cta" href="#" className="mt-8 inline-block rounded-lg bg-error px-12 py-6 text-2xl text-white">Add a bean</a>
    </div>
  )
}
`

async function main(): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "caret-color-probe-"))
	await ensureCaretDirectoryExists(dir)
	const pageDir = path.join(dir, ".caret", "pages", "colorpage")
	await fs.mkdir(pageDir, { recursive: true })
	const pagePath = path.join(pageDir, "index.tsx")
	await fs.writeFile(pagePath, PAGE)
	await fs.writeFile(
		path.join(pageDir, "meta.json"),
		JSON.stringify({ id: "colorpage", title: "Colour probe", type: "page", states: ["default"], tags: ["demo"] }, null, 2),
	)
	const git = (args: string) => child_process.execSync(`git ${args}`, { cwd: dir, stdio: "ignore" })
	git("init -q")
	git("config user.email caret@local")
	git("config user.name Caret")
	git("add -A")
	git("commit -qm fixture")

	const userData = await fs.mkdtemp(path.join(os.tmpdir(), "caret-color-probe-profile-"))
	const app = await electron.launch({
		args: [path.resolve("out/main/index.js"), `--user-data-dir=${userData}`, dir],
		env: { ...process.env, CARET_VERIFY_PROJECT: dir, NODE_ENV: "test" },
	})
	try {
		const outcome = await app.evaluate(async ({ BrowserWindow }) => {
			try {
				let wc: any = null
				let deadline = Date.now() + 120_000
				while (Date.now() < deadline && !wc) {
					for (const win of BrowserWindow.getAllWindows()) {
						const views = (win.contentView?.children ?? []) as any[]
						const found = views.find(
							(v) => v.webContents && !v.webContents.isDestroyed() && v.webContents.getURL().startsWith("http://localhost"),
						)
						if (found) wc = found.webContents
					}
					if (!wc) await new Promise((r) => setTimeout(r, 500))
				}
				if (!wc) return { error: "no canvas view appeared" }

				deadline = Date.now() + 120_000
				let opened = false
				while (Date.now() < deadline && !opened) {
					opened = await wc
						.executeJavaScript(
							`(() => {
								const card = Array.from(document.querySelectorAll('.caret-canvas-frame-title')).find((n) => n.textContent && n.textContent.includes('Colour probe'))
								if (!card) return false
								card.closest('.caret-canvas-frame').dispatchEvent(new MouseEvent('click', { bubbles: true }))
								return true
							})()`,
						)
						.catch(() => false)
					if (!opened) await new Promise((r) => setTimeout(r, 500))
				}
				if (!opened) return { error: "the page card never appeared" }

				let pageFrame: any = null
				deadline = Date.now() + 60_000
				while (Date.now() < deadline) {
					pageFrame = wc.mainFrame.frames.find((f: any) => f.url.includes("mode=focused") && f.url.includes("page=colorpage")) ?? null
					if (pageFrame) {
						const ready = await pageFrame.executeJavaScript(`!!document.querySelector('[data-caret-id="cta"]')`).catch(() => false)
						if (ready) break
					}
					await new Promise((r) => setTimeout(r, 300))
				}
				if (!pageFrame) return { error: "the focused page never became a frame" }
				await pageFrame.executeJavaScript(`((window).__REACT_GRAB__?.activate?.(), true)`).catch(() => {})
				await new Promise((r) => setTimeout(r, 800))

				const offset = await wc.executeJavaScript(
					`(() => { const r = document.querySelector('.caret-focused-iframe').getBoundingClientRect(); return { x: r.x, y: r.y } })()`,
				)
				const target = await pageFrame.executeJavaScript(
					`(() => { const r = document.querySelector('[data-caret-id="cta"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
				)
				const at = { x: Math.round(offset.x + target.x), y: Math.round(offset.y + target.y) }

				let menuClicked = false
				for (let attempt = 0; attempt < 5 && !menuClicked; attempt++) {
					pageFrame = wc.mainFrame.frames.find((f: any) => f.url.includes("page=colorpage")) ?? pageFrame
					wc.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y })
					await new Promise((r) => setTimeout(r, 300))
					wc.sendInputEvent({ type: "mouseDown", x: at.x, y: at.y, button: "right", clickCount: 1 })
					wc.sendInputEvent({ type: "mouseUp", x: at.x, y: at.y, button: "right", clickCount: 1 })
					const menuDeadline = Date.now() + 4000
					while (Date.now() < menuDeadline && !menuClicked) {
						menuClicked = await pageFrame
							.executeJavaScript(
								`(() => {
									const host = document.querySelector('[data-react-grab]')
									const root = host && host.shadowRoot
									if (!root) return false
									const items = Array.from(root.querySelectorAll('button, [role="menuitem"], div'))
									const item = items.find((n) => n.textContent && n.textContent.trim() === 'Edit color')
									if (!item) return false
									item.click()
									return true
								})()`,
							)
							.catch(() => false)
						if (!menuClicked) await new Promise((r) => setTimeout(r, 250))
					}
				}
				if (!menuClicked) return { error: "react-grab's menu never offered Edit color" }

				// The popover: present, beside the element (not overlapping, not 0,0),
				// with token swatches and a working hex field.
				await new Promise((r) => setTimeout(r, 600))
				const popover = await pageFrame.executeJavaScript(
					`(() => {
						const pop = document.querySelector('#caret-color-popover')
						if (!pop) return { present: false }
						const p = pop.getBoundingClientRect()
						const e = document.querySelector('[data-caret-id="cta"]').getBoundingClientRect()
						const overlap = e.left < p.right && e.right > p.left && e.top < p.bottom && e.bottom > p.top
						return {
							present: true,
							atOrigin: p.left < 4 && p.top < 4,
							overlap,
							swatches: pop.querySelectorAll('[data-color-token]').length,
							hex: !!pop.querySelector('[data-color-hex]'),
							nativeInput: !!document.querySelector('input[type="color"]'),
						}
					})()`,
				)
				if (!popover.present) return { error: "the colour popover never opened", popover }

				// Paste-style entry: set the hex, one input event, Enter commits.
				const fed = await pageFrame.executeJavaScript(
					`(() => {
						const input = document.querySelector('#caret-color-popover [data-color-hex]')
						if (!input) return false
						const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
						setter.call(input, '9b4708')
						input.dispatchEvent(new Event('input', { bubbles: true }))
						input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
						return true
					})()`,
				)
				if (!fed) return { error: "the hex field would not take a value", popover }

				await new Promise((r) => setTimeout(r, 2500))
				const after = await pageFrame.executeJavaScript(
					`JSON.stringify({
						popoverGone: !document.querySelector('#caret-color-popover'),
						toast: document.querySelector('[data-caret-toast]')?.textContent ?? document.querySelector('#caret-detach-toast')?.textContent ?? null,
					})`,
				)
				return { ok: true, popover, after }
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) }
			}
		})

		console.log("outcome:", JSON.stringify(outcome, null, 2))
		const after = await fs.readFile(pagePath, "utf-8")
		console.log("--- file state ---")
		if (after.includes("bg-[#9b4708]")) console.log("FILE EDITED ✓ — one write, bg-error → bg-[#9b4708] (detach; no token to match in this fixture)")
		else if (!after.includes("bg-error")) console.log("FILE CHANGED to:", after.match(/bg-\S+/)?.[0])
		else console.log("FILE UNCHANGED ✗ — still bg-error")
	} finally {
		await app.close().catch(() => {})
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
		await fs.rm(userData, { recursive: true, force: true }).catch(() => {})
	}
}

main().catch((err) => {
	console.error(err)
	process.exitCode = 1
})

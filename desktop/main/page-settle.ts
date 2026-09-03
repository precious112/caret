/**
 * The settle contract every hidden-window render shares: what must have
 * happened before a frame of a design page is worth reading.
 *
 * `did-finish-load` fires well before a page *looks* finished, and each gap
 * between "loaded" and "looks finished" has burned an agent at least once:
 *
 * - **Mount.** The entry awaits the route loader before mounting, so `#root`
 *   is empty well past `did-finish-load`. Every wait below reads the mounted
 *   DOM — sampled too early, the image set is empty, the checks pass
 *   vacuously, and the capture certifies a frame that is still blank.
 * - **Fonts and images.** Webfonts still swapping and images still decoding
 *   read to an agent as "the page is broken" — the most expensive possible
 *   false signal in a loop whose whole point is the agent judging its own
 *   work. Images are re-sampled until the set is stable: they can mount late,
 *   and a cold dev server can take seconds per asset.
 * - **3D models.** `<model-viewer>` paints into a shadow-root canvas only
 *   after its `.glb` arrives; nothing about it ever appears in
 *   `document.images`, so a capture that only waits on images shows the empty
 *   surface underneath — which the agent then reports as "the model doesn't
 *   render" about a page that renders fine.
 * - **WebGL.** A `<canvas>` draws on its own clock after mount; the capture
 *   is compositor-level, so all it needs is a beat for the first real frames.
 *
 * One script, parameterized by deadline, because three call sites carried
 * byte-identical copies that drifted only in their bugs. The screenshot path
 * gives it 30s (its cap is the price of a hang, not of an error — a broken
 * image resolves immediately through the `broken` report); the checks and
 * overlay paths give it a few seconds, enough for the honest cases they read.
 *
 * Returns `{ broken, pending, pendingModels }` — what did NOT settle, so the
 * caller can say "still loading when captured" instead of letting the agent
 * conclude its own work failed.
 */
export function settleScript(deadlineMs: number): string {
	return `(async () => {
		const deadline = Date.now() + ${deadlineMs}
		const timeLeft = () => Math.max(0, deadline - Date.now())
		const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

		// Mount: the page or its error card, whichever the loader produced.
		while (Date.now() < deadline) {
			const root = document.getElementById("root")
			if (root && root.children.length > 0) break
			await new Promise((r) => setTimeout(r, 50))
		}

		// Fonts, then every image, looped until the image set is stable.
		while (Date.now() < deadline) {
			await document.fonts.ready
			const seen = [...document.images]
			await Promise.race([
				Promise.all(
					seen.map((img) =>
						img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r }),
					),
				),
				new Promise((r) => setTimeout(r, timeLeft())),
			])
			await raf2()
			const now = [...document.images]
			if (now.length === seen.length && now.every((img) => img.complete)) break
		}

		// 3D models: wait for the element class to exist, then for each viewer's
		// own load (or error) event. The load event fires only after upgrade, so
		// listeners attached post-whenDefined cannot miss it.
		const viewers = [...document.querySelectorAll("model-viewer")]
		if (viewers.length > 0) {
			await Promise.race([
				customElements.whenDefined("model-viewer").then(() =>
					Promise.all(
						viewers.map((v) =>
							v.loaded ? null : new Promise((r) => {
								v.addEventListener("load", r, { once: true })
								v.addEventListener("error", r, { once: true })
							}),
						),
					),
				),
				new Promise((r) => setTimeout(r, timeLeft())),
			])
		}

		// WebGL/canvas content: a couple of frames so the compositor holds real
		// pixels, not the clear color.
		if (viewers.length > 0 || document.querySelector("canvas")) {
			await new Promise((r) => setTimeout(r, Math.min(300, timeLeft())))
			await raf2()
		}

		const relative = (src) => { try { return new URL(src, location.href).pathname } catch { return src } }
		return {
			broken: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => relative(img.src)),
			pending: [...document.images].filter((img) => !img.complete).map((img) => relative(img.src)),
			pendingModels: viewers.filter((v) => !v.loaded).map((v) => relative(v.getAttribute("src") || "<model-viewer>")),
		}
	})()`
}

/** What `settleScript` resolves to: everything that did NOT settle in time. */
export interface SettleReport {
	broken: string[]
	pending: string[]
	pendingModels: string[]
}

export const EMPTY_SETTLE_REPORT: SettleReport = { broken: [], pending: [], pendingModels: [] }

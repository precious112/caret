/**
 * The shader taste gate: the full authoring loop, run for real, across a
 * spread of briefs — and a gallery a person can look at before any UI exists.
 *
 *   npx tsx scripts/probe-shader-gallery.ts            # all 8 briefs
 *   npx tsx scripts/probe-shader-gallery.ts "lava lamp for a music app"
 *
 * Writes release/shader-gallery/: per brief, a poster PNG, the critique-round
 * frames, the fragment + manifest, and a live.html where the shader actually
 * ANIMATES — open index.html and judge the motion, because a still of an
 * animated background is only half the evidence.
 *
 * Same split as probe-mark: tsx orchestrates and talks to the backend; every
 * render spawns a fresh Electron with a plain-JS main (the hidden-window
 * config probe-shader.ts certified). Costs real turns on the verify backend,
 * so it is a script, never a suite.
 */
import { spawn } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { BackendSession, FoundationTokens } from "../src/core/design"
import { derivePalette, disposeBackends, foundationWords } from "../src/core/design"
import { probeVision } from "../src/core/design/agent/vision"
import {
	buildShaderRenderHtml,
	type ExtractedShader,
	extractShaderReply,
	SHADER_COMPILE_RETRIES,
	SHADER_CRITIQUE_TIMES,
	SHADER_SYSTEM_PROMPT,
	shaderCompileFixPrompt,
	shaderCritiquePrompt,
	shaderOpeningPrompt,
	shaderRejectionPrompt,
} from "../src/core/design/asset-library/shader/authoring"
import { resolveVerifyModel } from "./verify-support"

const OUT = path.resolve("release/shader-gallery")
const FRAME_SIZE = { width: 640, height: 400 }
const POSTER_SIZE = { width: 1600, height: 1000 }

const BRIEFS = [
	"a slow aurora for a hero section",
	"a grainy warm gradient, calm, like evening light",
	"liquid metal, dark and expensive",
	"drifting topographic contour lines for a section divider",
	"a soft mesh gradient in brand colors for a card surface",
	"dark-mode embers, barely moving",
	"paper texture with a slow light drift",
	"gentle waves of the brand color for a footer",
]

/** The same foundation probe-mark judges against — a real palette, not neon defaults. */
const tokens: FoundationTokens = {
	vibe: { description: "", tags: [] },
	color: {
		brand: { seed: "#2563eb", scale: {} },
		neutral: { character: "cool", scale: {} },
		semantic: { success: "#16a34a", warning: "#ca8a04", error: "#dc2626", info: "#2563eb" },
		surface: "light",
	},
	typography: { fontFamily: "Inter", fallback: "system-ui", scaleRatio: 1.25, baseSize: 16, scale: {} },
	spacing: { baseUnit: 4, scale: [0, 4, 8] },
	radius: { character: "soft", scale: [0, 4, 8] },
}

interface RenderOutcome {
	ok: boolean
	/** The GLSL compiler's own words, when !ok. */
	error?: string
	/** One PNG per requested timestamp, in order, when ok. */
	frames: Buffer[]
}

/**
 * Compiles and renders one shader in a fresh hidden-window Electron.
 * probe-shader.ts certified this exact configuration; `offscreen: true` is
 * deliberately absent (it froze between captures).
 */
async function render(
	shader: ExtractedShader,
	size: { width: number; height: number },
	timestamps: number[],
): Promise<RenderOutcome> {
	const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "caret-shader-"))
	const htmlPath = path.join(scratch, "shader.html")
	const mainPath = path.join(scratch, "main.js")
	const resultPath = path.join(scratch, "result.json")

	await fs.writeFile(htmlPath, buildShaderRenderHtml(shader.body, shader.uniforms, size), "utf-8")
	await fs.writeFile(
		mainPath,
		`const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const finish = (result) => { fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result)); app.exit(0) }
setTimeout(() => finish({ ok: false, error: "render timed out after 20s" }), 20000)
app.whenReady().then(async () => {
	try {
		const win = new BrowserWindow({
			show: false,
			width: ${size.width},
			height: ${size.height},
			paintWhenInitiallyHidden: true,
			webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
		})
		await win.loadFile(${JSON.stringify(htmlPath)})
		await win.webContents.executeJavaScript(
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))))"
		)
		const state = await win.webContents.executeJavaScript("window.__caretShader")
		if (!state || state.error) return finish({ ok: false, error: (state && state.error) || "the shader page never initialised" })

		const frames = []
		for (const t of ${JSON.stringify(timestamps)}) {
			await win.webContents.executeJavaScript("window.__caretDrawAt(" + t + ")")
			await new Promise((r) => setTimeout(r, 120))
			const image = await win.webContents.capturePage()
			frames.push(image.toPNG().toString("base64"))
		}
		finish({ ok: true, frames })
	} catch (err) {
		finish({ ok: false, error: String((err && err.message) || err) })
	}
})
`,
		"utf-8",
	)

	const electron = path.join(process.cwd(), "node_modules", ".bin", "electron")
	await new Promise<void>((resolve) => {
		const child = spawn(electron, [mainPath], { stdio: "ignore" })
		child.on("exit", () => resolve())
		child.on("error", () => resolve())
	})

	try {
		const raw = JSON.parse(await fs.readFile(resultPath, "utf-8"))
		return {
			ok: raw.ok === true,
			error: raw.error ? String(raw.error) : undefined,
			frames: Array.isArray(raw.frames) ? raw.frames.map((f: string) => Buffer.from(f, "base64")) : [],
		}
	} catch {
		return { ok: false, error: "electron exited without writing a result", frames: [] }
	} finally {
		await fs.rm(scratch, { recursive: true, force: true })
	}
}

async function turn(session: BackendSession, input: { text: string; images?: string[] }): Promise<string> {
	let text = ""
	for await (const event of session.send(input)) {
		if (event.type === "text" || event.type === "done") text += event.text
		if (event.type === "error" && !event.recoverable) throw new Error(event.message)
	}
	return text
}

/**
 * One brief through the whole loop: emit → (reject/compile-fix)* → critique →
 * best compiling answer. Returns null when nothing ever compiled.
 */
async function authorOne(
	session: BackendSession,
	brief: string,
	colors: string[],
	paletteWords: string,
	vision: boolean,
	log: (line: string) => void,
): Promise<{ shader: ExtractedShader; frames: Buffer[]; rounds: number } | null> {
	let reply = await turn(session, { text: shaderOpeningPrompt(brief, paletteWords, colors) })
	let best: { shader: ExtractedShader; frames: Buffer[] } | null = null
	let rounds = 0

	// Extraction/compile fixes: the machine-checkable half of the loop.
	let fixes = 0
	let current: ExtractedShader | null = null
	while (fixes <= SHADER_COMPILE_RETRIES) {
		rounds += 1
		const extracted = extractShaderReply(reply)
		if (!extracted.ok) {
			log(`  reply rejected: ${extracted.reason}`)
			fixes += 1
			if (fixes > SHADER_COMPILE_RETRIES) break
			reply = await turn(session, { text: shaderRejectionPrompt(extracted.reason) })
			continue
		}
		const rendered = await render(extracted.shader, FRAME_SIZE, SHADER_CRITIQUE_TIMES)
		if (!rendered.ok) {
			log(`  compile failed: ${(rendered.error ?? "").split("\n")[0]}`)
			fixes += 1
			if (fixes > SHADER_COMPILE_RETRIES) break
			reply = await turn(session, { text: shaderCompileFixPrompt(rendered.error ?? "") })
			continue
		}
		current = extracted.shader
		best = { shader: extracted.shader, frames: rendered.frames }
		break
	}
	if (!best || !current) return null

	// The taste round: show the model its own frames. One round — the marks
	// loop measured most of the gain in the first look.
	if (vision) {
		log(`  critique round`)
		reply = await turn(session, {
			text: shaderCritiquePrompt(brief),
			images: best.frames.map((f) => `data:image/png;base64,${f.toString("base64")}`),
		})
		rounds += 1
		const corrected = extractShaderReply(reply)
		if (corrected.ok) {
			const rendered = await render(corrected.shader, FRAME_SIZE, SHADER_CRITIQUE_TIMES)
			// Best COMPILING answer wins — a correction that broke the compile
			// never replaces a round that worked.
			if (rendered.ok) best = { shader: corrected.shader, frames: rendered.frames }
			else log(`  correction did not compile — keeping the pre-critique shader`)
		} else {
			log(`  correction rejected (${corrected.reason}) — keeping the pre-critique shader`)
		}
	}

	return { ...best, rounds }
}

function slugOf(brief: string): string {
	return brief
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48)
}

/** live.html: the same page the renderer compiled, plus a clock. It animates. */
function liveHtml(shader: ExtractedShader): string {
	return (
		buildShaderRenderHtml(shader.body, shader.uniforms, FRAME_SIZE) +
		`\n<script>
const start = () => {
	if (!window.__caretShader.ready) { setTimeout(start, 50); return }
	const t0 = performance.now()
	const loop = () => { window.__caretDrawAt((performance.now() - t0) / 1000); requestAnimationFrame(loop) }
	loop()
}
start()
</script>`
	)
}

async function main(): Promise<void> {
	const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
	const briefs = only ? [only] : BRIEFS

	const model = await resolveVerifyModel()
	if (!model) throw new Error("no verify backend/model available — set CARET_VERIFY_BACKEND / CARET_VERIFY_MODEL")
	console.log(`backend  ${model.backendId} model ${model.id} (${model.source})`)

	const vision = await probeVision({ backend: model.backend, workingDirectory: process.cwd(), model: model.id })
	console.log(
		vision.sees
			? "vision   the model can be shown its own frames — critique round on"
			: `vision   REFUSED (${vision.reason}) — compile-only, no critique round`,
	)

	const palette = derivePalette(tokens)
	const colors = [palette.brand, palette.brandQuiet, palette.surface]
	const paletteWords = foundationWords(palette)

	await fs.mkdir(OUT, { recursive: true })

	for (const brief of briefs) {
		const slug = slugOf(brief)
		// Resumable: a network abort mid-turn must cost one brief, not the run.
		const done = await fs
			.access(path.join(OUT, slug, "shader.json"))
			.then(() => true)
			.catch(() => false)
		if (done) {
			console.log(`\n▸ ${brief}\n  already in the gallery — skipped (delete the folder to redo)`)
			continue
		}
		console.log(`\n▸ ${brief}`)
		const session = await model.backend.startSession({
			workingDirectory: process.cwd(),
			mode: "read-only",
			model: model.id,
			title: "caret shader gallery",
			systemPrompt: SHADER_SYSTEM_PROMPT,
		})
		try {
			const result = await authorOne(session, brief, colors, paletteWords, vision.sees, (line) => console.log(line))
			if (!result) {
				console.log("  ✗ nothing compiled — skipped")
				continue
			}

			const dir = path.join(OUT, slug)
			await fs.mkdir(dir, { recursive: true })
			for (const [index, frame] of result.frames.entries()) {
				await fs.writeFile(path.join(dir, `frame-${SHADER_CRITIQUE_TIMES[index]}s.png`), frame)
			}
			const poster = await render(result.shader, POSTER_SIZE, [2.0])
			if (poster.ok && poster.frames[0]) await fs.writeFile(path.join(dir, "poster.png"), poster.frames[0])
			await fs.writeFile(path.join(dir, "live.html"), liveHtml(result.shader), "utf-8")
			await fs.writeFile(
				path.join(dir, "shader.json"),
				JSON.stringify(
					{ brief, model: model.id, rounds: result.rounds, uniforms: result.shader.uniforms, body: result.shader.body },
					null,
					2,
				),
			)
			console.log(`  ✓ ${result.rounds} round(s) → ${dir}`)
		} catch (err) {
			console.log(`  ✗ the loop died mid-brief (${err instanceof Error ? err.message : String(err)}) — moving on`)
		} finally {
			await session.close().catch(() => {})
		}
	}

	// The index reflects the gallery ON DISK, not this run — earlier runs count.
	const entries: Array<{ slug: string; brief: string; rounds: number }> = []
	for (const dirent of await fs.readdir(OUT, { withFileTypes: true })) {
		if (!dirent.isDirectory()) continue
		try {
			const meta = JSON.parse(await fs.readFile(path.join(OUT, dirent.name, "shader.json"), "utf-8"))
			entries.push({ slug: dirent.name, brief: String(meta.brief), rounds: Number(meta.rounds) || 0 })
		} catch {}
	}

	const index = `<!doctype html><meta charset="utf-8"><title>Caret shader gallery</title>
<style>
body{font:14px/1.5 system-ui;margin:32px;background:#fafafa;color:#18181b}
h1{font-size:18px} .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:24px}
figure{margin:0;background:#fff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden}
iframe{width:100%;height:300px;border:0;display:block}
figcaption{padding:10px 14px;color:#52525b}
</style>
<h1>Caret shader gallery — ${entries.length} of ${briefs.length} briefs compiled. These are LIVE, judge the motion.</h1>
<div class="grid">
${entries.map((e) => `<figure><iframe src="${e.slug}/live.html" loading="lazy"></iframe><figcaption>${e.brief} · ${e.rounds} round(s) · <a href="${e.slug}/poster.png">poster</a></figcaption></figure>`).join("\n")}
</div>`
	await fs.writeFile(path.join(OUT, "index.html"), index, "utf-8")

	console.log(`\n${entries.length}/${briefs.length} briefs produced a compiling shader.`)
	console.log(`open ${path.join(OUT, "index.html")} to rate them — they animate live.`)
}

main()
	.catch((err) => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(async () => {
		// The one lesson every probe here has paid for once: a leaked backend is
		// an agent loop polling a provider forever.
		await disposeBackends().catch(() => {})
	})

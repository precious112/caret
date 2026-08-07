/**
 * Logos and marks: a model authoring SVG inside a look-again loop.
 *
 * Two different tasks hide under "can a model draw vector", and only one of
 * them works. **Emitting paths from a description alone** is the case where
 * "models are bad at SVG" is simply true — there is no ground truth, so nothing
 * corrects the first guess. **Reproducing something it can see** converges,
 * because each round has a reference to be wrong about.
 *
 * So the loop is the product, not the first emission: the model emits SVG,
 * Caret renders it in isolation and screenshots it, and sends that picture back
 * into the same session beside the brief. The model sees what it actually drew
 * — usually for the first time — and corrects.
 *
 * **Caret decides when to stop, not the model.** Three rounds: emit, look,
 * correct, look, correct. Most of the gain is in the first two, and a model
 * asked "is it good yet?" will say yes.
 *
 * A backend whose adapter cannot pass images cannot run this lane, and is told
 * so rather than being allowed to loop blind. That check is not a formality —
 * one of Caret's own adapters was silently discarding every image it was given,
 * which would have made this loop three rounds of a model critiquing a
 * screenshot it never saw while looking exactly like it was working.
 */
import { BrowserWindow } from "electron"

import type { BackendSession, FoundationTokens } from "../../src/core/design"
import { derivePalette, foundationWords, getBackend, SLOP_TELLS } from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { getPrefs } from "./prefs"
import { canSeeImages } from "./vision-cache"

/** Emit, look, correct, look, correct. Agreed rather than tuned. */
export const MARK_ROUNDS = 3

/** The frame a mark is rendered into for review. Square, because marks are. */
const REVIEW_SIZE = 512

export interface MarkRequest {
	projectPath: string
	/** What the mark is for, in the user's own words from the interview. */
	brief: string
	tokens: FoundationTokens | null
	/** Overrides the project's backend model for this lane only. */
	modelOverride?: string
	/**
	 * Called as the loop moves. The round updates carry the render itself,
	 * because the only honest way to fill a minute of waiting is to show the
	 * thing the model is looking at while it decides what it got wrong.
	 */
	onProgress?(update: { stage: string; round?: number; previewPng?: Buffer }): void
}

export type MarkResult =
	| { ok: true; svg: string; rounds: number; model: string; transcript: string[]; previewPng: Buffer }
	| { ok: false; reason: string; needsAnotherModel?: boolean }

/**
 * Runs the loop and returns the last SVG that rendered.
 *
 * "That rendered" is load-bearing: a later round that emits something broken
 * must not replace an earlier round that worked. The loop keeps the best
 * *renderable* answer rather than the most recent one.
 */
export async function authorMark(request: MarkRequest): Promise<MarkResult> {
	const prefs = getPrefs()
	const backendId = prefs.backendId
	if (!backendId) {
		return {
			ok: false,
			reason: "Drawing a mark needs a coding backend. Open Settings → Backend to set one up.",
		}
	}

	const model = request.modelOverride?.trim() || prefs.backendModel || ""

	// Checked before a session is started, so a model that cannot see costs one
	// tiny probe rather than three rounds of pretending.
	const vision = await canSeeImages(backendId, model, request.projectPath)
	if (!vision.sees) return { ok: false, reason: vision.reason, needsAnotherModel: true }

	const backend = await getBackend(backendId)
	if (!backend) return { ok: false, reason: `No backend called "${backendId}" is available.` }

	const palette = derivePalette(request.tokens)
	const transcript: string[] = []
	const progress = request.onProgress ?? (() => {})
	let session: BackendSession | null = null
	let best = ""
	let bestPng: Buffer | null = null
	let rounds = 0

	try {
		progress({ stage: "Asking the model for a first attempt" })
		session = await backend.startSession({
			workingDirectory: request.projectPath,
			// It draws; it does not touch the repository. Read-only is the boundary
			// that makes "let a model run three turns unattended" reasonable at all.
			mode: "read-only",
			model: model || undefined,
			title: "caret mark",
			systemPrompt: SYSTEM_PROMPT,
		})

		let reply = await turn(session, { text: openingPrompt(request.brief, palette) })
		transcript.push(reply)

		for (let round = 1; round <= MARK_ROUNDS; round++) {
			const svg = extractSvg(reply)
			if (!svg) {
				progress({ stage: `Round ${round}: the reply had no SVG — asking again` })
				reply = await turn(session, { text: "That reply contained no <svg> element. Send the SVG itself, nothing else." })
				transcript.push(reply)
				continue
			}

			const png = await renderSvg(svg, palette.surface)
			if (!png) {
				progress({ stage: `Round ${round}: the SVG did not render — asking for a correction` })
				reply = await turn(session, {
					text: "That SVG did not render — a browser could draw nothing from it. Send a corrected version.",
				})
				transcript.push(reply)
				continue
			}

			best = svg
			bestPng = png
			rounds = round
			progress({ stage: `Round ${round} rendered`, round, previewPng: png })
			if (round === MARK_ROUNDS) break

			progress({ stage: `Showing the model its own round ${round}` })
			reply = await turn(session, {
				text: critiquePrompt(request.brief, round),
				images: [`data:image/png;base64,${png.toString("base64")}`],
			})
			transcript.push(reply)
		}
	} catch (err) {
		if (!best) return { ok: false, reason: err instanceof Error ? err.message : String(err) }
		Logger.warn(`[marks] the loop ended early but had a usable mark: ${err}`)
	} finally {
		await session?.close().catch(() => {})
	}

	if (!best || !bestPng) return { ok: false, reason: "The model never produced an SVG that rendered." }
	return { ok: true, svg: best, rounds, model: model || "(backend default)", transcript, previewPng: bestPng }
}

const SYSTEM_PROMPT = `You are drawing a single vector mark — a logo, monogram or symbol — as SVG, inside a design tool.

Rules that are not negotiable:
- Reply with the SVG element and nothing else. No prose, no code fence, no explanation.
- A square viewBox, no wider than 512.
- Paths and basic shapes only. No <image>, no <foreignObject>, no external references, no scripts.
- No text elements. A font you name will not be present when this renders, and the mark would silently become the fallback face.
- Two colours at most, both from the palette you are given.
- It must read at 24px. That is the size it will actually be used at most often.

You will be shown a picture of what you drew and asked to correct it. Look at the picture, not at your intentions for it.`

function openingPrompt(brief: string, palette: ReturnType<typeof derivePalette>): string {
	return [
		`Draw a mark for: ${brief.trim()}`,
		"",
		`Palette — use only these: ${palette.brand} (the brand colour), ${palette.ink} (ink), ${palette.surface} (the surface it sits on).`,
		foundationWords(palette),
		"",
		`Avoid: ${SLOP_TELLS.join("; ")}.`,
		"",
		"Send the SVG only.",
	].join("\n")
}

/**
 * The correction prompt.
 *
 * Names what to look at rather than asking "is it good?", because a model asked
 * to judge its own work says yes. The listed faults are the ones that actually
 * turn up in emitted marks: strokes that vanish at small sizes, shapes that
 * nearly-but-don't align, and accidental symmetry breaks.
 */
function critiquePrompt(brief: string, round: number): string {
	return [
		`This is a picture of the SVG you just sent, rendered at ${REVIEW_SIZE}px. Round ${round} of ${MARK_ROUNDS - 1}.`,
		"",
		"Look at the image and answer honestly: what is wrong with it?",
		"- Is anything clipped by the viewBox, or floating off-centre?",
		"- Would the thinnest stroke survive being shown at 24px?",
		"- Are shapes that should align actually aligned, or out by a pixel or two?",
		"- Does it read as the thing it is meant to be, or only as an abstract shape?",
		`- Does it still serve the brief: ${brief.trim()}`,
		"",
		"Then send a corrected SVG. Only the SVG.",
	].join("\n")
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
 * The first `<svg>…</svg>` in a reply.
 *
 * Tolerant of the fence and the preamble the system prompt asked it not to
 * send, because refusing a good mark over a stray "Here you go:" would be
 * pedantry — and strict about what it extracts, so nothing after the closing
 * tag ends up in the file.
 */
export function extractSvg(reply: string): string | null {
	const match = /<svg[\s\S]*?<\/svg>/i.exec(reply)
	if (!match) return null

	const svg = match[0]
	// The system prompt rules these out; this is the check that they are actually
	// absent. An emitted <image> or <script> would be a remote fetch or code
	// execution from inside an asset committed to the user's repository.
	if (/<\s*(script|foreignObject|image|iframe|use\b[^>]*href\s*=\s*["']https?:)/i.test(svg)) return null
	if (/\son\w+\s*=/i.test(svg)) return null
	return svg
}

/**
 * Renders an SVG offscreen and screenshots it.
 *
 * On the project's surface colour, because a mark judged on white and used on a
 * dark page is a mark nobody checked. The window is sandboxed and never given
 * the SVG as a document — it goes into an `<img>`, so nothing inside it can
 * execute even if the extraction check above ever missed something.
 */
async function renderSvg(svg: string, surface: string): Promise<Buffer | null> {
	let window: BrowserWindow | null = null
	try {
		window = new BrowserWindow({
			show: false,
			width: REVIEW_SIZE,
			height: REVIEW_SIZE,
			webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, javascript: false },
		})

		const html =
			`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${REVIEW_SIZE}px;height:${REVIEW_SIZE}px;` +
			`background:${surface};display:grid;place-items:center}img{width:70%;height:70%;object-fit:contain}</style>` +
			`<img src="data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}">`

		await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
		// Decoding is asynchronous and there is no load event to await through a
		// data URL with javascript disabled, so this waits rather than races.
		await new Promise((resolve) => setTimeout(resolve, 350))

		const image = await window.webContents.capturePage()
		const png = image.toPNG()
		// A blank capture means the SVG drew nothing — malformed, or entirely
		// outside its own viewBox. Either way it is not a mark.
		return isBlank(image.getBitmap()) ? null : png
	} catch (err) {
		Logger.warn(`[marks] could not render an emitted SVG: ${err}`)
		return null
	} finally {
		window?.destroy()
	}
}

interface PendingMark {
	svg: string
	subject: string
	rounds: number
	model: string
	at: number
}

/** One held mark per project, same lifetime rules as the raster lane's cache. */
const pendingMarks = new Map<string, PendingMark>()

export function holdMark(projectPath: string, mark: { svg: string; subject: string; rounds: number; model: string }): void {
	pendingMarks.set(projectPath, { ...mark, at: Date.now() })
}

/** Commits the held mark as an ordinary asset. The SVG never left main. */
export async function acceptMark(projectPath: string, tag: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
	const held = pendingMarks.get(projectPath)
	if (!held) return { ok: false, error: "No mark is waiting. Generate one first." }

	const { addGeneratedAsset } = await import("../../src/core/design")
	const result = await addGeneratedAsset({
		projectPath,
		tag: tag.trim() || "mark",
		extension: ".svg",
		bytes: Buffer.from(held.svg, "utf-8"),
		description: `A mark: ${held.subject}. Authored by ${held.model} in ${held.rounds} render-compare round(s).`,
		alt: held.subject,
		origin: {
			type: "generated",
			lane: "authored",
			producer: held.model,
			answers: { subject: held.subject },
			resolved: JSON.stringify({ rounds: held.rounds }),
		},
	})

	if (result.ok) pendingMarks.delete(projectPath)
	return result.ok ? { ok: true, tag: result.entry.tag } : { ok: false, error: result.reason }
}

export function discardMark(projectPath: string): void {
	pendingMarks.delete(projectPath)
}

/** True when every pixel matches the first one — nothing was drawn. */
function isBlank(bitmap: Buffer): boolean {
	if (bitmap.length < 8) return true
	for (let i = 4; i < bitmap.length; i += 4) {
		if (bitmap[i] !== bitmap[0] || bitmap[i + 1] !== bitmap[1] || bitmap[i + 2] !== bitmap[2]) return false
	}
	return true
}

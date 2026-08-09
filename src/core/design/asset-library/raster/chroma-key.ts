/**
 * Deterministic chroma-key for photographic cutouts.
 *
 * §4.7's transparency rule: a genuine photographic cutout is keyed against a
 * flat background **Caret chose at generation time** — no matting model, no
 * licence, and reliable precisely because the background is ours. The recipe
 * asks the image model for the object on this exact colour; this module removes
 * it. Pure pixel arithmetic, so the same input always cuts the same way and the
 * whole thing is testable without a model or a window.
 *
 * Two honesty rules shape the implementation:
 *
 * - **The background is measured, not assumed.** The model was asked for a hex
 *   and returns something *near* it. The border ring is sampled, checked against
 *   the requested key, and the measured colour is what gets keyed — keying the
 *   requested colour instead leaves a halo of the difference.
 * - **A background that is not there is a refusal, not a bad cutout.** If the
 *   border does not agree with the key, or keying removes almost nothing or
 *   almost everything, the caller gets a sentence with the measured numbers in
 *   it. A silently wrong cutout would land in the user's git history.
 */
import { hexToHsl } from "../palette"
import type { GeneratorPalette } from "../types"

/** A key colour: the hex the model is asked for, and the words the prompt uses. */
export interface KeyColor {
	hex: string
	word: string
}

/**
 * The two keys worth owning. Green is the default for the same reason it is the
 * industry's: cameras (and image models trained on their output) resolve it
 * cleanly and almost nothing anyone photographs is this colour. Magenta exists
 * for the projects whose own palette *is* green.
 */
export const CHROMA_GREEN: KeyColor = { hex: "#00b140", word: "chroma green" }
export const CHROMA_MAGENTA: KeyColor = { hex: "#e800e8", word: "chroma magenta" }

/**
 * Which key this project can be keyed against.
 *
 * The one thing that breaks a chroma key is a subject wearing the key colour,
 * and the one colour a generated asset is *likely* to wear is the project's own
 * brand — the palette words steer every prompt toward it. So a green-branded
 * project keys on magenta, and everything else keys on green. Deterministic, so
 * provenance can say exactly why the background was the colour it was.
 */
export function chooseKeyColor(palette: GeneratorPalette): KeyColor {
	const brand = hexToHsl(palette.brand)
	const green = brand.s >= 0.12 && brand.h > 70 && brand.h < 170
	return green ? CHROMA_MAGENTA : CHROMA_GREEN
}

export interface KeyableImage {
	/** Raw pixel data, 4 bytes per pixel, straight (non-premultiplied) alpha. */
	data: Uint8Array
	width: number
	height: number
	/** Channel order of `data`. Electron bitmaps are BGRA; canvases are RGBA. */
	order: "rgba" | "bgra"
}

export type KeyOutResult =
	| {
			ok: true
			/** Fraction of pixels made fully transparent. Recorded, and gated below. */
			cut: number
	  }
	| { ok: false; reason: string }

/** How closely the border must match the requested key to count as background. */
const BORDER_AGREEMENT = 0.85
/** Chromaticity distance within which a border pixel agrees with the key. */
const AGREE_DISTANCE = 0.09
/** Full transparency at or below this chromaticity distance from the measured key. */
const NEAR = 0.035
/** Full opacity at or above this distance; linear alpha in between. */
const FAR = 0.11
/** Below this, the "background" barely existed; above, the subject went with it. */
const MIN_CUT = 0.15
const MAX_CUT = 0.985

/**
 * Removes the keyed background in place.
 *
 * Distances are measured in **chromaticity** (colour independent of
 * brightness), which is what makes the key tolerant of the gentle shading a
 * model puts on even a "perfectly flat" background: a darker corner of the
 * green is still the same green. Edge pixels get their contamination unmixed
 * rather than merely faded — a semi-transparent pixel is a blend of subject and
 * background, and leaving the background's share in the colour is the green
 * fringe every naive key produces.
 */
export function keyOutBackground(image: KeyableImage, keyHex: string): KeyOutResult {
	const { data, width, height } = image
	if (data.length < width * height * 4) {
		return { ok: false, reason: "The pixel buffer is smaller than the image it claims to be." }
	}
	const [R, B] = image.order === "bgra" ? [2, 0] : [0, 2]
	const key = parseHex(keyHex)
	if (!key) return { ok: false, reason: `"${keyHex}" is not a hex colour.` }

	// ── measure the actual background from the border ring ──────────────────
	const keyChroma = chromaticity(key.r, key.g, key.b)
	let agree = 0
	let total = 0
	let sumR = 0
	let sumG = 0
	let sumB = 0
	const ring = 2
	for (let y = 0; y < height; y++) {
		const border = y < ring || y >= height - ring
		for (let x = 0; x < width; x++) {
			if (!border && x >= ring && x < width - ring) continue
			total++
			const i = (y * width + x) * 4
			const r = data[i + R]
			const g = data[i + 1]
			const b = data[i + B]
			if (distance(chromaticity(r, g, b), keyChroma) < AGREE_DISTANCE) {
				agree++
				sumR += r
				sumG += g
				sumB += b
			}
		}
	}

	const agreement = total > 0 ? agree / total : 0
	if (agreement < BORDER_AGREEMENT) {
		return {
			ok: false,
			reason:
				`The model did not return the flat key background it was asked for — only ` +
				`${Math.round(agreement * 100)}% of the border is near ${keyHex}. Generate again rather than keeping a bad cutout.`,
		}
	}

	const background = { r: sumR / agree, g: sumG / agree, b: sumB / agree }
	const backgroundChroma = chromaticity(background.r, background.g, background.b)

	// ── key every pixel against the measured background ──────────────────────
	let cut = 0
	const pixels = width * height
	for (let i = 0; i < pixels * 4; i += 4) {
		const r = data[i + R]
		const g = data[i + 1]
		const b = data[i + B]
		const d = distance(chromaticity(r, g, b), backgroundChroma)

		if (d <= NEAR) {
			data[i] = 0
			data[i + 1] = 0
			data[i + 2] = 0
			data[i + 3] = 0
			cut++
			continue
		}
		if (d >= FAR) continue

		// Edge: alpha from distance, and the colour unmixed. The pixel is
		// alpha·subject + (1−alpha)·background, so the subject's own colour is
		// recoverable — dividing it back out is what removes the fringe.
		const alpha = (d - NEAR) / (FAR - NEAR)
		data[i + R] = unmix(r, background.r, alpha)
		data[i + 1] = unmix(g, background.g, alpha)
		data[i + B] = unmix(b, background.b, alpha)
		data[i + 3] = Math.round(alpha * data[i + 3])
	}

	const fraction = cut / pixels
	if (fraction < MIN_CUT) {
		return {
			ok: false,
			reason: `Keying removed only ${Math.round(fraction * 100)}% of the frame — the background was not where it should be.`,
		}
	}
	if (fraction > MAX_CUT) {
		return {
			ok: false,
			reason: `Keying removed ${Math.round(fraction * 100)}% of the frame — the subject went with the background.`,
		}
	}
	return { ok: true, cut: fraction }
}

/**
 * Brightness-independent colour coordinates.
 *
 * (r, g) shares of the pixel's total, so a shadowed patch of the background
 * lands on the same point as a lit one. Near-black pixels have no meaningful
 * chromaticity; they are pushed far from any key rather than allowed to sit at
 * an arbitrary point that might happen to match one.
 */
function chromaticity(r: number, g: number, b: number): { x: number; y: number } {
	const sum = r + g + b
	if (sum < 24) return { x: 10, y: 10 }
	return { x: r / sum, y: g / sum }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The subject's own colour, with the background's (1−alpha) share divided out. */
function unmix(channel: number, background: number, alpha: number): number {
	if (alpha <= 0) return 0
	return Math.max(0, Math.min(255, Math.round((channel - (1 - alpha) * background) / alpha)))
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
	if (!match) return null
	const value = Number.parseInt(match[1], 16)
	return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

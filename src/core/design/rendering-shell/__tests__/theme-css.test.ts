/**
 * The bridge from foundation.json into Tailwind's theme.
 *
 * Before this existed, the rules told every agent "style from these tokens",
 * agents wrote `text-brand-950` — the only reasonable reading of a scale named
 * brand — and Tailwind, with no `--color-brand-950` defined anywhere, generated
 * no CSS. Pages silently rendered in inherited colours; on a dark-seeded
 * project the difference was invisible. These tests pin that every name the
 * rules advertise resolves to a real theme entry.
 */
import { strict as assert } from "assert"

import type { FoundationTokens } from "../../types"
import { foundationThemeCss } from "../theme-css"

const TOKENS: FoundationTokens = {
	vibe: { description: "", tags: [] },
	color: {
		brand: { seed: "#0a0a0a", scale: { "50": "#dadada", "500": "#9c9c9c", "950": "#030303" } },
		neutral: { character: "cool", scale: {} },
		semantic: { success: "#16a34a", warning: "#ca8a04", error: "#dc2626", info: "#2563eb" },
	},
	typography: {
		fontFamily: "Archivo",
		fallback: "Helvetica Neue",
		displayFamily: "Instrument Serif",
		displayFallback: "Georgia",
		scaleRatio: 1.25,
		baseSize: 16,
		scale: {},
	},
	spacing: { baseUnit: 4, scale: [] },
	radius: { character: "sharp", scale: [] },
}

describe("foundationThemeCss", () => {
	it("defines every brand step and the bare seed as Tailwind theme colours", () => {
		const css = foundationThemeCss(TOKENS)
		assert.ok(css.includes("@theme {"), "no @theme block — nothing here reaches Tailwind at all")
		assert.ok(css.includes("--color-brand-50: #dadada;"))
		assert.ok(css.includes("--color-brand-950: #030303;"), "the exact class the store's headings use")
		assert.ok(css.includes("--color-brand: #0a0a0a;"), "the bare seed utility is missing")
	})

	it("defines the semantic colours under the names the rules advertise", () => {
		const css = foundationThemeCss(TOKENS)
		for (const name of ["success", "warning", "error", "info"]) {
			assert.ok(css.includes(`--color-${name}:`), `--color-${name} missing — text-${name} would be inert`)
		}
	})

	it("wires both typefaces, quoted where CSS demands it, and imports them", () => {
		const css = foundationThemeCss(TOKENS)
		assert.ok(css.includes(`--font-sans: Archivo, Helvetica Neue;`))
		assert.ok(css.includes(`--font-display: "Instrument Serif", Georgia;`), "a multi-word family must be quoted")
		assert.ok(css.includes("fonts.googleapis.com/css2"), "the faces are named but never fetched")
		assert.ok(css.includes("Instrument+Serif"))
	})

	it("falls back to the body face when no display face is set", () => {
		const tokens: FoundationTokens = {
			...TOKENS,
			typography: { ...TOKENS.typography, displayFamily: undefined, displayFallback: undefined },
		}
		const css = foundationThemeCss(tokens)
		assert.ok(css.includes("--font-display: Archivo, Helvetica Neue;"))
	})

	it("survives an empty brand scale — the seed still yields a usable colour", () => {
		const tokens: FoundationTokens = {
			...TOKENS,
			color: { ...TOKENS.color, brand: { seed: "#3b82f6", scale: {} } },
		}
		const css = foundationThemeCss(tokens)
		assert.ok(css.includes("--color-brand: #3b82f6;"))
		assert.ok(!css.includes("--color-brand-"), "steps invented from nowhere")
	})
})

/**
 * Asset generation, tested from the user's job rather than the pipeline's.
 *
 * The previous suite asserted that the machinery fired: that the model painted
 * the key colour, that chroma-key removed it, that the PNG carried alpha. All
 * of it passed while the feature could produce exactly six objects, because the
 * subject was a hardcoded array indexed by variant and there was no way for a
 * user to ask for anything. A test cannot check an input that does not exist.
 *
 * So every test here starts from something somebody actually wants to make.
 */
import { strict as assert } from "assert"
import { clarifyRequest, composeAssetRequest, SHARED_AVOID } from "../request"
import type { GeneratorPalette } from "../types"

const PALETTE: GeneratorPalette = {
	surface: "#0A0A0A",
	raised: "#141414",
	ink: "#F5F5F5",
	brand: "#C8A56B",
	brandQuiet: "#6B5836",
	mode: "dark",
}

const INPUT = { palette: PALETTE, aspect: "1:1", variant: 0, tags: ["calm", "considered"] }

function raster(request: ReturnType<typeof composeAssetRequest>) {
	assert.equal(request.lane, "raster", "expected a raster request")
	return request as Extract<typeof request, { lane: "raster" }>
}

describe("composeAssetRequest", () => {
	// The four props the contact page in the usability test actually needed, and
	// the four the old six-item array could never have produced.
	for (const subject of ["a paperclip", "a stainless steel ruler", "a yellow pencil", "a black binder clip"]) {
		it(`asks for ${subject} and gets ${subject}`, () => {
			const composed = raster(composeAssetRequest({ kind: "image", text: subject }, INPUT))
			const noun = subject.split(" ").pop()!
			assert.ok(composed.prompt.toLowerCase().includes(noun), `the prompt never mentions "${noun}": ${composed.prompt}`)
		})
	}

	it("never substitutes a subject the user did not ask for", () => {
		// The exact failure this replaces: ask for a paperclip, receive a vase.
		const composed = raster(composeAssetRequest({ kind: "image", text: "a paperclip" }, INPUT))
		for (const ghost of ["vase", "table lamp", "headphones", "succulent", "wooden chair", "wristwatch"]) {
			assert.ok(!composed.prompt.toLowerCase().includes(ghost), `the old hardcoded "${ghost}" leaked in`)
		}
	})

	it("keeps the user's own words rather than paraphrasing them", () => {
		const text = "a stainless steel ruler and a yellow pencil lying at a slight angle"
		const composed = raster(composeAssetRequest({ kind: "image", text }, INPUT))
		assert.ok(composed.prompt.includes(text), "the request was rewritten instead of carried")
	})

	it("carries the answers to the clarifying questions into the prompt", () => {
		const composed = raster(
			composeAssetRequest(
				{
					kind: "image",
					text: "a paperclip",
					answers: { finish: "brushed silver, slightly worn", use: "clipped to the corner of a form" },
				},
				INPUT,
			),
		)
		assert.ok(composed.prompt.includes("brushed silver, slightly worn"))
		assert.ok(composed.prompt.includes("clipped to the corner of a form"))
	})

	it("always sends the shared don't-do list", () => {
		const composed = raster(composeAssetRequest({ kind: "image", text: "a paperclip" }, INPUT))
		for (const rule of SHARED_AVOID) assert.ok(composed.avoid.includes(rule), `missing: ${rule}`)
	})

	it("varies treatment across variants and never the subject", () => {
		const takes = [0, 1, 2].map((variant) =>
			raster(composeAssetRequest({ kind: "image", text: "a paperclip" }, { ...INPUT, variant })),
		)
		for (const take of takes) assert.ok(take.prompt.includes("a paperclip"))
		assert.equal(new Set(takes.map((t) => t.prompt)).size, 3, "three takes produced identical prompts")
	})

	describe("hard requirements", () => {
		it("a cut-out object is composed onto a flat key colour that code can remove", () => {
			// Not a style choice: chroma-key removes this colour by arithmetic
			// afterwards, so a prompt that omits it produces a cutout with no alpha.
			const composed = raster(composeAssetRequest({ kind: "image", text: "a paperclip", transparent: true }, INPUT))
			assert.ok(composed.transparent)
			assert.ok(/flat|uniform/i.test(composed.prompt), "the background is not required to be flat")
			assert.ok(
				composed.avoid.some((a) => /shadow/i.test(a)),
				"a cast shadow survives the key as a smear",
			)
		})

		it("never sends a cutout an instruction that contradicts its own background", () => {
			// Observed live: every take refused with "0% of the border is near
			// #00b140". The prompt asked correctly for the flat green; the negative
			// list told the model not to centre the subject and not to use colours
			// outside the palette — which is exactly what a key colour is.
			const composed = raster(composeAssetRequest({ kind: "image", text: "a paperclip", transparent: true }, INPUT))
			for (const rule of composed.avoid) {
				assert.ok(!/centred symmetrical/.test(rule), `a cutout was told: "${rule}", but it asks for a centred subject`)
				assert.ok(!/outside the palette/.test(rule), `a cutout was told: "${rule}", but its background deliberately is`)
			}
		})

		it("does not forbid text on subjects that legitimately carry it", () => {
			// "a stainless steel ruler, 150mm, markings visible" is a request for
			// lettering. Banning it outright fights the user's own words.
			const composed = raster(composeAssetRequest({ kind: "image", text: "a ruler with markings" }, INPUT))
			assert.ok(
				!composed.avoid.some((rule) => /^lettering/.test(rule)),
				"a blanket ban on lettering contradicts any subject with text on it",
			)
		})

		it("an opaque image is not forced onto white", () => {
			const composed = raster(composeAssetRequest({ kind: "image", text: "a quiet room with morning light" }, INPUT))
			assert.equal(composed.transparent, false)
			assert.ok(!/pure flat white/i.test(composed.prompt), "an ordinary photograph was pushed onto a cutout background")
		})

		it("a 3D source image is required to hold exactly one object", () => {
			// Tripo produces garbage from a scene, and the vision check refuses it
			// before credits are spent — so the request has to ask for one object.
			const composed = raster(composeAssetRequest({ kind: "object3d", text: "a ceramic mug" }, INPUT))
			assert.ok(/single|one object|alone/i.test(composed.prompt), "nothing constrains this to one object")
		})

		it("a mark is briefed as flat vector, not as a picture", () => {
			const composed = composeAssetRequest({ kind: "mark", text: "a broken ring of twelve dashes" }, INPUT)
			assert.equal(composed.lane, "authored")
			const brief = (composed as Extract<typeof composed, { lane: "authored" }>).brief
			assert.ok(brief.includes("a broken ring of twelve dashes"))
			assert.ok(/flat|vector/i.test(brief))
		})
	})

	it("refuses nothing that is a real request, however unusual", () => {
		// The old flow could only answer within its six objects. Anything outside
		// them had no representation at all; this has to carry them all equally.
		for (const text of ["a hand-drawn map of Devon", "a single fig, halved", "a coil of climbing rope"]) {
			const composed = raster(composeAssetRequest({ kind: "image", text }, INPUT))
			assert.ok(composed.prompt.includes(text))
		}
	})
})

describe("clarifyRequest", () => {
	function backendReturning(value: unknown) {
		return {
			structured: async <T>() => ({ value: value as T, emulated: false }),
		}
	}

	it("goes straight to generation when the request is already enough", async () => {
		const result = await clarifyRequest({
			backend: backendReturning({ sufficient: true, questions: [] }) as never,
			workingDirectory: "/tmp/p",
			request: { kind: "image", text: "a brushed steel ruler, 150mm, on a plain background" },
			tokens: null,
		})
		assert.equal(result.sufficient, true)
		assert.equal(result.questions.length, 0)
	})

	it("asks about what was left out, and says why it is asking", async () => {
		const result = await clarifyRequest({
			backend: backendReturning({
				sufficient: false,
				questions: [
					{
						id: "finish",
						question: "What finish should it have?",
						why: "It decides how the metal reads against your dark surface.",
						suggestions: ["Brushed steel", "Polished chrome", "Matte black"],
					},
				],
			}) as never,
			workingDirectory: "/tmp/p",
			request: { kind: "image", text: "a ruler" },
			tokens: null,
		})
		assert.equal(result.sufficient, false)
		assert.equal(result.questions[0].id, "finish")
		assert.ok(result.questions[0].why.length > 0, "a question with no why is a question the user cannot answer well")
		assert.ok(result.questions[0].suggestions.length > 0)
	})

	it("treats a backend failure as sufficient rather than blocking the user", async () => {
		const failing = {
			structured: async () => {
				throw new Error("no backend configured")
			},
		}
		const result = await clarifyRequest({
			backend: failing as never,
			workingDirectory: "/tmp/p",
			request: { kind: "image", text: "a ruler" },
			tokens: null,
		})
		assert.equal(result.sufficient, true, "a missing backend must not make the generator unusable")
		assert.equal(result.questions.length, 0)
	})
})

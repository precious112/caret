/**
 * The interview's guarantees, pinned.
 *
 * Two of them are the whole reason this flow exists rather than a prompt box:
 *
 * 1. **Nothing outside the curated library can reach the user.** The schema's
 *    `enum` stops a model naming its own typeface, and post-validation stops the
 *    rest — a repeated id, an id from another step, an id the library dropped
 *    between versions.
 * 2. **The interview never dead-ends.** No backend, a refused call, a garbage
 *    answer: every one of them still puts three real options on screen, because
 *    a user who cannot reach a model still needs foundations.
 *
 * The third is quieter and is the one a refactor would break silently: a screen
 * must never claim reasoning it cannot show.
 */
import { strict as assert } from "assert"

import type { CodingBackend } from "../../agent/backend"
import { findPairing, TYPEFACE_PAIRINGS } from "../../foundation-library"
import { buildFoundation, IncompleteInterviewError } from "../commit"
import { rankStep } from "../run"
import { INTERVIEW_STEPS, tagsFromDescription } from "../steps"

const TYPEFACE_STEP = INTERVIEW_STEPS[0]
const DESCRIPTION = "A dashboard for technical teams who watch it all day"

/** A backend whose `structured()` answers with whatever the test hands it. */
function backendReturning(value: unknown): CodingBackend {
	return {
		id: "opencode",
		async structured() {
			return { value, emulated: false }
		},
	} as unknown as CodingBackend
}

function backendThatFails(): CodingBackend {
	return {
		id: "opencode",
		async structured() {
			throw new Error("no credentials")
		},
	} as unknown as CodingBackend
}

const base = { step: TYPEFACE_STEP, description: DESCRIPTION, decisions: {}, workingDirectory: "/tmp/x" }

describe("rankStep", () => {
	it("uses the model's ranking and carries its reasons", async () => {
		const [a, b, c] = TYPEFACE_PAIRINGS
		const ranking = await rankStep({
			...base,
			backend: backendReturning({
				ranking: [
					{ id: c.id, reason: "read for hours, so sized for long sessions" },
					{ id: a.id, reason: "second" },
					{ id: b.id, reason: "third" },
				],
			}),
		})

		assert.equal(ranking.reasoned, true)
		assert.deepEqual(
			ranking.options.map((option) => option.id),
			[c.id, a.id, b.id],
			"the model's order was not preserved",
		)
		assert.equal(ranking.options[0].reason, "read for hours, so sized for long sessions")
	})

	it("drops an id the library does not have, and still fills the screen", async () => {
		// The case the enum is supposed to make impossible — pinned anyway, because
		// an emulated backend parses prose and can produce anything.
		const ranking = await rankStep({
			...base,
			backend: backendReturning({
				ranking: [
					{ id: "helvetica-neue-invented", reason: "made up" },
					{ id: TYPEFACE_PAIRINGS[1].id, reason: "real" },
					{ id: TYPEFACE_PAIRINGS[2].id, reason: "also real" },
				],
			}),
		})

		assert.equal(ranking.options.length, 3, "the screen was left short")
		assert.ok(
			!ranking.options.some((option) => option.id === "helvetica-neue-invented"),
			"an invented option reached the user",
		)
		assert.ok(
			ranking.options.every((option) => findPairing(option.id)),
			"an option was not a library pairing",
		)
	})

	it("never shows the same option twice", async () => {
		const [a] = TYPEFACE_PAIRINGS
		const ranking = await rankStep({
			...base,
			backend: backendReturning({
				ranking: [
					{ id: a.id, reason: "one" },
					{ id: a.id, reason: "again" },
					{ id: a.id, reason: "and again" },
				],
			}),
		})

		const ids = ranking.options.map((option) => option.id)
		assert.equal(new Set(ids).size, ids.length, `a duplicate was rendered: ${ids.join(", ")}`)
		assert.equal(ranking.options.length, 3)
	})

	it("falls back to the deterministic order with no backend, and says so", async () => {
		const ranking = await rankStep({ ...base, backend: null })

		assert.equal(ranking.options.length, 3)
		assert.equal(ranking.reasoned, false)
		assert.match(ranking.degradedBecause ?? "", /backend/)
	})

	it("falls back when the call throws rather than failing the step", async () => {
		const ranking = await rankStep({ ...base, backend: backendThatFails() })

		assert.equal(ranking.options.length, 3, "a failed call cost the user the step")
		assert.equal(ranking.reasoned, false)
	})

	it("does not claim reasoning when every reason came back empty", async () => {
		// An emulated backend can satisfy the schema with blank strings. The screen
		// must not then present a reasoning line it has nothing to put in.
		const ranking = await rankStep({
			...base,
			backend: backendReturning({
				ranking: TYPEFACE_PAIRINGS.slice(0, 3).map((pairing) => ({ id: pairing.id, reason: "   " })),
			}),
		})

		assert.equal(ranking.reasoned, false, "a screen claimed reasoning it could not show")
		assert.equal(ranking.options.length, 3)
	})

	it("only offers palettes the chosen typeface is declared to work with", async () => {
		const paletteStep = INTERVIEW_STEPS[1]
		const typeface = TYPEFACE_PAIRINGS[0]
		const offered = paletteStep.options({ typeface: typeface.id }).map((option) => option.id)

		assert.ok(offered.length > 0, "the step offered nothing")
		assert.deepEqual(
			offered.filter((id) => !typeface.pairsWith.palettes.includes(id)),
			[],
			"a combination nobody curated was offered",
		)
	})
})

describe("tagsFromDescription", () => {
	it("finds the library's own vocabulary in ordinary prose", () => {
		const tags = tagsFromDescription(DESCRIPTION)
		assert.ok(tags.includes("dashboard"), `no "dashboard" in ${JSON.stringify(tags)}`)
		assert.ok(tags.includes("technical"), `no "technical" in ${JSON.stringify(tags)}`)
	})

	it("does not match a tag inside a longer word", () => {
		// "dense" must not be found inside "condense" — matching a tag that was
		// never meant produces a narrowing that looks considered and is not.
		assert.deepEqual(tagsFromDescription("we condense reports"), [])
	})

	it("returns nothing rather than guessing when the words do not overlap", () => {
		assert.deepEqual(tagsFromDescription("zzzz qqqq"), [])
	})
})

describe("buildFoundation", () => {
	it("assembles a complete foundation from the chosen ids", () => {
		const typeface = TYPEFACE_PAIRINGS[0]
		const foundation = buildFoundation(DESCRIPTION, {
			typeface: typeface.id,
			palette: typeface.pairsWith.palettes[0],
			shape: typeface.pairsWith.shapes[0],
		})

		assert.equal(foundation.tokens.typography.fontFamily, typeface.body.family)
		assert.ok(foundation.tokens.color.brand.seed, "no brand seed was written")
		assert.ok(Object.keys(foundation.tokens.typography.scale).length > 0, "the type scale was not generated")
		assert.ok(foundation.rule, "the palette's restraint rule was dropped")
	})

	it("honours a brand colour the user overrode", () => {
		const typeface = TYPEFACE_PAIRINGS[0]
		const foundation = buildFoundation(DESCRIPTION, {
			typeface: typeface.id,
			palette: typeface.pairsWith.palettes[0],
			shape: typeface.pairsWith.shapes[0],
			brand: "#ff0055",
		})

		assert.equal(foundation.tokens.color.brand.seed, "#ff0055")
	})

	it("refuses to write a foundation that is missing a decision", () => {
		assert.throws(
			() => buildFoundation(DESCRIPTION, { typeface: TYPEFACE_PAIRINGS[0].id }),
			IncompleteInterviewError,
			"an incomplete interview produced a file",
		)
	})

	it("refuses an id the library no longer has", () => {
		// Scratch state outlives a Caret update, so a stored id can name a pairing
		// that has since been removed. Failing here beats writing a foundation
		// whose typeface cannot be loaded.
		assert.throws(
			() =>
				buildFoundation(DESCRIPTION, {
					typeface: "removed-in-a-later-version",
					palette: "mono-accent",
					shape: "sharp-dense",
				}),
			IncompleteInterviewError,
		)
	})
})

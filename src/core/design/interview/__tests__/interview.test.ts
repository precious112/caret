/**
 * The wizard's guarantees, pinned.
 *
 * The model owns the interview — what to ask, how to word it, when to finish.
 * What it does not own is the screen or the file, and these tests are the
 * boundary of that ownership:
 *
 * 1. **Every turn must render.** A question that names no options, repeats an
 *    id, or claims a kind its payload cannot support is bounced back to the
 *    model with a sentence it can act on — never dropped silently, never shown
 *    broken.
 * 2. **The file is Caret's.** A finish carries parameters; `finalizeProposal`
 *    derives every scale with the same generator the token editor uses, and a
 *    proposal that cannot survive that derivation is refused with a reason.
 * 3. **The Presets tab is deterministic.** Same description, same screens, on
 *    every machine, with no model in the room.
 */
import { strict as assert } from "assert"

import type { CodingBackend } from "../../agent/backend"
import { TYPEFACE_PAIRINGS } from "../../foundation-library"
import { buildFoundation, IncompleteInterviewError } from "../commit"
import { nextWizardTurn, validateQuestion, WizardTurnError } from "../conductor"
import { finalizeProposal, ProposalError } from "../finalize"
import { deterministicOptions, INTERVIEW_STEPS, tagsFromDescription } from "../steps"
import type { FoundationProposal, WizardQuestion } from "../widgets"
import { normalizeHex } from "../widgets"

const DESCRIPTION = "A dashboard for technical teams who watch it all day"

const PROPOSAL: FoundationProposal = {
	displayFamily: "Space Grotesk",
	bodyFamily: "Inter",
	scaleRatio: 1.2,
	baseSize: 15,
	brand: "#2563eb",
	neutral: "cool",
	surface: "dark",
	spacingUnit: 4,
	radiusCharacter: "sharp",
	rule: "Brand colour on the primary action only.",
	vibeTags: ["technical", "dense"],
	summary: "Built for long sessions: quiet, dense, readable.",
}

function question(overrides: Partial<WizardQuestion>): WizardQuestion {
	return { id: "q1", kind: "options", question: "Which of these?", ...overrides } as WizardQuestion
}

describe("validateQuestion", () => {
	it("passes a well-formed question through with its recommendation intact", () => {
		const valid = validateQuestion(
			question({
				options: [
					{ id: "a", label: "First" },
					{ id: "b", label: "Second" },
				],
				recommendedId: "b",
			}),
			[],
		)
		assert.equal(valid.recommendedId, "b")
		assert.equal(valid.options?.length, 2)
	})

	it("falls back to the first option when the recommendation names nothing", () => {
		const valid = validateQuestion(
			question({
				options: [
					{ id: "a", label: "First" },
					{ id: "b", label: "Second" },
				],
				recommendedId: "made-up",
			}),
			[],
		)
		assert.equal(valid.recommendedId, "a", "someone has to be preselected — pressing through must work")
	})

	it("rejects a pick question with fewer than two options", () => {
		assert.throws(() => validateQuestion(question({ options: [{ id: "a", label: "Only" }] }), []), WizardTurnError)
	})

	it("rejects a colour option without a usable hex, and normalises the rest", () => {
		assert.throws(
			() =>
				validateQuestion(
					question({
						kind: "color",
						options: [
							{ id: "a", label: "Blue", hex: "#2563eb" },
							{ id: "b", label: "Broken", hex: "blue" },
						],
					}),
					[],
				),
			WizardTurnError,
		)

		const valid = validateQuestion(
			question({
				kind: "color",
				options: [
					{ id: "a", label: "Blue", hex: "2563EB" },
					{ id: "b", label: "Short", hex: "#abc" },
				],
			}),
			[],
		)
		assert.equal(valid.options?.[0].hex, "#2563eb")
		assert.equal(valid.options?.[1].hex, "#aabbcc")
		// The picker/hex/eyedropper escape hatch is the user's by design, not the
		// model's to withhold.
		assert.equal(valid.other, "color")
	})

	it("de-duplicates option ids instead of rendering one card twice", () => {
		const valid = validateQuestion(
			question({
				options: [
					{ id: "same", label: "One" },
					{ id: "same", label: "Two" },
				],
			}),
			[],
		)
		const ids = valid.options?.map((option) => option.id) ?? []
		assert.equal(new Set(ids).size, ids.length, `duplicate ids survived: ${ids.join(", ")}`)
	})

	it("renames a question id the interview has already used", () => {
		const asked = {
			question: question({ id: "brand" }),
			answer: { questionId: "brand", question: "?", kind: "options" as const, value: "a" },
		}
		const valid = validateQuestion(
			question({
				id: "brand",
				options: [
					{ id: "a", label: "A" },
					{ id: "b", label: "B" },
				],
			}),
			[asked],
		)
		assert.notEqual(valid.id, "brand", "a repeated question id would make the answer ambiguous")
	})

	it("requires a scale question to have poles and at least three steps", () => {
		assert.throws(
			() => validateQuestion(question({ kind: "scale", steps: [{ label: "tight" }, { label: "airy" }] }), []),
			WizardTurnError,
		)

		const valid = validateQuestion(
			question({
				kind: "scale",
				leftLabel: "Compact",
				rightLabel: "Airy",
				steps: [{ label: "tight" }, { label: "normal" }, { label: "open" }],
				defaultStep: 99,
			}),
			[],
		)
		assert.equal(valid.defaultStep, 2, "an out-of-range default was not clamped")
	})
})

describe("nextWizardTurn", () => {
	function backendReturning(values: unknown[]): CodingBackend {
		let call = 0
		return {
			id: "opencode",
			async structured() {
				return { value: values[Math.min(call++, values.length - 1)], emulated: false }
			},
		} as unknown as CodingBackend
	}

	const base = { workingDirectory: "/tmp/x", description: DESCRIPTION, history: [] }

	it("returns a validated ask turn", async () => {
		const turn = await nextWizardTurn({
			...base,
			backend: backendReturning([
				{
					action: "ask",
					question: question({
						options: [
							{ id: "a", label: "A" },
							{ id: "b", label: "B" },
						],
					}),
				},
			]),
		})
		assert.equal(turn.action, "ask")
	})

	it("retries once with the validator's complaint, and succeeds on the corrected turn", async () => {
		const turn = await nextWizardTurn({
			...base,
			backend: backendReturning([
				{ action: "ask", question: question({ options: [] }) }, // rejected: no options
				{
					action: "ask",
					question: question({
						options: [
							{ id: "a", label: "A" },
							{ id: "b", label: "B" },
						],
					}),
				},
			]),
		})
		assert.equal(turn.action, "ask")
	})

	it("fails after the retry rather than looping", async () => {
		await assert.rejects(
			nextWizardTurn({ ...base, backend: backendReturning([{ action: "ask", question: question({ options: [] }) }]) }),
			WizardTurnError,
		)
	})

	it("refuses a finish whose foundation cannot be finalized", async () => {
		await assert.rejects(
			nextWizardTurn({
				...base,
				backend: backendReturning([{ action: "finish", foundation: { ...PROPOSAL, brand: "not-a-colour" } }]),
			}),
			ProposalError,
		)
	})

	it("forces a finish when asked to, even if the model wants to keep asking", async () => {
		const turn = await nextWizardTurn({
			...base,
			force: "finish",
			backend: backendReturning([
				// The model ignores the instruction and asks anyway — the payload has
				// no foundation, so the retry complaint tells it exactly what to send.
				{
					action: "ask",
					question: question({
						options: [
							{ id: "a", label: "A" },
							{ id: "b", label: "B" },
						],
					}),
				},
				{ action: "finish", foundation: PROPOSAL },
			]),
		})
		assert.equal(turn.action, "finish")
	})
})

describe("finalizeProposal", () => {
	it("derives every scale itself, in the token editor's shape", () => {
		const { tokens } = finalizeProposal(PROPOSAL, DESCRIPTION)

		assert.equal(tokens.typography.fontFamily, "Inter")
		assert.equal(tokens.typography.displayFamily, "Space Grotesk")
		assert.ok(Object.keys(tokens.typography.scale).length > 0, "no type scale was derived")
		assert.ok(Object.keys(tokens.color.brand.scale).length > 0, "no colour scale was derived")
		assert.ok(tokens.spacing.scale.length > 0, "no spacing scale")
		assert.equal(tokens.radius.character, "sharp")
		assert.ok(tokens.radius.scale.includes(9999), "the radius scale lost its pill stop")
	})

	it("clamps parameters into the ranges the derivations behave in", () => {
		const { tokens } = finalizeProposal({ ...PROPOSAL, scaleRatio: 3, baseSize: 60, spacingUnit: 5 }, DESCRIPTION)
		assert.equal(tokens.typography.scaleRatio, 1.5)
		assert.equal(tokens.typography.baseSize, 20)
		assert.equal(tokens.spacing.baseUnit, 4)
	})

	it("fills semantic colours the proposal left out, and keeps valid ones it set", () => {
		const { tokens } = finalizeProposal({ ...PROPOSAL, semantic: { error: "#b91c1c" } }, DESCRIPTION)
		assert.equal(tokens.color.semantic.error, "#b91c1c")
		assert.ok(normalizeHex(tokens.color.semantic.success), "a default semantic is missing")
	})

	it("refuses a brand that is not a colour, naming the fix", () => {
		assert.throws(() => finalizeProposal({ ...PROPOSAL, brand: "cornflower" }, DESCRIPTION), ProposalError)
	})

	it("refuses a proposal with no restraint rule", () => {
		assert.throws(() => finalizeProposal({ ...PROPOSAL, rule: "  " }, DESCRIPTION), ProposalError)
	})
})

describe("the Presets tab (deterministic)", () => {
	it("orders the same options for the same description, every time", () => {
		const tags = tagsFromDescription(DESCRIPTION)
		const first = deterministicOptions(INTERVIEW_STEPS[0], {}, tags)
		const second = deterministicOptions(INTERVIEW_STEPS[0], {}, tags)
		assert.deepEqual(first, second)
		assert.equal(first.length, 3)
	})

	it("only offers palettes the chosen typeface is declared to work with", () => {
		const typeface = TYPEFACE_PAIRINGS[0]
		const offered = INTERVIEW_STEPS[1].options({ typeface: typeface.id }).map((option) => option.id)
		assert.ok(offered.length > 0)
		assert.deepEqual(
			offered.filter((id) => !typeface.pairsWith.palettes.includes(id)),
			[],
			"a combination nobody curated was offered",
		)
	})

	it("finds the library's vocabulary in prose without matching inside words", () => {
		assert.ok(tagsFromDescription(DESCRIPTION).includes("dashboard"))
		assert.deepEqual(tagsFromDescription("we condense reports"), [])
	})

	it("builds a complete foundation from chosen ids and refuses incomplete ones", () => {
		const typeface = TYPEFACE_PAIRINGS[0]
		const foundation = buildFoundation(DESCRIPTION, {
			typeface: typeface.id,
			palette: typeface.pairsWith.palettes[0],
			shape: typeface.pairsWith.shapes[0],
		})
		assert.equal(foundation.tokens.typography.fontFamily, typeface.body.family)
		assert.ok(foundation.rule)

		assert.throws(() => buildFoundation(DESCRIPTION, { typeface: typeface.id }), IncompleteInterviewError)
	})
})

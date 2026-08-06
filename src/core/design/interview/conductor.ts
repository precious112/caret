/**
 * One turn of the wizard: the model decides, Caret checks.
 *
 * Per turn the model gets the project description, everything asked and
 * answered so far, and the widget vocabulary — and returns either the next
 * question or a finished proposal. It owns the interview: which questions
 * exist, their wording, their options, when to stop. Caret owns exactly two
 * things: the payload must render (validated here, one retry quoting the
 * violation back), and the finish must survive `finalize` (same treatment).
 *
 * The retry is prompt-level, not a re-roll: the second attempt is the same
 * request plus the validator's sentence about what was wrong with the first.
 * One retry only — a model that cannot produce a renderable question twice is
 * not going to on the third attempt, and the surface has an honest error state.
 */
import { Logger } from "@/shared/services/Logger"
import type { CodingBackend, ReasoningEffort } from "../agent/backend"
import { PALETTE_RECIPES, TYPEFACE_PAIRINGS } from "../foundation-library"
import { finalizeProposal } from "./finalize"
import {
	type FoundationProposal,
	normalizeHex,
	type StoredQA,
	WIZARD_TURN_SCHEMA,
	type WizardQuestion,
	type WizardTurn,
} from "./widgets"

/** Aim well under this; the cap is the backstop, not the target. */
export const QUESTION_CAP = 10

export class WizardTurnError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WizardTurnError"
	}
}

/**
 * Stable instructions, sent as the system prompt.
 *
 * The reference lists at the bottom are the curated library demoted to what it
 * always should have been: known-good examples the model may use or ignore.
 */
function systemPrompt(): string {
	const pairings = TYPEFACE_PAIRINGS.map(
		(p) => `- ${p.display.family} for headings with ${p.body.family} for body — ${p.feel}`,
	).join("\n")
	const palettes = PALETTE_RECIPES.map((r) => `- ${r.seed} on a ${r.surface} ${r.neutral}-neutral surface — ${r.feel}`).join(
		"\n",
	)

	return `You are running a short visual-foundations interview inside Caret, a design tool.
The person answering is a developer who knows exactly what they are building and is not a
designer. Your job: decide the foundations their project needs — typefaces, colour, density,
corner character — by asking the fewest, best questions, then hand back the parameters.

## How to behave

- **Never ask what their description already answers.** Infer it, and confirm inferences with
  one \`assumptions\` question rather than several individual ones.
- Aim for 4–7 questions total. You will be told the count; at ${QUESTION_CAP} you must finish.
- Plain language only. No design jargon — not "humanist sans", not "x-height". Every option's
  \`reason\` must be grounded in what they told you: "agents scan this all day, so it stays
  readable at small sizes", never "a geometric grotesque".
- Always mark a \`recommendedId\`. Someone pressing straight through your questions must end
  up with a foundation you would defend.
- Options should differ meaningfully. Three near-identical blues is not a question.
- Typefaces must be real Google Fonts family names, spelled exactly. Colours are 6-digit hex.

## The question formats

Each question is rendered by a real component; pick the format that fits what you need:

- \`options\` — 2–4 cards with live previews. Give each option a \`spec\` so its card shows the
  thing itself (families, accent, surface, radius, spacing, baseSize). The general pick.
- \`color\` — swatch cards; each option carries \`hex\`. The surface adds a colour picker, a hex
  field and an eyedropper as the escape hatch automatically (set \`other: "color"\`).
- \`font\` — type-specimen cards; each option's \`label\` IS the family name; put the body family
  in \`spec.bodyFamily\` if you are proposing a pairing. \`other: "font"\` adds Google Fonts search.
- \`scale\` — a stepped control between two poles (\`leftLabel\`/\`rightLabel\`, 3–5 \`steps\` with
  \`spec\` each) whose preview morphs live. Use for density, rounding, how loud headings are.
  Never expose numbers; the step \`spec\` carries them.
- \`chips\` — multi-select facts: which surfaces exist (dashboard, marketing, docs…), needed
  states. \`other: "text"\` lets them add their own.
- \`text\` — one free input, only for facts you cannot infer (their product's name, a site
  whose look they admire).
- \`boolean\` — exactly 2 options, e.g. dark-first vs light-first, each with a \`spec\`.
- \`assumptions\` — statements you inferred, each an option (\`label\` = the statement). The user
  confirms or corrects each. Use this early instead of asking the obvious.

## Finishing

When you can defend every parameter, return \`action: "finish"\` with the foundation:
families, scaleRatio (1.05–1.5), baseSize px, brand hex, neutral character, surface,
optional semantic hexes, spacingUnit (4 or 8), radiusCharacter, a one-sentence restraint
rule for how colour is used, vibeTags, and a 2–3 sentence summary addressed to the user.
Caret derives all scales and writes the file — you name parameters only.

## Known-good references (use or ignore freely)

Pairings that work:
${pairings}

Colour directions that work:
${palettes}`
}

function turnPrompt(description: string, history: StoredQA[], questionCount: number, force: boolean, complaint?: string): string {
	const transcript = history.length
		? history
				.map((qa) => {
					const answer = qa.answer.skipped
						? "(they said: you decide)"
						: `${qa.answer.label ?? qa.answer.value}${qa.answer.wasOther ? " (their own, not one of your options)" : ""}`
					return `Q: ${qa.question.question}\nA: ${answer}`
				})
				.join("\n\n")
		: "(nothing asked yet)"

	return `Their project, in their words:

"""
${description.trim()}
"""

The interview so far (${questionCount} question(s) asked):

${transcript}

${
	force
		? 'You must return `action: "finish"` now, constructed from everything above. Do not ask anything else.'
		: "Return the single next turn: one question, or finish if you can already defend every parameter."
}${complaint ? `\n\nYour previous reply was rejected: ${complaint}\nReturn a corrected turn.` : ""}`
}

/** A slug that renders and sorts sanely, whatever the model sent. */
function slug(value: string, fallback: string): string {
	const cleaned = value
		?.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return cleaned || fallback
}

/**
 * The renderable subset of whatever came back.
 *
 * Repairs what is safely repairable (slugs, a missing recommendation) and
 * throws — with a quotable sentence — on what is not. Dropping a malformed
 * option silently would show the user a two-card question the model believed
 * had four.
 */
export function validateQuestion(raw: WizardQuestion, history: StoredQA[]): WizardQuestion {
	const question: WizardQuestion = { ...raw, id: slug(raw.id, `q${history.length + 1}`) }
	if (history.some((qa) => qa.question.id === question.id)) question.id = `${question.id}-${history.length + 1}`
	if (!question.question?.trim()) throw new WizardTurnError("the question text is empty.")

	const needsOptions = ["options", "color", "font", "chips", "boolean", "assumptions"].includes(question.kind)

	if (needsOptions) {
		const seen = new Set<string>()
		const options = (question.options ?? []).map((option, index) => {
			let id = slug(option.id, `opt-${index + 1}`)
			while (seen.has(id)) id = `${id}-${index + 1}`
			seen.add(id)
			return { ...option, id, label: option.label?.trim() ?? "" }
		})

		if (options.some((option) => !option.label)) throw new WizardTurnError(`an option in "${question.id}" has no label.`)

		const minimum = question.kind === "assumptions" ? 1 : 2
		if (options.length < minimum) {
			throw new WizardTurnError(`"${question.kind}" needs at least ${minimum} options, got ${options.length}.`)
		}
		if (question.kind === "boolean" && options.length !== 2) {
			throw new WizardTurnError(`"boolean" needs exactly 2 options, got ${options.length}.`)
		}
		if (question.kind === "color") {
			for (const option of options) {
				const hex = normalizeHex(option.hex)
				if (!hex) throw new WizardTurnError(`colour option "${option.label}" has no valid hex.`)
				option.hex = hex
			}
		}

		question.options = options
		question.recommendedId = options.find((option) => option.id === slug(raw.recommendedId ?? "", ""))?.id ?? options[0].id
	}

	if (question.kind === "scale") {
		const steps = (question.steps ?? []).filter((step) => step.label?.trim())
		if (steps.length < 3) throw new WizardTurnError(`"scale" needs at least 3 labelled steps, got ${steps.length}.`)
		question.steps = steps.slice(0, 7)
		question.defaultStep = Math.min(
			Math.max(0, Math.round(question.defaultStep ?? Math.floor(steps.length / 2))),
			steps.length - 1,
		)
		if (!question.leftLabel?.trim() || !question.rightLabel?.trim()) {
			throw new WizardTurnError(`"scale" needs both pole labels.`)
		}
	}

	// The colour escape hatch is always offered on colour questions — the user
	// asked for it by design, not by the model's leave.
	if (question.kind === "color") question.other = "color"
	if (question.kind === "font" && question.other === undefined) question.other = "font"

	return question
}

export interface ConductorInput {
	backend: CodingBackend
	workingDirectory: string
	model?: string
	effort?: ReasoningEffort
	description: string
	/** Answered questions only. */
	history: StoredQA[]
	force?: "finish"
}

export async function nextWizardTurn(input: ConductorInput): Promise<WizardTurn> {
	const force = input.force === "finish" || input.history.length >= QUESTION_CAP

	const attempt = async (complaint?: string): Promise<WizardTurn> => {
		const result = await input.backend.structured<{
			action: string
			question?: WizardQuestion
			foundation?: FoundationProposal
		}>({
			workingDirectory: input.workingDirectory,
			prompt: turnPrompt(input.description, input.history, input.history.length, force, complaint),
			schema: WIZARD_TURN_SCHEMA,
			systemPrompt: systemPrompt(),
			model: input.model,
			effort: input.effort,
		})

		const value = result.value
		if (value?.action === "ask" && !force) {
			if (!value.question) throw new WizardTurnError('action was "ask" but no question was included.')
			return { action: "ask", question: validateQuestion(value.question, input.history) }
		}
		if (value?.action === "finish" || force) {
			if (!value?.foundation) throw new WizardTurnError('action was "finish" but no foundation was included.')
			// Finalize is the validator: it throws ProposalError with a quotable
			// sentence, and its success proves the proposal derives cleanly.
			finalizeProposal(value.foundation, input.description)
			return { action: "finish", foundation: value.foundation }
		}
		throw new WizardTurnError(`action was "${value?.action}", expected "ask" or "finish".`)
	}

	try {
		return await attempt()
	} catch (err) {
		const complaint = err instanceof Error ? err.message : String(err)
		Logger.warn(`[wizard] turn rejected (${complaint}), retrying once`)
		return attempt(complaint)
	}
}

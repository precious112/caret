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

/** "Yes, all of these" and its relatives — see the `assumptions` check below. */
const BLANKET_CONFIRM =
	/^(yes\b|all of (these|the above)|confirm all|these are all|that('| i)s all correct|sounds right|looks right|agree)/i

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
- Always mark a \`recommendedId\` — **except on \`assumptions\`, which must not have one.**
  Someone pressing straight through your questions must end up with a foundation you would
  defend.
- Options should differ meaningfully. Three near-identical blues is not a question.
- Typefaces must be real Google Fonts family names, spelled exactly. Colours are 6-digit hex.

## Write like you are talking to someone

**Take this seriously. It decides whether the interview works at all.**

The person answering builds software. They have never learned design vocabulary and have no
reason to. If they cannot parse your question they cannot answer it, and everything you worked
out from their description is wasted on them.

So write the way you would explain it out loud to a friend who is not in the industry. Short
sentences, one idea each. Say what something does and how it will look to them, never what it
is called. If a word belongs to the design profession rather than to ordinary speech, they do
not have it — find the everyday way of saying the same thing. Every option's \`reason\` must come
from what THEY told you, in their terms.

Here is a real question this interview produced, and it is exactly what not to write:

> I'm assuming the foundation should be: a light, warm-neutral canvas; no brand colour beyond
> restrained ink and photography; generous spacing; sharp corners; and a precise modern type
> system that lets large project titles feel editorial without becoming decorative.

Nobody outside a design studio can answer that. The same thing, said properly:

> Pages sit on a light, slightly warm background.
> There is no brand colour — the photographs supply all the colour.
> Lots of space around everything.
> Corners are square, not rounded.
> Big titles look confident without looking fancy.

## The question formats

Each question is rendered by a real component; pick the format that fits what you need:

Each one is a real component with its own behaviour. Getting the shape wrong produces a screen
that contradicts itself, so read what the user actually sees before you choose.

- \`options\` — **the general pick. Choose ONE.** 2–4 cards, each with a live preview. Give
  every option a \`spec\` so its card shows the thing itself (families, accent, surface, radius,
  spacing, baseSize). The options must be genuine alternatives to each other — if two could
  both be true at once, this is the wrong format.

- \`boolean\` — **exactly 2 options, choose ONE.** A fork: dark-first or light-first. Each
  needs a \`spec\`. Use it when there are only two honest answers.

- \`color\` — swatch cards; each option carries a \`hex\`. Choose one. Set \`other: "color"\` and
  the screen adds a colour picker, a hex field and an eyedropper, so they are never stuck with
  only your swatches.

- \`font\` — type-specimen cards; each option's \`label\` IS the family name. Choose one. Put the
  body family in \`spec.bodyFamily\` if you are proposing a pairing. Set \`other: "font"\` and
  the screen adds a search across all of Google Fonts.

- \`scale\` — a slider between two extremes: \`leftLabel\`, \`rightLabel\`, and 3–5 \`steps\`, each
  carrying a \`spec\`. The preview morphs as they move it. Use it for density, rounding, how
  loud headings are. **Never show numbers** — the step's \`spec\` carries them, the label says
  how it feels ("tight", "roomy"). Set \`other: "text"\` so they can describe what they want
  instead, if none of the steps is it.

- \`chips\` — **multi-select facts, pick as many as apply.** Which kinds of pages exist, which
  states matter. Not for taste — only for facts about what they are building. \`other: "text"\`
  lets them add their own.

- \`text\` — one free input. Only for facts you cannot possibly infer, like their product's
  name or a site whose look they admire.

- \`assumptions\` — **not a picker. Read this carefully.** You supply statements you have
  already concluded. Every one is shown as ALREADY AGREED, ticked, and the user's only action
  is pressing "Not quite" on the ones that are wrong and typing the correction. Nothing is
  chosen; agreeing is the default. That means:
    - Each statement must stand on its own and be individually true.
    - **They must all be able to be true at the same time.** Never offer alternatives here —
      "give type more character" and "use softer corners" are choices, not conclusions, and
      putting them in this format tells Caret the user agreed to all of them at once.
    - **Never include a blanket "yes, all of these" option.** Agreeing to everything is what
      happens if they touch nothing, so such an option is meaningless and will be rejected.
    - **No \`recommendedId\`.** There is nothing to recommend when everything is already agreed.
    - One statement per idea, in plain words. Not one long sentence with semicolons in it.
  Use this early, to kill four obvious questions with one screen.

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

		if (question.kind === "assumptions") {
			// A blanket "yes, all of these" is always redundant and always wrong
			// here: every statement is ticked already, so agreeing to everything is
			// what happens if the user touches nothing. Worse, it sits alongside
			// real statements and gets confirmed with them — the screen then reports
			// that the user agreed to the summary *and* to two departures from it.
			const blanket = options.find((option) => BLANKET_CONFIRM.test(option.label))
			if (blanket) {
				throw new WizardTurnError(
					`"${blanket.label}" is a blanket confirmation, and \`assumptions\` options are all agreed by default — ` +
						`so it says nothing and contradicts the statements beside it. Give one independent statement per option, ` +
						`all of which can be true at once.`,
				)
			}
		}

		question.options = options
		// Nothing to recommend when every statement is already agreed; a
		// recommendation here is what pushes a pick-one shape into a format that
		// is not a picker.
		question.recommendedId =
			question.kind === "assumptions"
				? undefined
				: (options.find((option) => option.id === slug(raw.recommendedId ?? "", ""))?.id ?? options[0].id)
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

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

/**
 * The collaborative interview must touch every coverage area, so its backstop
 * sits far higher — the cap is still a backstop, not a quota.
 */
export const COLLABORATIVE_QUESTION_CAP = 18

/**
 * Who is being interviewed. `ai-led` is the original minimal interview: a
 * developer who is not a designer, few questions, the model recommends and the
 * user can press straight through. `collaborative` is for someone design-savvy
 * who wants the AI for the heavy lifting but the decisions surfaced: every
 * coverage area must be asked about, and nothing is decided silently.
 */
export type WizardMode = "ai-led" | "collaborative"

export function questionCapFor(mode: WizardMode): number {
	return mode === "collaborative" ? COLLABORATIVE_QUESTION_CAP : QUESTION_CAP
}

/**
 * What a complete design system decides. The collaborative interview may not
 * finish until each area has an answered question tagged with it. Consequences
 * (contrast pairings, line heights, shadow strings, motion) are deliberately
 * NOT areas — Caret derives them, so asking would be a question with one
 * correct answer.
 */
export const COVERAGE_AREAS: ReadonlyArray<{ id: string; label: string }> = [
	{ id: "display-type", label: "the heading typeface" },
	{ id: "body-type", label: "the body typeface" },
	{ id: "type-scale", label: "type size and weight" },
	{ id: "brand-color", label: "the brand colour" },
	// Two areas, not one: as a single area, one delegated "supporting colours"
	// question satisfied the checklist while the accent was never mentioned —
	// field-measured (test4's committed foundation has accent: null).
	{ id: "secondary-color", label: "a supporting colour" },
	{ id: "accent-color", label: "an accent colour" },
	{ id: "neutral", label: "the greys" },
	{ id: "surface", label: "light or dark" },
	{ id: "semantics", label: "success/warning/error colours" },
	{ id: "spacing", label: "density and spacing" },
	{ id: "radius", label: "corner rounding" },
	{ id: "depth", label: "shadows and depth" },
]

/** Areas settled so far: the union of `covers` tags over answered questions. */
export function coveredAreas(history: StoredQA[]): string[] {
	const tagged = new Set<string>()
	for (const qa of history) {
		for (const id of qa.question.covers ?? []) tagged.add(id)
	}
	return COVERAGE_AREAS.filter((area) => tagged.has(area.id)).map((area) => area.id)
}

/** "Yes, all of these" and its relatives — see the `assumptions` check below. */
const BLANKET_CONFIRM =
	/^(yes\b|all of (these|the above)|confirm all|these are all|that('| i)s all correct|sounds right|looks right|agree)/i

/** Every kind the renderer has a widget for; anything else draws nothing. */
const KNOWN_KINDS: ReadonlyArray<WizardQuestion["kind"]> = [
	"options",
	"color",
	"font",
	"scale",
	"chips",
	"text",
	"boolean",
	"assumptions",
]

/** Areas whose answer is a colour — their questions must use the colour widget. */
const COLOR_AREAS = new Set(["brand-color", "secondary-color", "accent-color", "semantics"])

/**
 * Areas whose answer is a concrete value the user may want to type exactly —
 * a family name or a hex. These must never be settled by an assumptions
 * confirmation: test4's opening assumptions claimed `brand-color`, so the
 * dedicated brand question never came and the exact hex was never the user's.
 */
const VALUE_AREAS = new Set(["display-type", "body-type", "brand-color", "secondary-color", "accent-color"])

/** "You decide" and its relatives — see the delegation check below. */
const DELEGATE_OPTION =
	/\byou (decide|choose|pick)\b|\b(up to you|your call|whatever you think|whatever works|surprise me|dealer'?s choice|(you|caret) (pick|choose)s? for me|let (you|caret) (decide|choose|pick))\b/i

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
function systemPrompt(mode: WizardMode): string {
	const pairings = TYPEFACE_PAIRINGS.map(
		(p) => `- ${p.display.family} for headings with ${p.body.family} for body — ${p.feel}`,
	).join("\n")
	const palettes = PALETTE_RECIPES.map((r) => `- ${r.seed} on a ${r.surface} ${r.neutral}-neutral surface — ${r.feel}`).join(
		"\n",
	)

	const intro =
		mode === "collaborative"
			? `You are running a visual-foundations interview inside Caret, a design tool.
The person answering knows what they are building AND has real design opinions — they want
you for the heavy lifting, not the deciding. Your job: work through every foundation
decision WITH them — typefaces, the full colour palette, type scale and weight, density,
corner character, depth — proposing with your reasoning visible and letting them choose.`
			: `You are running a short visual-foundations interview inside Caret, a design tool.
The person answering is a developer who knows exactly what they are building and is not a
designer. Your job: decide the foundations their project needs — typefaces, colour, density,
corner character — by asking the fewest, best questions, then hand back the parameters.`

	const behave =
		mode === "collaborative"
			? `## How to behave

- **You may not decide anything silently.** Every foundation parameter comes from an
  answered question. Propose — with the reasoning in \`why\` and each option's \`reason\` —
  and let them pick; confirm inferences from their description with an \`assumptions\`
  question rather than assuming quietly.
- **You must cover every one of these areas before finishing**, each with at least one
  answered question tagged with it:
${COVERAGE_AREAS.map((area) => `  - \`${area.id}\` — ${area.label}`).join("\n")}
  Tag every question with \`covers: [...]\` naming the area it settles.
- **One decision per question.** Every question except \`assumptions\` carries exactly ONE
  \`covers\` area. No pairing cards ("heading + body at once"), no combined last-two-things
  questions — a bundled question breaks the purpose-built input for each decision.
- **Assumptions confirm context; they never settle values.** An \`assumptions\` question may
  cover character areas (\`surface\`, \`neutral\`, \`semantics\`, \`spacing\`, \`radius\`, \`depth\`,
  \`type-scale\`) but never the typefaces or the brand/supporting/accent colours — those
  always get their own question with their own widget.
- The palette is more than one colour: ask about the supporting colour and the accent
  colour explicitly ("none" is a legitimate answer, but it must be their answer). Colour
  questions use kind \`color\` — it carries the picker, hex field and eyedropper; an option
  that means "none" simply omits its hex.
- **Name the numbers.** Plain language stays, but this person wants to see exactly what
  they are choosing: every option that embodies a value states it — hexes, pixel sizes,
  ratios, spacing units ("Comfortable — 16px body text, headings step up ×1.25"). An
  option without its number cannot be held to anything.
- **Never offer an option that means "you decide" / "whatever you think".** Your
  \`recommendedId\` already carries your proposal; every option names a concrete outcome.
  The UI has a Skip button — a skipped question means your recommendation stands, and its
  concrete value still goes in \`decisions\`.
- Answers may arrive as the user's own typed value instead of one of your options. Take
  them verbatim — exact values from the user are the point of this mode.
- You will be told the count; at ${COLLABORATIVE_QUESTION_CAP} you must finish.
- Still mark a \`recommendedId\` — **except on \`assumptions\`, which must not have one.** A
  recommendation is your proposal to react to, not a decision made for them.
- Options should differ meaningfully. Three near-identical blues is not a question.
- Typefaces must be real Google Fonts family names, spelled exactly. Colours are 6-digit hex.`
			: `## How to behave

- **Never ask what their description already answers.** Infer it, and confirm inferences with
  one \`assumptions\` question rather than several individual ones.
- Aim for 4–7 questions total. You will be told the count; at ${QUESTION_CAP} you must finish.
- Never offer an option that means "you decide" — the Skip button and your \`recommendedId\`
  already cover that; every option names a concrete outcome.
- Always mark a \`recommendedId\` — **except on \`assumptions\`, which must not have one.**
  Someone pressing straight through your questions must end up with a foundation you would
  defend.
- Options should differ meaningfully. Three near-identical blues is not a question.
- Typefaces must be real Google Fonts family names, spelled exactly. Colours are 6-digit hex.`

	return `${intro}

${behave}

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
${
	mode === "collaborative"
		? `
This person is design-savvy, so the profession's names are welcome — but give the name
alongside the plain meaning ("a type scale — how much bigger each heading step gets"),
never instead of it.
`
		: ""
}
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
Optional when the product calls for them: a \`secondary\` hex, an \`accent\` hex, an
\`elevationCharacter\` (flat/subtle/pronounced), a \`displayWeight\` and \`bodyWeight\`.
Caret derives all scales and writes the file — you name parameters only.${
		mode === "collaborative"
			? `

The finish must also carry \`decisions\`: one entry per coverage area (\`area\`, \`choice\`,
\`reason\`), each reason grounded in what THEY answered — this is the record that lets them
audit the design system later. A finish that skips an area or its decision is rejected.`
			: ""
	}

## Known-good references (use or ignore freely)

Pairings that work:
${pairings}

Colour directions that work:
${palettes}`
}

function turnPrompt(
	mode: WizardMode,
	description: string,
	history: StoredQA[],
	questionCount: number,
	force: boolean,
	complaint?: string,
): string {
	const transcript = history.length
		? history
				.map((qa) => {
					const answer = qa.answer.skipped
						? "(skipped — they left this one to your recommendation)"
						: `${qa.answer.label ?? qa.answer.value}${qa.answer.wasOther ? " (their own, not one of your options)" : ""}`
					return `Q: ${qa.question.question}\nA: ${answer}`
				})
				.join("\n\n")
		: "(nothing asked yet)"

	let coverageNote = ""
	if (mode === "collaborative" && !force) {
		const covered = new Set(coveredAreas(history))
		const missing = COVERAGE_AREAS.filter((area) => !covered.has(area.id))
		coverageNote = missing.length
			? `\n\nCovered so far: ${covered.size ? [...covered].join(", ") : "(nothing)"}. Still missing: ${missing
					.map((area) => `\`${area.id}\` (${area.label})`)
					.join(", ")} — you may not finish until every area has been asked about.`
			: "\n\nEvery coverage area has been asked about — finish when you can defend every parameter."
	}

	return `Their project, in their words:

"""
${description.trim()}
"""

The interview so far (${questionCount} question(s) asked):

${transcript}${coverageNote}

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

	// The schema names the kinds, but the backend does not enforce the schema —
	// a question arrived with NO kind at all (field-measured: test4's spacing
	// question), matched nothing in the renderer, and drew an empty screen with
	// Continue disabled forever. Everything the renderer needs gets checked
	// HERE, never trusted to the wire.
	if (!KNOWN_KINDS.includes(question.kind)) {
		throw new WizardTurnError(
			`the question has kind ${question.kind ? `"${String(question.kind)}"` : "missing"} — it must be one of: ${KNOWN_KINDS.join(", ")}.`,
		)
	}

	// Coverage tags: sanitized FIRST, never rejected over — an unknown tag is
	// noise, not a broken screen, and it must not count toward the atomicity
	// check below.
	if (question.covers) {
		const known = new Set(COVERAGE_AREAS.map((area) => area.id))
		const covers = question.covers.filter((id) => known.has(id))
		question.covers = covers.length ? covers : undefined
	}

	// One decision per question. A bundled question breaks the purpose-built
	// input for each decision: test4's pairing card asked for heading AND body
	// faces at once, and the font search — which picks one family — could not
	// answer it, leaving only free text. Assumptions are the one exception
	// (each statement is independently confirmable), but they confirm context,
	// never values: the same run's opening assumptions claimed `brand-color`,
	// so no dedicated brand question ever came and the hex was never the
	// user's. Both rules only bite where `covers` exists — collaborative mode.
	if (question.kind !== "assumptions" && (question.covers?.length ?? 0) > 1) {
		throw new WizardTurnError(
			`"${question.id}" claims to settle ${question.covers?.length} areas (${question.covers?.join(", ")}) — ` +
				`one decision per question. Split it, one \`covers\` area each.`,
		)
	}
	if (question.kind === "assumptions") {
		const claimed = (question.covers ?? []).filter((id) => VALUE_AREAS.has(id))
		if (claimed.length) {
			throw new WizardTurnError(
				`an assumptions question may not settle ${claimed.join(", ")} — typefaces and palette colours ` +
					`always get their own question with their own widget. Drop those tags and ask properly.`,
			)
		}
	}

	// A colour decision answered through a plain card or a bare text box loses
	// the picker, the hex field and the eyedropper — the user typed a hex into
	// a text input while a purpose-built widget sat unused (field-measured:
	// test4's accent question came as kind "options").
	const settlesColour = (question.covers ?? []).some((id) => COLOR_AREAS.has(id))
	if (settlesColour && !["color", "boolean", "assumptions"].includes(question.kind)) {
		throw new WizardTurnError(
			`"${question.id}" settles a colour but is kind "${question.kind}" — colour questions use kind "color" ` +
				`(swatch options plus the built-in picker); an option that means "none" may simply omit its hex.`,
		)
	}

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

		// A "you decide" option is a non-answer taking up an answer's seat: the
		// user clicks it because their value is not on offer, and the question
		// closes with nothing said. Skip and `recommendedId` carry delegation.
		const delegating = options.find((option) => DELEGATE_OPTION.test(`${option.label} ${option.reason ?? ""}`))
		if (delegating && question.kind !== "assumptions") {
			throw new WizardTurnError(
				`"${delegating.label}" means "you decide", which the Skip button and your recommendedId already cover — ` +
					`every option must name a concrete outcome.`,
			)
		}

		const minimum = question.kind === "assumptions" ? 1 : 2
		if (options.length < minimum) {
			throw new WizardTurnError(`"${question.kind}" needs at least ${minimum} options, got ${options.length}.`)
		}
		if (question.kind === "boolean" && options.length !== 2) {
			throw new WizardTurnError(`"boolean" needs exactly 2 options, got ${options.length}.`)
		}
		if (question.kind === "color") {
			// An option without a hex is the "none" shape ("no accent colour") —
			// legal, so a colour question never has to fall back to plain cards.
			// A hex that is PRESENT but unusable is still a refusal.
			let withHex = 0
			for (const option of options) {
				if (option.hex === undefined || option.hex === null || option.hex === "") {
					delete option.hex
					continue
				}
				const hex = normalizeHex(option.hex)
				if (!hex) throw new WizardTurnError(`colour option "${option.label}" has no valid hex.`)
				option.hex = hex
				withHex++
			}
			if (withHex === 0) {
				throw new WizardTurnError(`a colour question needs at least one option with a hex.`)
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
	/** Absent means the original minimal interview. */
	mode?: WizardMode
}

/**
 * Collaborative mode's contract, enforced: a finish the user did not force must
 * have asked about every coverage area and must carry a decision per area.
 * Throws a quotable sentence; the caller's retry does the rest.
 */
function checkCollaborativeFinish(foundation: FoundationProposal, history: StoredQA[]): void {
	const covered = new Set(coveredAreas(history))
	const unasked = COVERAGE_AREAS.filter((area) => !covered.has(area.id))
	if (unasked.length) {
		throw new WizardTurnError(
			`you have not asked about: ${unasked.map((area) => `\`${area.id}\` (${area.label})`).join(", ")}. ` +
				`Ask about them (tagging the questions with \`covers\`) before finishing.`,
		)
	}
	const decided = new Set((foundation.decisions ?? []).map((decision) => decision.area))
	const undecided = COVERAGE_AREAS.filter((area) => !decided.has(area.id))
	if (undecided.length) {
		throw new WizardTurnError(
			`the finish is missing \`decisions\` entries for: ${undecided.map((area) => area.id).join(", ")}. ` +
				`Every coverage area needs { area, choice, reason }.`,
		)
	}
}

export async function nextWizardTurn(input: ConductorInput): Promise<WizardTurn> {
	const mode = input.mode ?? "ai-led"
	const force = input.force === "finish" || input.history.length >= questionCapFor(mode)

	const attempt = async (complaint?: string): Promise<WizardTurn> => {
		const result = await input.backend.structured<{
			action: string
			question?: WizardQuestion
			foundation?: FoundationProposal
		}>({
			workingDirectory: input.workingDirectory,
			prompt: turnPrompt(mode, input.description, input.history, input.history.length, force, complaint),
			schema: WIZARD_TURN_SCHEMA,
			systemPrompt: systemPrompt(mode),
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
			// "Just finish it" is the user's escape and the cap is the backstop —
			// both must terminate, so only a model-chosen finish has to earn it.
			if (mode === "collaborative" && !force) checkCollaborativeFinish(value.foundation, input.history)
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

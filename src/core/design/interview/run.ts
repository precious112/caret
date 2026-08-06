/**
 * Ranking one step.
 *
 * Caret decides what is asked and in what order; the model only says which of
 * Caret's options fit best and why. It never chooses the next step, never
 * invents an option, and never writes a file.
 *
 * Two things enforce that rather than request it:
 *
 * 1. **The schema's `enum` is the step's candidate ids.** A model cannot name a
 *    typeface or a hex outside the library, because the request is rejected
 *    before Caret sees an answer. That is the anti-slop floor moved from a
 *    prompt (which a model may ignore) into the wire format (which it cannot).
 * 2. **Post-validation regardless.** Schema-valid is not semantically valid: an
 *    id can be repeated, or belong to a different step. Both have to be caught
 *    here, because a duplicate would render as the same specimen twice and read
 *    as a bug in the library rather than in the answer.
 *
 * Degradation is per step, never for the whole interview. A `structured()`
 * failure — or no backend at all — falls back to the deterministic tag ordering
 * and shows the same screens without the reasoning line. The interview never
 * dead-ends on backend state, because a user who cannot reach a model still
 * needs foundations.
 */
import { Logger } from "@/shared/services/Logger"
import type { CodingBackend } from "../agent/backend"
import type { Decisions, InterviewStep, StepOption } from "./steps"
import { tagsFromDescription } from "./steps"

/** How many options a step puts on screen. */
export const RANKED_COUNT = 3

export interface RankedOption extends StepOption {
	/**
	 * Why this one, in the user's terms — "dashboards get read for hours, so
	 * this is sized for long sessions". Absent on the deterministic path, and
	 * the UI says so rather than inventing a line.
	 */
	reason?: string
}

export interface StepRanking {
	options: RankedOption[]
	/** True when a model ranked these; false when the deterministic order did. */
	reasoned: boolean
	/** Why the model's ranking was not used, when it wasn't. */
	degradedBecause?: string
}

interface ModelRanking {
	ranking: Array<{ id: string; reason: string }>
}

function schemaFor(ids: string[]): Record<string, unknown> {
	return {
		type: "object",
		required: ["ranking"],
		additionalProperties: false,
		properties: {
			ranking: {
				type: "array",
				minItems: RANKED_COUNT,
				maxItems: RANKED_COUNT,
				items: {
					type: "object",
					required: ["id", "reason"],
					additionalProperties: false,
					properties: {
						// The floor. Not advice — a constraint the request carries.
						id: { enum: ids },
						reason: { type: "string" },
					},
				},
			},
		},
	}
}

function promptFor(step: InterviewStep, description: string, decisions: Decisions, options: StepOption[]): string {
	const settled = Object.entries(decisions)
		.map(([key, value]) => `- ${key}: ${value}`)
		.join("\n")

	return `A developer is setting up the visual foundations for something they are building.
They described it in their own words:

"""
${description.trim()}
"""

${settled ? `Already settled:\n${settled}\n` : ""}
Now: **${step.title}** ${step.subtitle}

Rank the ${RANKED_COUNT} options below that best fit what they described, best first.

${options.map((option) => `- ${option.id} — ${option.name}: ${option.summary}`).join("\n")}

For each, give one short reason **grounded in what they said**, addressed to them.
Write like you are talking to a competent developer who is not a designer: say what it
does for their product, not what it is called. "Dashboards get read for hours, so this
is sized for long sessions" — not "a humanist sans with a moderate x-height".

Use only ids from the list. Do not repeat one.`
}

/**
 * Keeps only answers that are real, unique, and from this step.
 *
 * Silently dropping the rest and topping up from the deterministic order beats
 * failing the step: the user gets a full screen either way, and the reasons that
 * did survive are still the model's.
 */
function validate(ranking: ModelRanking["ranking"], options: StepOption[]): RankedOption[] {
	const byId = new Map(options.map((option) => [option.id, option]))
	const seen = new Set<string>()
	const kept: RankedOption[] = []

	for (const entry of ranking ?? []) {
		const option = byId.get(entry?.id)
		if (!option || seen.has(entry.id)) continue
		seen.add(entry.id)
		kept.push({ ...option, reason: entry.reason?.trim() || undefined })
	}
	return kept
}

/** Pads a short ranking with the deterministic order, so a screen is never thin. */
function topUp(kept: RankedOption[], fallback: StepOption[]): RankedOption[] {
	const seen = new Set(kept.map((option) => option.id))
	for (const option of fallback) {
		if (kept.length >= RANKED_COUNT) break
		if (seen.has(option.id)) continue
		seen.add(option.id)
		kept.push(option)
	}
	return kept.slice(0, RANKED_COUNT)
}

export interface RankStepInput {
	step: InterviewStep
	description: string
	decisions: Decisions
	workingDirectory: string
	/** Null runs the whole interview deterministically. */
	backend: CodingBackend | null
	model?: string
}

export async function rankStep(input: RankStepInput): Promise<StepRanking> {
	const { step, description, decisions, backend } = input
	const options = step.options(decisions)
	const tags = tagsFromDescription(description)
	const deterministic = topUp([], step.fallback(decisions, tags))

	if (!backend) {
		return { options: deterministic, reasoned: false, degradedBecause: "no coding backend is set up" }
	}
	if (options.length === 0) {
		return { options: deterministic, reasoned: false, degradedBecause: "the library offered nothing at this step" }
	}

	try {
		const result = await backend.structured<ModelRanking>({
			workingDirectory: input.workingDirectory,
			prompt: promptFor(step, description, decisions, options),
			schema: schemaFor(options.map((option) => option.id)),
			model: input.model,
		})

		const kept = validate(result.value?.ranking ?? [], options)
		if (kept.length === 0) {
			return { options: deterministic, reasoned: false, degradedBecause: "the model returned nothing usable" }
		}
		// `reasoned` tracks whether a *reason* survived, not whether the call
		// succeeded: an emulated backend can parse into the right shape with empty
		// strings, and a screen claiming reasoning it cannot show is worse than one
		// that admits it has none.
		const padded = topUp(kept, step.fallback(decisions, tags))
		return { options: padded, reasoned: padded.some((option) => option.reason) }
	} catch (err) {
		Logger.warn(`[interview] ranking "${step.id}" failed, falling back: ${err}`)
		return { options: deterministic, reasoned: false, degradedBecause: "the model could not be reached" }
	}
}

/**
 * The interview's steps, as data.
 *
 * Caret owns the sequence; the model only ranks what is already in the library.
 * Keeping the steps a table rather than control flow is what makes that
 * separation checkable: every step declares its own candidate set, and the
 * machine in `run.ts` never learns what a typeface *is*.
 *
 * **Why these four and not the six first sketched.** Typeface, colour direction,
 * brand colour and shape each ask something the description genuinely cannot
 * settle. The sketch also listed *density/spacing* and *corner character* as
 * separate steps, and the library deliberately refuses to separate them — a
 * preset's own rationale says it outright: "larger radii need larger spacing or
 * the rounding eats the padding and elements look cramped." Splitting them lets
 * a user assemble round corners with tight spacing, which is precisely the
 * combination the curation exists to prevent. The sixth, border-and-elevation
 * weight, has nowhere to be written — `FoundationTokens` has no such field and
 * the library has no such axis — so it needs curated content and a token change
 * before it can be a step at all.
 */
import {
	findPairing,
	findPreset,
	findRecipe,
	LIBRARY_TAGS,
	narrowPairings,
	narrowPresets,
	narrowRecipes,
	PALETTE_RECIPES,
	type PaletteRecipe,
	SHAPE_PRESETS,
	type ShapePreset,
	TYPEFACE_PAIRINGS,
	type TypefacePairing,
} from "../foundation-library"

export type StepId = "typeface" | "palette" | "brand" | "shape"

/** What the user has settled so far. Every value is a library id, or a hex for `brand`. */
export type Decisions = Partial<Record<StepId, string>>

/** One thing the user can look at and point at. */
export interface StepOption {
	id: string
	name: string
	/** One line, plain language. Never a hex code or a scale ratio. */
	summary: string
}

export interface InterviewStep {
	id: StepId
	/** The question, in the user's language rather than a designer's. */
	title: string
	subtitle: string
	/**
	 * Everything pickable at this step, given what came before.
	 *
	 * This *is* the schema enum, so it is also the anti-slop floor: a model
	 * cannot name a typeface or a hex that isn't in here, because the request
	 * rejects it before Caret ever sees the answer.
	 */
	options(decisions: Decisions): StepOption[]
	/** The deterministic order, used when there is no backend or the model fails. */
	fallback(decisions: Decisions, tags: string[]): StepOption[]
}

/** The chosen typeface, or the whole set before that step is answered. */
function pairing(decisions: Decisions): TypefacePairing | undefined {
	return decisions.typeface ? findPairing(decisions.typeface) : undefined
}

/** Recipes this typeface is declared to work with — never the whole library. */
function allowedRecipes(decisions: Decisions): PaletteRecipe[] {
	const chosen = pairing(decisions)
	if (!chosen) return PALETTE_RECIPES
	const allowed = chosen.pairsWith.palettes.map(findRecipe).filter(Boolean) as PaletteRecipe[]
	return allowed.length > 0 ? allowed : PALETTE_RECIPES
}

function allowedPresets(decisions: Decisions): ShapePreset[] {
	const chosen = pairing(decisions)
	if (!chosen) return SHAPE_PRESETS
	const allowed = chosen.pairsWith.shapes.map(findPreset).filter(Boolean) as ShapePreset[]
	return allowed.length > 0 ? allowed : SHAPE_PRESETS
}

/**
 * Brand colours, drawn from the recipes' own seeds.
 *
 * Every hex offered is one the library already chose for a palette, so the step
 * introduces no uncurated colour. The chosen recipe's own seed leads, because it
 * is the one that recipe was designed around; the rest are there so "I want the
 * strategy but not the blue" doesn't force the user out to the picker.
 */
function brandOptions(decisions: Decisions): StepOption[] {
	const chosen = decisions.palette ? findRecipe(decisions.palette) : undefined
	const ordered = chosen ? [chosen, ...PALETTE_RECIPES.filter((r) => r.id !== chosen.id)] : PALETTE_RECIPES

	const seen = new Set<string>()
	const options: StepOption[] = []
	for (const recipe of ordered) {
		const seed = recipe.seed.toLowerCase()
		if (seen.has(seed)) continue
		seen.add(seed)
		options.push({
			id: recipe.seed,
			name: recipe.name,
			summary: recipe === chosen ? `The colour this direction was built around. ${recipe.feel}` : recipe.feel,
		})
	}
	return options
}

export const INTERVIEW_STEPS: InterviewStep[] = [
	{
		id: "typeface",
		title: "How should the words look?",
		subtitle: "Every option is a pairing somebody chose deliberately — a face for headings, one for reading.",
		options: () => TYPEFACE_PAIRINGS.map((p) => ({ id: p.id, name: p.name, summary: p.feel })),
		fallback: (_decisions, tags) =>
			narrowPairings(tags, TYPEFACE_PAIRINGS.length).map((p) => ({ id: p.id, name: p.name, summary: p.feel })),
	},
	{
		id: "palette",
		title: "How much colour?",
		subtitle: "This decides the mood more than the brand colour does.",
		options: (decisions) => allowedRecipes(decisions).map((r) => ({ id: r.id, name: r.name, summary: r.feel })),
		fallback: (decisions, tags) => {
			const allowed = new Set(allowedRecipes(decisions).map((r) => r.id))
			return narrowRecipes(tags, PALETTE_RECIPES.length)
				.filter((r) => allowed.has(r.id))
				.map((r) => ({ id: r.id, name: r.name, summary: r.feel }))
		},
	},
	{
		id: "brand",
		title: "Which colour is yours?",
		subtitle: "The one thing on screen that is unmistakably you. It gets used sparingly, on purpose.",
		options: brandOptions,
		fallback: brandOptions,
	},
	{
		id: "shape",
		title: "How much room should things have?",
		subtitle: "Corners and spacing move together — a round corner needs room around it or it looks cramped.",
		options: (decisions) => allowedPresets(decisions).map((s) => ({ id: s.id, name: s.name, summary: s.feel })),
		fallback: (decisions, tags) => {
			const allowed = new Set(allowedPresets(decisions).map((s) => s.id))
			return narrowPresets(tags, SHAPE_PRESETS.length)
				.filter((s) => allowed.has(s.id))
				.map((s) => ({ id: s.id, name: s.name, summary: s.feel }))
		},
	},
]

export function stepAt(index: number): InterviewStep | undefined {
	return INTERVIEW_STEPS[index]
}

/**
 * Library tags the user's own words imply.
 *
 * Tag matching is exact, so this is word-boundary matching against the published
 * vocabulary rather than anything cleverer — "a dashboard for technical teams"
 * yields `dashboard`, `technical`. It only has to be good enough to order the
 * fallback; the model's ranking is the good path, and pretending otherwise by
 * fuzzy-matching would produce a narrowing that looks considered and isn't.
 */
export function tagsFromDescription(description: string): string[] {
	const text = description.toLowerCase()
	return LIBRARY_TAGS.filter((tag) => new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
}

/**
 * The Presets tab's ordering: the step's tag-ranked fallback, topped up from
 * the full option set so a screen is never thin. Deterministic on purpose —
 * this tab is for someone who wants full control and zero model involvement,
 * and it must produce the same screens on every machine, every time.
 */
export function deterministicOptions(step: InterviewStep, decisions: Decisions, tags: string[], count = 3): StepOption[] {
	const ranked = step.fallback(decisions, tags)
	const seen = new Set(ranked.map((option) => option.id))
	for (const option of step.options(decisions)) {
		if (ranked.length >= count) break
		if (seen.has(option.id)) continue
		seen.add(option.id)
		ranked.push(option)
	}
	return ranked.slice(0, count)
}

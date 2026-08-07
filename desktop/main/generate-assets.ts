/**
 * The generation surface's main-process half.
 *
 * Everything here is cheap and synchronous, which is a property of the
 * generator lane rather than of this file: a recipe card and a variant are both
 * a few hundred bytes of SVG produced from an integer, so the picker can afford
 * to render the *actual* thing at every step instead of a stock preview. The
 * lanes that cost money arrive later and will need a different shape — a job
 * with progress and a failure state — which is why these handlers are named for
 * what they do rather than for the lane that does it.
 *
 * **Nothing touches disk until the user picks one.** Variants are handed to the
 * renderer as inline data URLs; only `accept` writes, and it writes through the
 * §4.6 asset pipeline so a generated asset is an asset like any other.
 */
import {
	addGeneratedAsset,
	composeVariants,
	defaultAspect,
	derivePalette,
	describeVariant,
	findAssetRecipe,
	findGenerator,
	GENERATION_QUESTIONS,
	type GenerationAnswers,
	narrowForAnswers,
	proposeTag,
	readFoundationTokens,
} from "../../src/core/design"
import type { GeneratedVariantWire, GenerationQuestionWire, RecipeCardWire, WriteResult } from "../shared/ipc"

/** How many options the picker shows. Free here, so the number is a taste call. */
const VARIANT_COUNT = 8

export function generationQuestions(): GenerationQuestionWire[] {
	return GENERATION_QUESTIONS.map((question) => ({
		id: question.id,
		question: question.question,
		why: question.why,
		choices: question.choices.map((choice) => ({ id: choice.id, label: choice.label, hint: choice.hint })),
	}))
}

/**
 * Recipes that fit the answers, each already rendered for this project.
 *
 * The card shows variant 0 at the recipe's own default proportions. Showing
 * every card at one shared ratio would be tidier and would misrepresent half of
 * them — a section divider is 21:9 because that is what it is for.
 */
export async function recipeCards(projectPath: string, answers: GenerationAnswers): Promise<RecipeCardWire[]> {
	const tokens = await readFoundationTokens(projectPath).catch(() => null)

	const palette = derivePalette(tokens)

	return narrowForAnswers(answers, tokens).map((recipe) => {
		const aspect = defaultAspect(recipe, answers)
		const [specimen] = composeVariants({ recipe, tokens, aspect, answers, count: 1 })
		const generator = specimen?.request.lane === "generator" ? findGenerator(specimen.request.generatorId) : undefined
		return {
			id: recipe.id,
			name: recipe.name,
			use: recipe.use,
			kind: recipe.kind,
			aspects: recipe.aspects,
			specimen: dataUrl(specimen?.svg ?? ""),
			surface: palette.surface,
			transparent: generator?.transparent ?? false,
		}
	})
}

export async function recipeVariants(
	projectPath: string,
	recipeId: string,
	answers: GenerationAnswers,
	aspect: string,
	count = VARIANT_COUNT,
): Promise<GeneratedVariantWire[]> {
	const recipe = findAssetRecipe(recipeId)
	if (!recipe) return []
	const tokens = await readFoundationTokens(projectPath).catch(() => null)
	const palette = derivePalette(tokens)

	return composeVariants({ recipe, tokens, aspect, answers, count }).map((variant) => ({
		variant: variant.variant,
		preview: dataUrl(variant.svg ?? ""),
		width: variant.width,
		height: variant.height,
		surface: palette.surface,
	}))
}

/**
 * Writes the chosen variant, with provenance complete enough to reproduce it.
 *
 * The variant is **recomposed** here rather than carried back from the
 * renderer. Same recipe, same answers, same seed, so it is byte-identical — and
 * it means the bytes that land on disk were produced by the same code path that
 * produced the picture, instead of by whatever the renderer happened to still
 * be holding.
 */
export async function acceptVariant(
	projectPath: string,
	recipeId: string,
	answers: GenerationAnswers,
	aspect: string,
	variant: number,
	tag: string,
): Promise<WriteResult & { tag?: string }> {
	const recipe = findAssetRecipe(recipeId)
	if (!recipe) return { ok: false, error: `No such recipe: "${recipeId}".` }

	const tokens = await readFoundationTokens(projectPath).catch(() => null)
	const composed = composeVariants({ recipe, tokens, aspect, answers, count: variant + 1 })[variant]
	if (!composed?.svg) return { ok: false, error: "That option could not be regenerated." }

	const palette = derivePalette(tokens)
	const result = await addGeneratedAsset({
		projectPath,
		tag: tag.trim() || proposeTag(recipe, answers),
		extension: ".svg",
		bytes: Buffer.from(composed.svg, "utf-8"),
		description: describeVariant(recipe, composed, palette),
		alt: "",
		origin: {
			type: "generated",
			lane: "generator",
			producer: composed.request.lane === "generator" ? composed.request.generatorId : recipe.lane,
			recipeId: recipe.id,
			answers,
			// The resolved request, not a prose summary: this is the field somebody
			// reads when they want to know exactly what produced the file.
			resolved: JSON.stringify({ ...composed.request, aspect, variant: composed.variant }),
		},
	})

	return result.ok ? { ok: true, tag: result.entry.tag } : { ok: false, error: result.reason }
}

/** The proposed name for a pick, so the field opens with something usable. */
export function suggestedTag(recipeId: string, answers: GenerationAnswers): string {
	const recipe = findAssetRecipe(recipeId)
	return recipe ? proposeTag(recipe, answers) : ""
}

/**
 * SVG as a data URL, base64 rather than percent-encoded.
 *
 * These carry `#` in every colour and `<`/`>` throughout, and a percent-encoded
 * `data:image/svg+xml,` URL truncates at the first unescaped `#` — silently, as
 * a broken image with no error anywhere.
 */
function dataUrl(svg: string): string {
	if (!svg) return ""
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`
}

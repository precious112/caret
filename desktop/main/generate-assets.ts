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
	GeminiImages,
	type GenerationAnswers,
	lanesWithRaster,
	NO_RASTER_REASON,
	narrowForAnswers,
	proposeTag,
	readFoundationTokens,
	resolveRasterConfig,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import type { GeneratedVariantWire, GenerationQuestionWire, RecipeCardWire, WriteResult } from "../shared/ipc"
import { postProcessPhotograph } from "./image-post"
import { getSecret } from "./secrets"

/**
 * The raster lane's credentials, keychain first.
 *
 * The stored key is the shipped path; the environment is the test-only Vertex
 * switch and a fallback for machines with no keychain. Resolved per call rather
 * than cached, so entering a key makes the lane work without a restart — the
 * alternative is a settings field that appears to do nothing.
 */
function rasterConfig() {
	return resolveRasterConfig({ apiKey: getSecret("geminiApiKey") })
}

/** How many options the picker shows. Free here, so the number is a taste call. */
const VARIANT_COUNT = 8

/**
 * How many photographs are generated per round.
 *
 * Four, not eight. Every one of these is a paid API call on the user's own key
 * and about fifteen seconds of waiting, so the number that is a taste call in
 * the free lane is a spending decision here. Four is enough to choose from and
 * cheap enough to run again.
 */
const RASTER_VARIANT_COUNT = 4

/**
 * How many image calls are in flight at once.
 *
 * Two, and the number is quota rather than taste. Four at once reliably trips
 * the per-minute image quota on an ordinary project — observed as two of four
 * variants returning "Resource has been exhausted" — and retrying a burst only
 * re-bursts it.
 */
const RASTER_CONCURRENCY = 2

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

	const raster = rasterConfig()

	// The catalogue is shown whole and the unavailable ones say why. Quietly
	// offering fewer options than the library has teaches the user nothing about
	// what exists or what it would take to have it.
	return narrowForAnswers(answers, tokens, lanesWithRaster(true)).map((recipe) => {
		const aspect = defaultAspect(recipe, answers)
		const [specimen] = composeVariants({ recipe, tokens, aspect, answers, count: 1 })
		const generator = specimen?.request.lane === "generator" ? findGenerator(specimen.request.generatorId) : undefined
		return {
			id: recipe.id,
			name: recipe.name,
			use: recipe.use,
			kind: recipe.kind,
			aspects: recipe.aspects,
			lane: recipe.lane,
			specimen: dataUrl(specimen?.svg ?? ""),
			surface: palette.surface,
			transparent: generator?.transparent ?? false,
			...(recipe.lane === "raster" && !raster ? { unavailable: NO_RASTER_REASON } : {}),
		}
	})
}

/**
 * Photographs that have been generated but not yet chosen.
 *
 * The generator lane needs nothing like this: `accept` recomposes from the
 * recipe and the seed and gets byte-identical output. **A model's output is not
 * reproducible that way** — asking the same question again costs money and
 * returns a different picture — so the bytes have to survive between "show me
 * options" and "I'll take that one", and this is the only honest place for them
 * to live. In memory rather than on disk: an option nobody picked is not a
 * decision, and writing it into `.caret/` would make it look like one.
 */
const pendingRaster = new Map<string, { bytes: Buffer; mime: string; resolved: string; model: string; at: number }>()

/** Ten minutes. Long enough to think, short enough not to be a memory leak. */
const PENDING_TTL_MS = 10 * 60 * 1000

function pendingKey(projectPath: string, recipeId: string, aspect: string, variant: number): string {
	return `${projectPath}::${recipeId}::${aspect}::${variant}`
}

function prunePending(): void {
	const cutoff = Date.now() - PENDING_TTL_MS
	for (const [key, value] of pendingRaster) {
		if (value.at < cutoff) pendingRaster.delete(key)
	}
}

/** Drops everything a project is holding — called when the picker closes. */
export function discardPending(projectPath: string): void {
	for (const key of pendingRaster.keys()) {
		if (key.startsWith(`${projectPath}::`)) pendingRaster.delete(key)
	}
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

	if (recipe.lane === "raster") {
		return generateRasterVariants(projectPath, recipe.id, answers, aspect, tokens, palette.surface)
	}

	return composeVariants({ recipe, tokens, aspect, answers, count }).map((variant) => ({
		variant: variant.variant,
		preview: dataUrl(variant.svg ?? ""),
		width: variant.width,
		height: variant.height,
		surface: palette.surface,
	}))
}

/**
 * Four photographs, in parallel, each with its own failure.
 *
 * Parallel because these are ~15s apiece and four in sequence is a minute of
 * staring at nothing. Per-variant failures rather than one collective one
 * because a content refusal on one framing says nothing about the other three —
 * collapsing them into "generation failed" would throw away three good images
 * to report one bad one.
 */
async function generateRasterVariants(
	projectPath: string,
	recipeId: string,
	answers: GenerationAnswers,
	aspect: string,
	tokens: Awaited<ReturnType<typeof readFoundationTokens>>,
	surface: string,
): Promise<GeneratedVariantWire[]> {
	const config = rasterConfig()
	const recipe = findAssetRecipe(recipeId)
	if (!recipe) return []
	if (!config) {
		return [{ variant: 0, preview: "", width: 0, height: 0, surface, error: NO_RASTER_REASON }]
	}

	prunePending()
	const client = new GeminiImages(config)
	const composed = composeVariants({ recipe, tokens, aspect, answers, count: RASTER_VARIANT_COUNT })

	return inPool(composed, RASTER_CONCURRENCY, async (variant): Promise<GeneratedVariantWire> => {
		if (variant.request.lane !== "raster") {
			return { variant: variant.variant, preview: "", width: 0, height: 0, surface, error: "not a raster recipe" }
		}

		const ask = () =>
			client.generate({
				prompt: variant.request.lane === "raster" ? variant.request.prompt : "",
				avoid: variant.request.lane === "raster" ? variant.request.avoid : [],
				aspect: variant.request.lane === "raster" ? variant.request.aspect : aspect,
			})

		let result = await ask()
		if (!result.ok && result.retryable) {
			// The pool keeps the burst small; this catches what still slips
			// through, for the price of one extra call and only for the variant
			// that actually failed. A refusal is never retried — that spends money
			// to be told the same thing again.
			await new Promise((resolve) => setTimeout(resolve, 6000))
			result = await ask()
		}

		if (!result.ok) {
			Logger.warn(`[generate] raster variant ${variant.variant} failed: ${result.reason}`)
			return { variant: variant.variant, preview: "", width: 0, height: 0, surface, error: result.reason }
		}

		pendingRaster.set(pendingKey(projectPath, recipeId, aspect, variant.variant), {
			bytes: result.bytes,
			mime: result.mime,
			resolved: result.resolved,
			model: result.model,
			at: Date.now(),
		})

		return {
			variant: variant.variant,
			preview: `data:${result.mime};base64,${result.bytes.toString("base64")}`,
			width: variant.width,
			height: variant.height,
			surface,
		}
	})
}

/**
 * Runs `work` over `items` with at most `limit` in flight, preserving order.
 *
 * Not an optimisation — a correctness fix. Four image calls fired at once trip
 * the per-minute quota on an ordinary Google Cloud project, and two of every
 * four came back "Resource has been exhausted" in a real run. Retrying a burst
 * just re-burst it. Limiting the burst is the thing that actually helps, and
 * two at a time still halves the wait against running them one by one.
 */
async function inPool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0

	const runner = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++
			results[index] = await work(items[index])
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
	return results
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
	if (recipe.lane === "raster") {
		return acceptRasterVariant(projectPath, recipe, answers, aspect, variant, tag, tokens)
	}

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

/**
 * Writes the chosen photograph from the pending set.
 *
 * Deliberately never regenerates. Re-asking the model would spend money to
 * produce a *different* picture from the one the user pointed at, which is the
 * single most surprising thing this surface could do — so an expired pick is a
 * refusal that says to choose again, not a silent substitution.
 */
async function acceptRasterVariant(
	projectPath: string,
	recipe: NonNullable<ReturnType<typeof findAssetRecipe>>,
	answers: GenerationAnswers,
	aspect: string,
	variant: number,
	tag: string,
	tokens: Awaited<ReturnType<typeof readFoundationTokens>>,
): Promise<WriteResult & { tag?: string }> {
	prunePending()
	const held = pendingRaster.get(pendingKey(projectPath, recipe.id, aspect, variant))
	if (!held) {
		return {
			ok: false,
			error: "That image is no longer held in memory. Generate again and pick one — re-asking the model would produce a different picture.",
		}
	}

	const palette = derivePalette(tokens)
	const [composed] = composeVariants({ recipe, tokens, aspect, answers, count: variant + 1 }).slice(variant)

	// Only now, on the one the user actually chose. Post-processing every variant
	// would spend the work on three pictures nobody keeps.
	const processed = await postProcessPhotograph(held.bytes, composed.width, composed.height)
	Logger.info(
		`[generate] ${recipe.id} → ${processed.width}x${processed.height} ${processed.mime}, ` +
			`${Math.round(processed.originalBytes / 1024)}KB → ${Math.round(processed.bytes.length / 1024)}KB`,
	)

	const result = await addGeneratedAsset({
		projectPath,
		tag: tag.trim() || proposeTag(recipe, answers),
		extension: processed.extension,
		bytes: processed.bytes,
		description: describeVariant(recipe, composed, palette),
		alt: "",
		origin: {
			type: "generated",
			lane: "raster",
			producer: held.model,
			recipeId: recipe.id,
			answers,
			// The prompt as sent, negatives included. For a paid lane this is the
			// only record of what the money bought.
			resolved: held.resolved,
			postProcessed: {
				from: { bytes: processed.originalBytes, mime: held.mime },
				to: { bytes: processed.bytes.length, mime: processed.mime, width: processed.width, height: processed.height },
			},
		},
	})

	if (result.ok) discardPending(projectPath)
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

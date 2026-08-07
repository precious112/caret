/**
 * Generating an asset: answer two questions, look at things, point at one.
 *
 * **There is no prompt box on this surface and there is not going to be one.**
 * That is the whole design, and it is Phase 6.5's argument unchanged: a text
 * field asking someone to describe the image they want hands the taste problem
 * straight back to the person who does not have it, and the vocabulary they
 * reach for when cornered — cinematic, 8k, hyperdetailed — is precisely what
 * makes generated imagery legible as generated.
 *
 * So the user's whole contribution is: what is this for, how loud should it be,
 * which of these do you like, what should it be called. Every one of those is
 * answerable without design vocabulary, and pointing at a picture needs none at
 * all.
 *
 * Everything shown here is rendered against **this project's own foundation**.
 * A picker showing stock previews would be arguing against the library's only
 * real claim.
 */
import { useCallback, useEffect, useState } from "react"

import type { GeneratedVariantWire, GenerationQuestionWire, ProjectState, RecipeCardWire } from "../../../shared/ipc"
import { invoke } from "../ipc"
import { cn } from "../lib/utils"

type Stage = "questions" | "recipe" | "variant" | "name"

export function GenerateAsset({ project, onClose }: { project: ProjectState; onClose(saved: string | null): void }) {
	const [questions, setQuestions] = useState<GenerationQuestionWire[]>([])
	const [answers, setAnswers] = useState<Record<string, string>>({})
	const [stage, setStage] = useState<Stage>("questions")
	const [step, setStep] = useState(0)

	const [recipes, setRecipes] = useState<RecipeCardWire[]>([])
	const [recipe, setRecipe] = useState<RecipeCardWire | null>(null)
	const [aspect, setAspect] = useState<string>("")
	const [variants, setVariants] = useState<GeneratedVariantWire[]>([])
	const [chosen, setChosen] = useState<number | null>(null)
	const [tag, setTag] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		void invoke("generate:questions").then((result) => setQuestions(result ?? []))
	}, [])

	const answer = useCallback(
		async (questionId: string, choiceId: string) => {
			const next = { ...answers, [questionId]: choiceId }
			setAnswers(next)

			if (step + 1 < questions.length) {
				setStep(step + 1)
				return
			}

			setBusy(true)
			try {
				const cards = (await invoke("generate:recipes", project.path, next)) ?? []
				setRecipes(cards)
				setStage("recipe")
			} finally {
				setBusy(false)
			}
		},
		[answers, questions.length, project.path, step],
	)

	const chooseRecipe = useCallback(
		async (card: RecipeCardWire, withAspect?: string) => {
			const ratio = withAspect ?? card.aspects[0]
			setRecipe(card)
			setAspect(ratio)
			setChosen(null)
			setBusy(true)
			try {
				setVariants((await invoke("generate:variants", project.path, card.id, answers, ratio, 8)) ?? [])
				setStage("variant")
			} finally {
				setBusy(false)
			}
		},
		[answers, project.path],
	)

	const save = useCallback(async () => {
		if (!recipe || chosen === null) return
		setBusy(true)
		setError(null)
		try {
			const result = await invoke("generate:accept", project.path, recipe.id, answers, aspect, chosen, tag)
			if (result?.ok) onClose(result.tag ?? tag)
			else setError(result?.error ?? "Could not save that.")
		} finally {
			setBusy(false)
		}
	}, [recipe, chosen, project.path, answers, aspect, tag, onClose])

	const question = questions[step]

	return (
		<div className="absolute inset-0 z-40 flex flex-col bg-shell-bg" data-testid="generate-asset">
			<header className="flex items-center justify-between border-b border-shell-border px-8 py-4">
				<div>
					<h1 className="text-lg font-semibold">Generate an asset</h1>
					<p className="text-sm text-shell-muted">
						{stage === "questions"
							? "Two questions, then some things to look at."
							: stage === "recipe"
								? "Every one of these is built from your project's own colours."
								: stage === "variant"
									? "Point at the one you like."
									: "Give it a name you would type."}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{stage !== "questions" && (
						<button
							className="rounded-md border border-shell-border px-3 py-1.5 text-sm"
							data-testid="generate-back"
							onClick={() => {
								if (stage === "name") setStage("variant")
								else if (stage === "variant") setStage("recipe")
								else {
									setStage("questions")
									setStep(Math.max(0, questions.length - 1))
								}
							}}
							type="button">
							Back
						</button>
					)}
					<button
						className="rounded-md border border-shell-border px-3 py-1.5 text-sm"
						onClick={() => onClose(null)}
						type="button">
						Cancel
					</button>
				</div>
			</header>

			<div className="flex-1 overflow-y-auto px-8 py-8">
				{stage === "questions" && question && (
					<section className="mx-auto max-w-2xl" data-testid="generate-question">
						<h2 className="text-xl font-semibold">{question.question}</h2>
						<p className="mt-1 text-sm text-shell-muted">{question.why}</p>
						<div className="mt-6 flex flex-col gap-2">
							{question.choices.map((choice) => (
								<button
									className="rounded-lg border border-shell-border p-4 text-left hover:border-caret-accent disabled:opacity-50"
									data-generate-choice={choice.id}
									disabled={busy}
									key={choice.id}
									onClick={() => answer(question.id, choice.id)}
									type="button">
									<span className="block text-sm font-medium">{choice.label}</span>
									<span className="mt-0.5 block text-xs text-shell-muted">{choice.hint}</span>
								</button>
							))}
						</div>
						<p className="mt-6 text-xs text-shell-muted">
							Question {step + 1} of {questions.length}
						</p>
					</section>
				)}

				{stage === "recipe" && (
					<section className="mx-auto max-w-4xl" data-testid="generate-recipes">
						{recipes.length === 0 ? (
							<p className="text-sm text-shell-muted">
								Nothing in the library fits that yet. Go back and try a different answer.
							</p>
						) : (
							<div className="grid grid-cols-2 gap-4">
								{recipes.map((card) => (
									<button
										className="overflow-hidden rounded-xl border border-shell-border text-left hover:border-caret-accent disabled:opacity-50"
										data-generate-recipe={card.id}
										disabled={busy}
										key={card.id}
										onClick={() => chooseRecipe(card)}
										type="button">
										{/*
										 * On the project's surface, not the chrome's. Several
										 * recipes are transparent by design, and against this
										 * dark shell they showed nothing at all — the picker
										 * offered four options and two of them looked like
										 * empty cards. It is also the only honest preview:
										 * what is being chosen is how this looks on *their*
										 * page, not on Caret's.
										 */}
										<span className="block" style={{ backgroundColor: card.surface }}>
											<img alt="" className="block w-full" src={card.specimen} />
										</span>
										<span className="block border-t border-shell-border p-3">
											<span className="block text-sm font-medium">{card.name}</span>
											<span className="mt-0.5 block text-xs text-shell-muted">{card.use}</span>
										</span>
									</button>
								))}
							</div>
						)}
					</section>
				)}

				{stage === "variant" && recipe && (
					<section className="mx-auto max-w-4xl" data-testid="generate-variants">
						<div className="mb-4 flex items-center gap-2">
							<span className="text-xs text-shell-muted">Proportions</span>
							{/*
							 * A real control rather than a text field, and only the ratios
							 * this recipe was composed for. Offering every ratio would let
							 * someone ask a 21:9 divider for a square, which is not a
							 * variation of the recipe — it is a different one nobody wrote.
							 */}
							{recipe.aspects.map((option) => (
								<button
									className={cn(
										"rounded-md border px-2 py-1 text-xs",
										option === aspect ? "border-caret-accent text-caret-accent" : "border-shell-border",
									)}
									data-generate-aspect={option}
									disabled={busy}
									key={option}
									onClick={() => chooseRecipe(recipe, option)}
									type="button">
									{option}
								</button>
							))}
						</div>

						<div className="grid grid-cols-4 gap-3">
							{variants.map((variant) => (
								<button
									className={cn(
										"overflow-hidden rounded-lg border",
										chosen === variant.variant ? "border-caret-accent" : "border-shell-border",
									)}
									data-generate-variant={variant.variant}
									key={variant.variant}
									onClick={() => {
										setChosen(variant.variant)
										setTag(suggest(recipe, answers))
										setStage("name")
									}}
									type="button">
									<span className="block" style={{ backgroundColor: variant.surface }}>
										<img alt="" className="block w-full" src={variant.preview} />
									</span>
								</button>
							))}
						</div>

						<button
							className="mt-4 text-xs text-shell-muted hover:text-shell-fg"
							data-testid="generate-more"
							disabled={busy}
							onClick={() => chooseRecipe(recipe, aspect)}
							type="button">
							None of these — show me the recipe again
						</button>
					</section>
				)}

				{stage === "name" && recipe && chosen !== null && (
					<section className="mx-auto max-w-lg" data-testid="generate-name">
						<span
							className="block overflow-hidden rounded-lg border border-shell-border"
							style={{ backgroundColor: variants.find((variant) => variant.variant === chosen)?.surface }}>
							<img
								alt=""
								className="block w-full"
								src={variants.find((variant) => variant.variant === chosen)?.preview}
							/>
						</span>
						<label className="mt-6 block text-sm" htmlFor="generated-tag">
							What should it be called?
						</label>
						<p className="mt-1 text-xs text-shell-muted">
							This is what you and your agent will type: <code>@{tag || "name"}</code>
						</p>
						<input
							className="mt-2 w-full rounded-md border border-shell-border bg-transparent px-3 py-2 font-mono text-sm outline-none"
							data-testid="generate-tag"
							id="generated-tag"
							onChange={(event) => setTag(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && save()}
							value={tag}
						/>
						{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
						<button
							className="mt-4 rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
							data-testid="generate-save"
							disabled={busy}
							onClick={save}
							type="button">
							Add to assets
						</button>
					</section>
				)}
			</div>
		</div>
	)
}

/**
 * The name the field opens with.
 *
 * Mirrors `proposeTag` in core rather than calling it — this is renderer code,
 * and the renderer importing main-process modules is a compile error by design.
 * The authority is still core: `accept` falls back to its version when the field
 * is empty, so the two can only disagree about a default nobody kept.
 */
function suggest(recipe: RecipeCardWire, answers: Record<string, string>): string {
	const purpose = answers.purpose
	const prefix = purpose === "background" ? "hero" : purpose === "divider" ? "divider" : purpose === "overlay" ? "grain" : ""
	return [prefix, recipe.id].filter(Boolean).join("-").slice(0, 40).replace(/-+$/, "")
}

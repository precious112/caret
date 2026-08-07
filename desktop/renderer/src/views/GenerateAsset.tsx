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

import type {
	AssetEntryWire,
	GeneratedVariantWire,
	GenerateProgressWire,
	GenerationQuestionWire,
	MarkOutcomeWire,
	Model3dOutcomeWire,
	ProjectState,
	RecipeCardWire,
	TaskModelWire,
} from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"

type Stage = "questions" | "recipe" | "variant" | "name" | "mark" | "model3d"

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

			// Marks and 3D are not variant lanes — one result, minutes of waiting —
			// so they branch to their own flows and the volume question never asks.
			if (questionId === "purpose" && (choiceId === "mark" || choiceId === "object3d")) {
				setStage(choiceId === "mark" ? "mark" : "model3d")
				return
			}

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
			// An unavailable lane is shown, never picked. The card says what is
			// missing; clicking through to an empty variant screen would not.
			if (card.unavailable) return

			const ratio = withAspect ?? card.aspects[0]
			setRecipe(card)
			setAspect(ratio)
			setChosen(null)
			setVariants([])
			setBusy(true)
			setStage("variant")
			try {
				setVariants((await invoke("generate:variants", project.path, card.id, answers, ratio, 8)) ?? [])
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
									: stage === "mark"
										? "The model draws it, sees its own render, and corrects — three rounds."
										: stage === "model3d"
											? "Built from an image in your library, then optimized to a page-friendly weight."
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
								else if (stage === "mark" || stage === "model3d") {
									// These branched straight off the purpose question, so Back
									// returns there — not to a volume question never asked.
									setStage("questions")
									setStep(0)
								} else {
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
										className={cn(
											"overflow-hidden rounded-xl border border-shell-border text-left disabled:opacity-50",
											card.unavailable ? "cursor-default opacity-60" : "hover:border-caret-accent",
										)}
										data-generate-recipe={card.id}
										data-generate-unavailable={card.unavailable ? "" : undefined}
										disabled={busy || Boolean(card.unavailable)}
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
											<span className="mt-0.5 block text-xs text-shell-muted">
												{card.unavailable ?? card.use}
											</span>
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

						{busy && (
							<p className="mb-3 text-xs text-shell-muted" data-testid="generate-working">
								{recipe.lane === "raster"
									? "Generating four photographs on your own key. About fifteen seconds each, running together."
									: "Composing…"}
							</p>
						)}

						{/*
						 * Fewer options means bigger ones. Eight cheap generator variants
						 * read fine at four across; four photographs do not — at that size
						 * you can see that they differ and not whether any is any good,
						 * which is the only question this screen asks.
						 */}
						<div className={cn("grid gap-3", variants.length > 4 ? "grid-cols-4" : "grid-cols-2")}>
							{variants.map((variant) =>
								variant.error ? (
									// The lane's own words, per variant. A content refusal on
									// one framing says nothing about the other three, and
									// collapsing them into one message would throw away good
									// images to report a bad one.
									<p
										className="rounded-lg border border-amber-500/40 p-3 text-xs text-shell-muted"
										data-generate-variant-error={variant.variant}
										key={variant.variant}>
										{variant.error}
									</p>
								) : (
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
								),
							)}
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

				{stage === "mark" && <MarkFlow onClose={onClose} project={project} />}
				{stage === "model3d" && <Model3dFlow onClose={onClose} project={project} />}
			</div>
		</div>
	)
}

/**
 * The mark lane's flow: one fact, then watching the loop converge.
 *
 * The subject field is a fact — what the mark depicts — not a style prompt.
 * Everything about how it should look (palette, lighting language, the avoid
 * list, the size rules) is composed by Caret from the foundation, same as every
 * other lane. The interview's own widget vocabulary already draws this line:
 * free text is for facts only the user knows.
 *
 * The wait is filled with the loop itself: each round's render streams in as
 * the model is shown it, so the user watches the correction happen instead of
 * a spinner claiming progress it cannot show.
 */
function MarkFlow({ project, onClose }: { project: ProjectState; onClose(saved: string | null): void }) {
	const [subject, setSubject] = useState("")
	const [busy, setBusy] = useState(false)
	const [progress, setProgress] = useState("")
	const [rounds, setRounds] = useState<Array<{ round: number; preview: string }>>([])
	const [outcome, setOutcome] = useState<MarkOutcomeWire | null>(null)
	const [tag, setTag] = useState("")
	const [error, setError] = useState<string | null>(null)

	useEffect(
		() =>
			on("generate:progress", (path, update: GenerateProgressWire) => {
				if (path !== project.path || update.job !== "mark") return
				setProgress(update.stage)
				if (update.round !== undefined && update.preview) {
					setRounds((current) => [
						...current.filter((r) => r.round !== update.round),
						{ round: update.round!, preview: update.preview! },
					])
				}
			}),
		[project.path],
	)

	const generate = async () => {
		setBusy(true)
		setOutcome(null)
		setRounds([])
		setError(null)
		try {
			const result = await invoke("generate:mark", project.path, subject.trim())
			setOutcome(result ?? null)
			if (result?.ok) setTag(suggestMarkTag(subject))
		} finally {
			setBusy(false)
			setProgress("")
		}
	}

	const accept = async () => {
		setBusy(true)
		try {
			const result = await invoke("generate:markAccept", project.path, tag)
			if (result?.ok) onClose(result.tag ?? tag)
			else setError(result?.error ?? "Could not save that.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="mx-auto max-w-2xl" data-testid="generate-mark">
			<label className="block text-sm" htmlFor="mark-subject">
				What should the mark depict?
			</label>
			<p className="mt-1 text-xs text-shell-muted">
				A fact, not a style — "a compass rose", "two interlocking rings". How it looks comes from your foundation.
			</p>
			<div className="mt-2 flex gap-2">
				<input
					className="min-w-0 flex-1 rounded-md border border-shell-border bg-transparent px-3 py-2 text-sm outline-none"
					data-testid="mark-subject"
					disabled={busy}
					id="mark-subject"
					onChange={(event) => setSubject(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && subject.trim() && generate()}
					value={subject}
				/>
				<button
					className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
					data-testid="mark-generate"
					disabled={busy || !subject.trim()}
					onClick={generate}
					type="button">
					Draw it
				</button>
			</div>

			<TaskModelPicker disabled={busy} task="mark" />

			{busy && (
				<p className="mt-4 text-xs text-shell-muted" data-testid="mark-progress">
					{progress || "Starting…"}
				</p>
			)}

			{rounds.length > 0 && (
				<div className="mt-4 grid grid-cols-3 gap-3" data-testid="mark-rounds">
					{rounds.map((entry) => (
						<figure className="m-0" key={entry.round}>
							<img alt="" className="w-full rounded-lg border border-shell-border" src={entry.preview} />
							<figcaption className="mt-1 text-center text-[11px] text-shell-muted">Round {entry.round}</figcaption>
						</figure>
					))}
				</div>
			)}

			{outcome && !outcome.ok && (
				<div className="mt-4 rounded-lg border border-amber-500/40 p-3 text-xs text-shell-muted">
					<p>{outcome.reason}</p>
					{outcome.needsAnotherModel && <p className="mt-2">Pick a model that accepts images above, then try again.</p>}
				</div>
			)}

			{outcome?.ok && (
				<div className="mt-5" data-testid="mark-result">
					<p className="mb-2 text-xs text-shell-muted">
						Final — {outcome.rounds} round(s) on {outcome.model}. You watched it get here.
					</p>
					<label className="mt-3 block text-sm" htmlFor="mark-tag">
						What should it be called? <code className="text-xs text-shell-muted">@{tag || "name"}</code>
					</label>
					<div className="mt-2 flex gap-2">
						<input
							className="min-w-0 flex-1 rounded-md border border-shell-border bg-transparent px-3 py-2 font-mono text-sm outline-none"
							data-testid="mark-tag"
							id="mark-tag"
							onChange={(event) => setTag(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && accept()}
							value={tag}
						/>
						<button
							className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
							data-testid="mark-save"
							disabled={busy}
							onClick={accept}
							type="button">
							Add to assets
						</button>
					</div>
					{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
				</div>
			)}
		</section>
	)
}

/**
 * The 3D lane's flow: point at an image, wait honestly, keep or don't.
 *
 * The source picker lists image assets — uploaded or generated, both are
 * assets by now, so one grid covers both, and there is nothing to type at any
 * point. The result screen shows numbers rather than a rendered mesh, because
 * the chrome has no 3D thumbnail yet (BACKLOG) and a fake preview would be
 * worse than an honest absence.
 */
function Model3dFlow({ project, onClose }: { project: ProjectState; onClose(saved: string | null): void }) {
	const [assets, setAssets] = useState<AssetEntryWire[]>([])
	const [source, setSource] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [progress, setProgress] = useState<{ stage: string; detail?: string } | null>(null)
	const [outcome, setOutcome] = useState<Model3dOutcomeWire | null>(null)
	const [tag, setTag] = useState("")
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		void invoke("assets:list", project.path).then((list) => setAssets((list ?? []).filter((asset) => asset.kind === "image")))
	}, [project.path])

	useEffect(
		() =>
			on("generate:progress", (path, update: GenerateProgressWire) => {
				if (path !== project.path || update.job !== "model3d") return
				setProgress({ stage: update.stage, detail: update.detail })
			}),
		[project.path],
	)

	const generate = async () => {
		if (!source) return
		setBusy(true)
		setOutcome(null)
		setError(null)
		try {
			const result = await invoke("generate:model3d", project.path, source)
			setOutcome(result ?? null)
			if (result?.ok) setTag(`${source}-3d`)
		} finally {
			setBusy(false)
			setProgress(null)
		}
	}

	const accept = async () => {
		setBusy(true)
		try {
			const result = await invoke("generate:model3dAccept", project.path, tag)
			if (result?.ok) onClose(result.tag ?? tag)
			else setError(result?.error ?? "Could not save that.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="mx-auto max-w-3xl" data-testid="generate-model3d">
			{assets.length === 0 ? (
				<p className="text-sm text-shell-muted">
					No images in the library yet. Upload one, or generate one first — a 3D object is built <em>from</em> an image,
					and both kinds work as the source.
				</p>
			) : (
				<>
					<p className="mb-2 text-sm">Which image should it be built from?</p>
					<div className="grid grid-cols-4 gap-3">
						{assets.map((asset) => (
							<button
								className={cn(
									"overflow-hidden rounded-lg border text-left",
									source === asset.tag ? "border-caret-accent" : "border-shell-border",
								)}
								data-model3d-source={asset.tag}
								disabled={busy}
								key={asset.tag}
								onClick={() => setSource(asset.tag)}
								type="button">
								{project.canvasUrl && (
									<img
										alt=""
										className="block aspect-square w-full bg-black/20 object-cover"
										src={new URL(asset.url, project.canvasUrl).toString()}
									/>
								)}
								<span className="block truncate p-1.5 font-mono text-[11px] text-shell-muted">@{asset.tag}</span>
							</button>
						))}
					</div>

					<TaskModelPicker disabled={busy} recommendedNote task="model3d" />

					<button
						className="mt-4 rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
						data-testid="model3d-generate"
						disabled={busy || !source}
						onClick={generate}
						type="button">
						Build the model
					</button>
				</>
			)}

			{busy && progress && (
				<p className="mt-4 text-xs text-shell-muted" data-testid="model3d-progress">
					{progress.stage}
					{progress.detail ? ` — ${progress.detail}` : ""}
				</p>
			)}

			{outcome && !outcome.ok && (
				<p className="mt-4 rounded-lg border border-amber-500/40 p-3 text-xs text-shell-muted">{outcome.reason}</p>
			)}

			{outcome?.ok && (
				<div className="mt-5 rounded-lg border border-shell-border p-4" data-testid="model3d-result">
					<p className="text-sm">
						{Math.round((outcome.draftBytes ?? 0) / 1024).toLocaleString()}KB draft →{" "}
						<strong>{Math.round((outcome.optimizedBytes ?? 0) / 1024).toLocaleString()}KB</strong>
					</p>
					{outcome.optimization ? (
						<p className="mt-1 text-xs text-shell-muted">
							{outcome.optimization.faceLimit.toLocaleString()} faces, {outcome.optimization.textureSize}px textures
							— {outcome.optimization.reason}
						</p>
					) : (
						<p className="mt-1 text-xs text-shell-muted">{outcome.reason ?? "Kept as Tripo produced it."}</p>
					)}
					<p className="mt-2 text-[11px] text-shell-muted">
						No preview yet — the library shows 3D as a badge until the chrome grows a renderer.
					</p>
					<div className="mt-3 flex gap-2">
						<input
							className="min-w-0 flex-1 rounded-md border border-shell-border bg-transparent px-3 py-2 font-mono text-sm outline-none"
							data-testid="model3d-tag"
							onChange={(event) => setTag(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && accept()}
							value={tag}
						/>
						<button
							className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
							data-testid="model3d-save"
							disabled={busy}
							onClick={accept}
							type="button">
							Add to assets
						</button>
					</div>
					{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
				</div>
			)}
		</section>
	)
}

/**
 * The per-task model override.
 *
 * Inherits the session model by default; the select exists because the right
 * model for chat and for a given job are often different. For 3D optimization
 * the recommended set is the user's own list, matched against what the backend
 * actually reports and shown first — a highlight, never a gate.
 */
function TaskModelPicker({
	task,
	disabled,
	recommendedNote,
}: {
	task: "mark" | "model3d"
	disabled?: boolean
	recommendedNote?: boolean
}) {
	const [models, setModels] = useState<TaskModelWire[]>([])
	const [value, setValue] = useState("")

	useEffect(() => {
		void invoke("generate:taskModels", task).then((list) => setModels(list ?? []))
		void invoke("prefs:get").then((prefs) => {
			const lanes = (prefs?.laneModels ?? {}) as Record<string, string | undefined>
			setValue(lanes[task] ?? "")
		})
	}, [task])

	const recommended = models.filter((model) => model.recommended)
	const rest = models.filter((model) => !model.recommended)

	return (
		<label className="mt-3 block text-xs text-shell-muted">
			Model for this job
			<select
				className="mt-1 block w-full rounded-md border border-shell-border bg-shell-panel px-2 py-1.5 text-xs outline-none"
				data-testid={`task-model-${task}`}
				disabled={disabled}
				onChange={(event) => {
					setValue(event.target.value)
					void invoke("generate:setTaskModel", task, event.target.value)
				}}
				value={value}>
				<option value="">Same as the chat</option>
				{recommended.length > 0 && (
					<optgroup label="Recommended for this task">
						{recommended.map((model) => (
							<option key={model.id} value={model.id}>
								{model.label}
								{model.free ? " · no cost" : ""}
							</option>
						))}
					</optgroup>
				)}
				{rest.length > 0 && (
					<optgroup label={recommended.length > 0 ? "Everything else" : "Models"}>
						{rest.map((model) => (
							<option key={model.id} value={model.id}>
								{model.label}
								{model.free ? " · no cost" : ""}
							</option>
						))}
					</optgroup>
				)}
			</select>
			{recommendedNote && recommended.length === 0 && models.length > 0 && (
				<span className="mt-1 block">
					None of the recommended optimizers (Fable 5, GPT 5.6 Sol, Kimi K3, GLM 5.2, DeepSeek V4 Flash) are on this
					backend — any model works, those are just better at it.
				</span>
			)}
		</label>
	)
}

function suggestMarkTag(subject: string): string {
	const slug = subject
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32)
		.replace(/-+$/g, "")
	return slug || "mark"
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

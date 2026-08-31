/**
 * Generating an asset: say what you want, answer what Caret still needs, pick one.
 *
 * **This screen used to have no way of saying what the thing was.** It asked two
 * questions — what is it for, how loud should it be — narrowed a library of
 * fourteen pre-written prompt blocks, and each block carried its own hardcoded
 * subject. Six objects existed. Ask for a paperclip and a ceramic vase came
 * back, because the subject was an array indexed by variant.
 *
 * The rule it was built to said the user is never handed a prompt box, and that
 * rule overshot a correct argument. The argument is about **style**: nobody
 * should be made to describe lighting, framing or mood to get an image, because
 * that hands the taste problem straight back to the person who does not have it,
 * and the words people reach for when cornered — cinematic, 8k, hyperdetailed —
 * are precisely what makes generated imagery legible as generated.
 *
 * But *what object is it* was never a taste question. It is a content question,
 * and the user is the only party who can answer it. Opening this screen means
 * already having something in mind. So they say it, Caret asks only what it
 * genuinely still needs, and every decision about how the thing looks is still
 * composed from the project's foundation. The mark lane below already worked
 * this way and its comment says so; the image lane simply never did.
 *
 * Everything shown here is rendered against **this project's own foundation**.
 * A picker showing stock previews would be arguing against the library's only
 * real claim.
 */
import { useCallback, useEffect, useState } from "react"

import type {
	AssetEntryWire,
	AssetRequestWire,
	ClarifyQuestionWire,
	GeneratedVariantWire,
	GenerateProgressWire,
	GenerationKindWire,
	MarkOutcomeWire,
	Model3dOutcomeWire,
	ProjectState,
	RecipeCardWire,
	ShaderOutcomeWire,
	TaskModelWire,
} from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"

type Stage = "ask" | "clarify" | "recipe" | "variant" | "name" | "mark" | "model3d" | "shader"

/** The things this screen makes. Picked, never guessed from prose. */
const KINDS: Array<{ id: GenerationKindWire; label: string; hint: string }> = [
	{ id: "image", label: "A photograph or image", hint: "For a hero, a card, or anywhere a picture goes." },
	{ id: "texture", label: "A texture or pattern", hint: "Grain, a wash, a halftone. Free, instant, and tunable after." },
	{ id: "mark", label: "A logo or mark", hint: "Drawn as vector, rendered, corrected against its own render." },
	{ id: "object3d", label: "A 3D object", hint: "Built from an image, then optimized so it does not weigh the page down." },
	{
		id: "shader",
		label: "An animated background",
		hint: "A living gradient, written as code — colours and motion stay tunable.",
	},
]

/** Ratios the image lane composes for. */
const IMAGE_ASPECTS = ["3:2", "16:9", "1:1", "4:5", "21:9", "9:16"]

export function GenerateAsset({ project, onClose }: { project: ProjectState; onClose(saved: string | null): void }) {
	const [stage, setStage] = useState<Stage>("ask")
	const [kind, setKind] = useState<GenerationKindWire>("image")
	const [text, setText] = useState("")
	const [transparent, setTransparent] = useState(false)

	const [questions, setQuestions] = useState<ClarifyQuestionWire[]>([])
	const [replies, setReplies] = useState<Record<string, string>>({})

	const [recipes, setRecipes] = useState<RecipeCardWire[]>([])
	const [recipe, setRecipe] = useState<RecipeCardWire | null>(null)
	const [aspect, setAspect] = useState<string>(IMAGE_ASPECTS[0])
	const [variants, setVariants] = useState<GeneratedVariantWire[]>([])
	const [chosen, setChosen] = useState<number | null>(null)
	const [tag, setTag] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const request = useCallback(
		(answers?: Record<string, string>): AssetRequestWire => ({
			kind,
			text: text.trim(),
			...(kind === "image" && transparent ? { transparent: true } : {}),
			...(answers && Object.keys(answers).length > 0 ? { answers } : {}),
		}),
		[kind, text, transparent],
	)

	const runTakes = useCallback(
		async (ratio: string, answers: Record<string, string>) => {
			// The shader lane rides the same ask → clarify road, then runs its own
			// loop: one authored result to watch, not three takes to pick from.
			if (kind === "shader") {
				setReplies(answers)
				setStage("shader")
				return
			}
			setAspect(ratio)
			setChosen(null)
			setVariants([])
			setBusy(true)
			setStage("variant")
			try {
				setVariants((await invoke("generate:takes", project.path, { ...request(answers) }, ratio)) ?? [])
			} finally {
				setBusy(false)
			}
		},
		[project.path, request, kind],
	)

	/**
	 * What happens when the user has said their piece.
	 *
	 * Marks and 3D objects run their own lanes — one result, minutes of waiting,
	 * their own progress to watch — so they branch here rather than pretending to
	 * be a three-take pick. Textures have no subject to name, so they keep the
	 * recipe cards, where sliders beat a sentence.
	 */
	const begin = useCallback(async () => {
		if (!text.trim()) return
		setError(null)

		if (kind === "mark") return setStage("mark")
		if (kind === "object3d") return setStage("model3d")

		if (kind === "texture") {
			setBusy(true)
			try {
				setRecipes((await invoke("generate:recipes", project.path, {}, "texture")) ?? [])
				setStage("recipe")
			} finally {
				setBusy(false)
			}
			return
		}

		setBusy(true)
		try {
			const result = await invoke("generate:clarify", project.path, request())
			if (result && !result.sufficient && result.questions.length > 0) {
				setQuestions(result.questions)
				setReplies({})
				setStage("clarify")
				setBusy(false)
				return
			}
		} catch {
			// A clarifier that cannot answer must not stop someone generating.
		}
		setBusy(false)
		await runTakes(aspect, {})
	}, [kind, text, project.path, request, runTakes, aspect])

	const chooseRecipe = useCallback(
		async (card: RecipeCardWire, withAspect?: string) => {
			if (card.unavailable) return
			const ratio = withAspect ?? card.aspects[0]
			setRecipe(card)
			setAspect(ratio)
			setChosen(null)
			setVariants([])
			setBusy(true)
			setStage("variant")
			try {
				setVariants((await invoke("generate:variants", project.path, card.id, {}, ratio, 8)) ?? [])
			} finally {
				setBusy(false)
			}
		},
		[project.path],
	)

	const save = useCallback(async () => {
		if (chosen === null) return
		setBusy(true)
		setError(null)
		try {
			const result =
				kind === "texture" && recipe
					? await invoke("generate:accept", project.path, recipe.id, {}, aspect, chosen, tag)
					: await invoke("generate:acceptTake", project.path, request(replies), aspect, chosen, tag)
			if (result?.ok) onClose(result.tag ?? tag)
			else setError(result?.error ?? "Could not save that.")
		} finally {
			setBusy(false)
		}
	}, [chosen, kind, recipe, project.path, aspect, tag, request, replies, onClose])

	const aspects = kind === "texture" && recipe ? recipe.aspects : IMAGE_ASPECTS
	const regenerate = () => (kind === "texture" && recipe ? chooseRecipe(recipe, aspect) : runTakes(aspect, replies))

	return (
		<div className="absolute inset-0 z-40 flex flex-col bg-shell-bg" data-testid="generate-asset">
			<header className="flex items-center justify-between border-b border-shell-border px-8 py-4">
				<div>
					<h1 className="text-lg font-semibold">Generate an asset</h1>
					<p className="text-sm text-shell-muted">
						{stage === "ask"
							? "Say what you want. Caret will ask if it needs anything more."
							: stage === "clarify"
								? "A couple of things that would make this better."
								: stage === "recipe"
									? "Every one of these is built from your project's own colours."
									: stage === "variant"
										? "Three takes of the same thing. Point at the one you like."
										: stage === "mark"
											? "The model draws it, sees its own render, and corrects — three rounds."
											: stage === "model3d"
												? "Built from an image in your library, then optimized to a page-friendly weight."
												: stage === "shader"
													? "The model writes it as code, compiles it, and corrects against its own frames."
													: "Give it a name you would type."}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{stage !== "ask" && (
						<button
							className="rounded-md border border-shell-border px-3 py-1.5 text-sm"
							data-testid="generate-back"
							onClick={() => {
								if (stage === "name") setStage("variant")
								else if (stage === "variant") setStage(kind === "texture" ? "recipe" : "ask")
								else setStage("ask")
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
				{stage === "ask" && (
					<section className="mx-auto max-w-2xl" data-testid="generate-ask">
						<h2 className="text-xl font-semibold">What are you making?</h2>
						<div className="mt-4 grid grid-cols-2 gap-2">
							{KINDS.map((option) => (
								<button
									className={cn(
										"rounded-lg border p-3 text-left",
										kind === option.id
											? "border-caret-accent"
											: "border-shell-border hover:border-caret-accent",
									)}
									data-generate-kind={option.id}
									key={option.id}
									onClick={() => setKind(option.id)}
									type="button">
									<span className="block text-sm font-medium">{option.label}</span>
									<span className="mt-0.5 block text-xs text-shell-muted">{option.hint}</span>
								</button>
							))}
						</div>

						<label className="mt-8 block text-sm font-medium" htmlFor="generate-request">
							{kind === "texture" ? "What is it for?" : "What is it?"}
						</label>
						<p className="mt-1 text-xs text-shell-muted">
							In your own words. Say as much or as little as you like — Caret decides how it is lit, framed and
							coloured from your foundation.
						</p>
						<textarea
							className="mt-2 w-full resize-none rounded-md border border-shell-border bg-transparent px-3 py-2 text-sm outline-none focus:border-caret-accent"
							data-testid="generate-request"
							id="generate-request"
							onChange={(event) => setText(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void begin()
							}}
							placeholder={
								kind === "mark"
									? "a broken ring of twelve dashes"
									: kind === "object3d"
										? "a ceramic mug with a simple silhouette"
										: "a stainless steel ruler and a yellow pencil"
							}
							rows={3}
							value={text}
						/>

						{kind === "image" && (
							<label className="mt-4 flex items-center gap-2 text-sm">
								<input
									checked={transparent}
									data-testid="generate-transparent"
									onChange={(event) => setTransparent(event.target.checked)}
									type="checkbox"
								/>
								<span>
									No background
									<span className="ml-2 text-xs text-shell-muted">
										Cut out clean, so it sits on any surface.
									</span>
								</span>
							</label>
						)}

						<button
							className="mt-6 rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
							data-testid="generate-begin"
							disabled={busy || !text.trim()}
							onClick={begin}
							type="button">
							{busy ? "Thinking…" : "Continue"}
						</button>
					</section>
				)}

				{stage === "clarify" && (
					<section className="mx-auto max-w-2xl" data-testid="generate-clarify">
						<p className="text-sm text-shell-muted">
							You asked for <span className="text-shell-fg">{text.trim()}</span>.
						</p>
						<div className="mt-6 flex flex-col gap-6">
							{questions.map((question) => (
								<div data-generate-clarify={question.id} key={question.id}>
									<h3 className="text-base font-medium">{question.question}</h3>
									<p className="mt-0.5 text-xs text-shell-muted">{question.why}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{question.suggestions.map((suggestion) => (
											<button
												className={cn(
													"rounded-md border px-2 py-1 text-xs",
													replies[question.id] === suggestion
														? "border-caret-accent text-caret-accent"
														: "border-shell-border",
												)}
												key={suggestion}
												onClick={() => setReplies({ ...replies, [question.id]: suggestion })}
												type="button">
												{suggestion}
											</button>
										))}
									</div>
									{/* Suggestions are fast paths, never the whole answer. */}
									<input
										className="mt-2 w-full rounded-md border border-shell-border bg-transparent px-3 py-2 text-sm outline-none"
										data-generate-clarify-input={question.id}
										onChange={(event) => setReplies({ ...replies, [question.id]: event.target.value })}
										placeholder="or say it yourself"
										value={replies[question.id] ?? ""}
									/>
								</div>
							))}
						</div>
						<div className="mt-8 flex items-center gap-3">
							<button
								className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
								data-testid="generate-clarify-done"
								disabled={busy}
								onClick={() => runTakes(aspect, replies)}
								type="button">
								Generate
							</button>
							{/* Answering is optional. Nothing here is a gate. */}
							<button
								className="text-xs text-shell-muted hover:text-shell-fg"
								data-testid="generate-clarify-skip"
								disabled={busy}
								onClick={() => runTakes(aspect, {})}
								type="button">
								Skip — just make it
							</button>
						</div>
					</section>
				)}

				{stage === "recipe" && (
					<section className="mx-auto max-w-4xl" data-testid="generate-recipes">
						{recipes.length === 0 ? (
							<p className="text-sm text-shell-muted">Nothing in the library fits that yet.</p>
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
										 * dark shell they showed nothing at all.
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

				{stage === "variant" && (
					<section className="mx-auto max-w-4xl" data-testid="generate-variants">
						<div className="mb-4 flex items-center gap-2">
							<span className="text-xs text-shell-muted">Proportions</span>
							{aspects.map((option) => (
								<button
									className={cn(
										"rounded-md border px-2 py-1 text-xs",
										option === aspect ? "border-caret-accent text-caret-accent" : "border-shell-border",
									)}
									data-generate-aspect={option}
									disabled={busy}
									key={option}
									onClick={() =>
										kind === "texture" && recipe ? chooseRecipe(recipe, option) : runTakes(option, replies)
									}
									type="button">
									{option}
								</button>
							))}
						</div>

						{busy && (
							<p className="mb-3 text-xs text-shell-muted" data-testid="generate-working">
								{kind === "texture"
									? "Composing…"
									: "Generating three takes on your own key. About fifteen seconds each, running together."}
							</p>
						)}

						<div className={cn("grid gap-3", variants.length > 4 ? "grid-cols-4" : "grid-cols-2")}>
							{variants.map((variant) =>
								variant.error ? (
									// The lane's own words, per take. A content refusal on one
									// framing says nothing about the other two, and collapsing
									// them into one message would throw away good images to
									// report a bad one.
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
											setTag(suggestTag(text))
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
							onClick={regenerate}
							type="button">
							None of these — try again
						</button>
					</section>
				)}

				{stage === "name" && chosen !== null && (
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

				{stage === "mark" && <MarkFlow onClose={onClose} project={project} subject={text.trim()} />}
				{stage === "model3d" && <Model3dFlow onClose={onClose} project={project} />}
				{stage === "shader" && <ShaderFlow answers={replies} onClose={onClose} project={project} subject={text.trim()} />}
			</div>
		</div>
	)
}

/** A tag from the user's own words, so the field opens with something usable. */
function suggestTag(text: string): string {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.split(/\s+/)
		.filter((word) => word && !["a", "an", "the", "of", "and", "with", "on"].includes(word))
	return words.slice(0, 3).join("-") || "asset"
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
function MarkFlow({
	project,
	onClose,
	subject: initialSubject = "",
}: {
	project: ProjectState
	onClose(saved: string | null): void
	/** What the user already said on the ask screen. Asking again would be asking twice. */
	subject?: string
}) {
	const [subject, setSubject] = useState(initialSubject)
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
 * The shader lane's flow: watch the model write, compile and correct, then
 * keep or don't.
 *
 * The subject and the clarify answers arrive from the ask road — asking again
 * would be asking twice. What accepting produces is TWO things and the copy
 * says so: a live component in the project, and a poster in the assets. The
 * preview strip is three stills at fixed timestamps; the motion itself is
 * judged where it will actually live, on the page.
 */
function ShaderFlow({
	project,
	onClose,
	subject,
	answers,
}: {
	project: ProjectState
	onClose(saved: string | null): void
	subject: string
	answers: Record<string, string>
}) {
	const [busy, setBusy] = useState(false)
	const [progress, setProgress] = useState("")
	const [rounds, setRounds] = useState<Array<{ round: number; preview: string }>>([])
	const [outcome, setOutcome] = useState<ShaderOutcomeWire | null>(null)
	const [tag, setTag] = useState("")
	const [error, setError] = useState<string | null>(null)

	useEffect(
		() =>
			on("generate:progress", (path, update: GenerateProgressWire) => {
				if (path !== project.path || update.job !== "shader") return
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
			const result = await invoke("generate:shader", project.path, {
				kind: "shader",
				text: subject,
				...(Object.keys(answers).length > 0 ? { answers } : {}),
			})
			setOutcome(result ?? null)
			if (result?.ok) setTag(suggestTag(subject))
		} finally {
			setBusy(false)
			setProgress("")
		}
	}

	const accept = async () => {
		setBusy(true)
		try {
			const result = await invoke("generate:shaderAccept", project.path, tag)
			if (result?.ok) onClose(result.tag ?? tag)
			else setError(result?.error ?? "Could not save that.")
		} finally {
			setBusy(false)
		}
	}

	return (
		<section className="mx-auto max-w-2xl" data-testid="generate-shader">
			<p className="text-sm text-shell-muted">
				Writing an animated background for: <span className="text-shell-fg">{subject}</span>
			</p>

			<div className="mt-3 flex items-center gap-3">
				<button
					className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
					data-testid="shader-generate"
					disabled={busy || !subject.trim()}
					onClick={generate}
					type="button">
					{outcome ? "Write another" : "Write it"}
				</button>
			</div>

			<TaskModelPicker disabled={busy} task="shader" />

			{busy && (
				<p className="mt-4 text-xs text-shell-muted" data-testid="shader-progress">
					{progress || "Starting…"}
				</p>
			)}

			{rounds.length > 0 && !outcome?.ok && (
				<div className="mt-4 grid grid-cols-3 gap-3" data-testid="shader-rounds">
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
				<div className="mt-5" data-testid="shader-result">
					<p className="mb-2 text-xs text-shell-muted">
						Moments from the animation — {outcome.rounds} round(s) on {outcome.model}.
					</p>
					<div className="grid grid-cols-3 gap-3" data-testid="shader-frames">
						{(outcome.frames ?? []).map((frame, index) => (
							<img
								alt=""
								className="w-full rounded-lg border border-shell-border"
								key={frame.slice(-24)}
								src={frame}
							/>
						))}
					</div>
					{(outcome.knobs?.length ?? 0) > 0 && (
						<p className="mt-3 text-xs text-shell-muted" data-testid="shader-knobs">
							Tunable after: {outcome.knobs!.map((knob) => knob.label).join(" · ")}
						</p>
					)}
					<label className="mt-4 block text-sm" htmlFor="shader-tag">
						What should it be called? <code className="text-xs text-shell-muted">@{tag || "name"}</code>
					</label>
					<p className="mt-1 text-xs text-shell-muted">
						Saving adds a live component to your project and a poster still to your assets.
					</p>
					<div className="mt-2 flex gap-2">
						<input
							className="min-w-0 flex-1 rounded-md border border-shell-border bg-transparent px-3 py-2 font-mono text-sm outline-none"
							data-testid="shader-tag"
							id="shader-tag"
							onChange={(event) => setTag(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && accept()}
							value={tag}
						/>
						<button
							className="rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
							data-testid="shader-save"
							disabled={busy}
							onClick={accept}
							type="button">
							Add to project
						</button>
					</div>
					{error && <p className="mt-2 text-xs text-red-400">{error}</p>}
				</div>
			)}
		</section>
	)
}

/**
 * The 3D lane's flow: say what the object is, pick a take, wait honestly.
 *
 * The prompt leads because that is the lane's shape — one description in,
 * a model out, with the source image made on the way. The library grid is
 * the alternative path for when the exact object already exists as an image
 * (uploaded or generated, both are assets by now, so one grid covers both).
 * The result screen shows numbers rather than a rendered mesh, because the
 * chrome has no 3D thumbnail yet (BACKLOG) and a fake preview would be worse
 * than an honest absence.
 */
function Model3dFlow({ project, onClose }: { project: ProjectState; onClose(saved: string | null): void }) {
	const [assets, setAssets] = useState<AssetEntryWire[]>([])
	const [source, setSource] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [progress, setProgress] = useState<{ stage: string; detail?: string } | null>(null)
	const [outcome, setOutcome] = useState<Model3dOutcomeWire | null>(null)
	const [tag, setTag] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [sourceOptions, setSourceOptions] = useState<GeneratedVariantWire[] | null>(null)
	const [sourceBusy, setSourceBusy] = useState(false)
	const [sourceText, setSourceText] = useState("")

	const refreshAssets = useCallback(async () => {
		const list = await invoke("assets:list", project.path)
		setAssets((list ?? []).filter((asset) => asset.kind === "image"))
	}, [project.path])

	useEffect(() => {
		void refreshAssets()
	}, [refreshAssets])

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

	/**
	 * The purpose-made source, from the user's own words.
	 *
	 * Reconstruction wants the opposite of a hero shot — one object, centered,
	 * fully in frame, even light — and the cutout request lane already composes
	 * exactly that around whatever subject is typed here. The subject is the
	 * user's; the styling is Caret's. (The first version of this button ran the
	 * object-study recipe with no input at all — the six-things trap: nothing
	 * anywhere let the user say what the object *was*.)
	 */
	const sourceRequest = (): AssetRequestWire => ({ kind: "image", text: sourceText.trim(), transparent: true })

	const generateSources = async () => {
		setSourceBusy(true)
		setSourceOptions(null)
		try {
			setSourceOptions((await invoke("generate:takes", project.path, sourceRequest(), "")) ?? [])
		} finally {
			setSourceBusy(false)
		}
	}

	const pickSource = async (variant: number) => {
		setSourceBusy(true)
		try {
			const result = await invoke("generate:acceptTake", project.path, sourceRequest(), "", variant, "")
			if (result?.ok && result.tag) {
				await refreshAssets()
				setSource(result.tag)
				setSourceOptions(null)
			} else {
				setError(result?.error ?? "Could not save the source image.")
			}
		} finally {
			setSourceBusy(false)
		}
	}

	return (
		<section className="mx-auto max-w-3xl" data-testid="generate-model3d">
			<p className="mb-2 text-sm">What should the object be?</p>
			<div className="flex gap-2">
				<input
					className="flex-1 rounded-md border border-shell-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-caret-accent"
					data-testid="model3d-source-text"
					disabled={busy || sourceBusy}
					onChange={(event) => setSourceText(event.target.value)}
					placeholder='One object, in plain words: "a squat glass hot sauce bottle with a black cap"'
					value={sourceText}
				/>
				<button
					className="rounded-md border border-shell-border px-3 py-1.5 text-xs disabled:opacity-50"
					data-testid="model3d-generate-source"
					disabled={busy || sourceBusy || sourceText.trim().length < 2}
					onClick={generateSources}
					type="button">
					{sourceBusy ? "Generating…" : "Generate the source"}
				</button>
			</div>
			<p className="mt-1.5 text-[11px] text-shell-muted">
				Caret photographs it as a cutout — one object, even light, no background, what reconstruction wants — and the take
				you pick becomes the model's source.
			</p>

			{sourceOptions && (
				<div className="mt-3 grid grid-cols-4 gap-3" data-testid="model3d-source-options">
					{sourceOptions.map((option) =>
						option.error ? (
							<p
								className="rounded-lg border border-amber-500/40 p-2 text-[11px] text-shell-muted"
								key={option.variant}>
								{option.error}
							</p>
						) : (
							<button
								className="overflow-hidden rounded-lg border border-shell-border hover:border-caret-accent"
								data-model3d-source-option={option.variant}
								disabled={sourceBusy}
								key={option.variant}
								onClick={() => pickSource(option.variant)}
								type="button">
								<span className="block" style={{ backgroundColor: option.surface }}>
									<img alt="" className="block w-full" src={option.preview} />
								</span>
							</button>
						),
					)}
				</div>
			)}

			{assets.length > 0 && (
				<>
					<p className="mt-5 mb-2 text-sm">…or build from an image already in the library:</p>
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
				</>
			)}

			<TaskModelPicker disabled={busy} recommendedNote task="model3d" />

			<button
				className="mt-4 rounded-md bg-caret-accent px-4 py-2 text-sm text-white disabled:opacity-50"
				data-testid="model3d-generate"
				disabled={busy || !source}
				onClick={generate}
				type="button">
				Build the model
			</button>

			{busy && progress && (
				<p className="mt-4 text-xs text-shell-muted" data-testid="model3d-progress">
					{progress.stage}
					{progress.detail ? ` — ${progress.detail}` : ""}
				</p>
			)}

			{outcome && !outcome.ok && (
				<p
					className="mt-4 rounded-lg border border-amber-500/40 p-3 text-xs text-shell-muted"
					data-testid="model3d-error">
					{outcome.reason}
				</p>
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
	task: "mark" | "model3d" | "shader"
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

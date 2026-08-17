/**
 * The token wizard, as the user meets it.
 *
 * The model decides what to ask; this file decides what a question is allowed
 * to look like. One real component per widget kind — specimens for typefaces,
 * swatches with a genuine picker behind them for colour, a morphing preview for
 * density — so the model's freedom over content never becomes freedom over the
 * screen.
 *
 * Held to the same rules as every foundation surface:
 *
 * - **No design vocabulary.** Numbers, ratios and hex values stay behind the
 *   pictures (the hex field is the one deliberate exception — it is how a user
 *   brings their own colour in).
 * - **Specimens over labels.** If an option can be shown as the thing it would
 *   produce, it is.
 * - **The recommendation is preselected.** Pressing straight through a whole
 *   interview must land on a foundation the model would defend.
 * - **Escape hatches are the user's.** "None of these" opens a colour picker,
 *   a font search, or a free input — never another lecture.
 */
import { ArrowLeft, Check, Loader2, Pipette, Plus, Search, Sparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type {
	WizardAnswerWire,
	WizardOptionWire,
	WizardQAWire,
	WizardQuestionWire,
	WizardSpecWire,
	WizardStateWire,
} from "../../../shared/ipc"
import { invoke } from "../ipc"
import { cn } from "../lib/utils"

interface Props {
	projectPath: string
	onCommitted(name: string): void
	onSwitchToPresets(): void
	onSwitchToManual(): void
}

export function WizardView({ projectPath, onCommitted, onSwitchToPresets, onSwitchToManual }: Props) {
	const [state, setState] = useState<WizardStateWire | null>(null)
	const [busy, setBusy] = useState(true)

	useEffect(() => {
		let cancelled = false
		void invoke("wizard:resume", projectPath)
			.then((resumed) => !cancelled && setState(resumed ?? { phase: "describe", description: "" }))
			.finally(() => !cancelled && setBusy(false))
		return () => {
			cancelled = true
		}
	}, [projectPath])

	async function transition(run: () => Promise<WizardStateWire>): Promise<void> {
		setBusy(true)
		try {
			setState(await run())
		} catch (err) {
			setState((previous) => ({
				phase: "error",
				description: previous && "description" in previous ? previous.description : "",
				message: err instanceof Error ? err.message : String(err),
				canFinish: false,
			}))
		} finally {
			setBusy(false)
		}
	}

	if (!state) return <Centered>{busy ? "Loading…" : "Something went wrong."}</Centered>

	return (
		<div className="flex-1 overflow-auto bg-shell-bg" data-testid="wizard">
			<div className="mx-auto flex max-w-5xl gap-8 px-8 py-10">
				<div className="min-w-0 flex-1">
					{state.phase === "describe" && (
						<Describe
							busy={busy}
							initial={state.description}
							onSubmit={(description) => transition(() => invoke("wizard:start", projectPath, description))}
						/>
					)}

					{state.phase === "needs-backend" && (
						<NeedsBackend detail={state.detail} onManual={onSwitchToManual} onPresets={onSwitchToPresets} />
					)}

					{state.phase === "question" && busy && <Thinking asked={state.asked} />}
					{state.phase === "question" && !busy && (
						<Question
							key={state.current.id}
							onAnswer={(answer) => transition(() => invoke("wizard:answer", projectPath, answer))}
							onBack={state.asked > 0 ? () => transition(() => invoke("wizard:back", projectPath)) : undefined}
							onFinishNow={
								state.asked >= 1 ? () => transition(() => invoke("wizard:finishNow", projectPath)) : undefined
							}
							state={state}
						/>
					)}

					{state.phase === "finish" && (
						<Finish
							busy={busy}
							onBack={() => transition(() => invoke("wizard:back", projectPath))}
							onCommit={() =>
								transition(async () => {
									const result = await invoke("wizard:commit", projectPath)
									onCommitted(result.name)
									return { phase: "describe", description: "" }
								})
							}
							state={state}
						/>
					)}

					{state.phase === "error" && (
						<ErrorScreen
							busy={busy}
							canFinish={state.canFinish}
							message={state.message}
							onFinishNow={() => transition(() => invoke("wizard:finishNow", projectPath))}
							onPresets={onSwitchToPresets}
							onRetry={() => transition(() => invoke("wizard:retry", projectPath))}
						/>
					)}
				</div>

				{(state.phase === "question" || state.phase === "finish") && (
					<SoFar history={state.history} proposalSpec={state.phase === "finish" ? proposalSpec(state) : undefined} />
				)}
			</div>
		</div>
	)
}

function Centered({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-1 items-center justify-center bg-shell-bg text-shell-muted">{children}</div>
}

// ── screens ─────────────────────────────────────────────────────────────────

function Describe({ initial, busy, onSubmit }: { initial: string; busy: boolean; onSubmit(description: string): void }) {
	const [text, setText] = useState(initial)
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => ref.current?.focus(), [])
	const ready = text.trim().length >= 8

	return (
		<div className="fade-in">
			<h1 className="text-2xl font-medium">Describe what you're building.</h1>
			<p className="mt-2 max-w-xl leading-relaxed text-shell-muted">
				What it is, who it's for, anything you already know you want. The interview is built from this — the better the
				description, the fewer the questions.
			</p>

			<textarea
				className="mt-6 min-h-28 w-full resize-none rounded-xl border border-shell-border bg-shell-panel px-4 py-3 leading-relaxed outline-none transition-colors focus:border-caret-accent/60"
				data-testid="wizard-describe"
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && ready) {
						event.preventDefault()
						onSubmit(text)
					}
				}}
				placeholder="A dashboard where support teams triage tickets all day. Dark, calm, serious."
				ref={ref}
				value={text}
			/>

			<button
				className="mt-4 flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
				data-testid="wizard-begin"
				disabled={!ready || busy}
				onClick={() => onSubmit(text)}
				type="button">
				{busy && <Loader2 className="animate-spin" size={13} />}
				Start
			</button>
		</div>
	)
}

function NeedsBackend({ detail, onPresets, onManual }: { detail: string; onPresets(): void; onManual(): void }) {
	return (
		<div className="fade-in" data-testid="wizard-needs-backend">
			<h1 className="text-2xl font-medium">The interview needs a coding backend.</h1>
			<p className="mt-2 max-w-xl leading-relaxed text-shell-muted">
				A model runs this conversation — it reads your description and decides what to ask. {detail}
			</p>
			<div className="mt-5 flex items-center gap-2">
				<button
					className="rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover"
					onClick={onPresets}
					type="button">
					Pick from presets instead
				</button>
				<button
					className="rounded-lg px-3 py-2 text-shell-muted transition-colors hover:bg-white/5"
					onClick={onManual}
					type="button">
					Set tokens by hand
				</button>
			</div>
		</div>
	)
}

function Thinking({ asked }: { asked: number }) {
	return (
		<div className="fade-in flex items-center gap-3 py-16 text-shell-muted" data-testid="wizard-thinking">
			<Loader2 className="animate-spin text-caret-accent" size={15} />
			{asked === 0 ? "Reading your description and deciding what to ask…" : "Choosing what to ask next…"}
		</div>
	)
}

function Question({
	state,
	onAnswer,
	onBack,
	onFinishNow,
	baseOverride,
}: {
	state: Extract<WizardStateWire, { phase: "question" }>
	onAnswer(answer: WizardAnswerWire): void
	onBack?: () => void
	onFinishNow?: () => void
	/** Preview harness only — stands in for a real answer history. */
	baseOverride?: WizardSpecWire
}) {
	const question = state.current
	const derived = useMemo(() => specFromHistory(state.history), [state.history])
	const base = baseOverride ?? derived

	// Each widget reports its current pick up here, so the footer owns one
	// Continue button and every widget stays a pure surface.
	const [pick, setPick] = useState<Pick | null>(null)

	const answer = (partial: Omit<WizardAnswerWire, "questionId" | "question" | "kind">) =>
		onAnswer({ questionId: question.id, question: question.question, kind: question.kind, ...partial })

	return (
		<div className="fade-in" data-testid="wizard-question">
			<div className="flex items-center justify-between">
				<p className="text-[11px] tracking-wider text-shell-muted uppercase">Question {state.asked + 1}</p>
				{onBack && (
					<button
						className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
						data-testid="wizard-back"
						onClick={onBack}
						type="button">
						<ArrowLeft size={12} />
						Back
					</button>
				)}
			</div>

			<h1 className="mt-3 text-2xl font-medium">{question.question}</h1>
			{question.why && <p className="mt-1.5 max-w-2xl leading-relaxed text-shell-muted">{question.why}</p>}

			<div className="mt-6">
				<Widget base={base} onPick={setPick} question={question} />
			</div>

			<div className="mt-7 flex items-center gap-2">
				<button
					className="flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
					data-testid="wizard-continue"
					disabled={!pick}
					onClick={() => pick && answer(pick.answer)}
					type="button">
					Continue
				</button>
				<button
					className="rounded-lg px-3 py-2 text-shell-muted transition-colors hover:bg-white/5"
					data-testid="wizard-skip"
					onClick={() => answer({ value: "", skipped: true })}
					type="button">
					You decide
				</button>
				{onFinishNow && (
					<button
						className="ml-auto rounded-lg px-3 py-2 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5"
						data-testid="wizard-finish-now"
						onClick={onFinishNow}
						title="Stop answering — build the foundation from what you've said so far"
						type="button">
						Just finish it
					</button>
				)}
			</div>
		</div>
	)
}

function ErrorScreen({
	message,
	canFinish,
	busy,
	onRetry,
	onFinishNow,
	onPresets,
}: {
	message: string
	canFinish: boolean
	busy: boolean
	onRetry(): void
	onFinishNow(): void
	onPresets(): void
}) {
	return (
		<div className="fade-in" data-testid="wizard-error">
			<h1 className="text-2xl font-medium">That didn't work.</h1>
			<p className="mt-2 max-w-xl leading-relaxed break-words text-shell-muted">{message}</p>
			<div className="mt-5 flex items-center gap-2">
				<button
					className="flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
					disabled={busy}
					onClick={onRetry}
					type="button">
					{busy && <Loader2 className="animate-spin" size={13} />}
					Try again
				</button>
				{canFinish && (
					<button
						className="rounded-lg px-3 py-2 text-shell-muted transition-colors hover:bg-white/5"
						disabled={busy}
						onClick={onFinishNow}
						type="button">
						Finish with what I've answered
					</button>
				)}
				<button
					className="rounded-lg px-3 py-2 text-shell-muted transition-colors hover:bg-white/5"
					onClick={onPresets}
					type="button">
					Use presets instead
				</button>
			</div>
		</div>
	)
}

function Finish({
	state,
	busy,
	onCommit,
	onBack,
}: {
	state: Extract<WizardStateWire, { phase: "finish" }>
	busy: boolean
	onCommit(): void
	onBack(): void
}) {
	const spec = proposalSpec(state)
	useFonts(familiesOf(spec))

	return (
		<div className="fade-in" data-testid="wizard-finish">
			<div className="flex items-center justify-between">
				<p className="text-[11px] tracking-wider text-shell-muted uppercase">Everything together</p>
				<button
					className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
					data-testid="wizard-back"
					disabled={busy}
					onClick={onBack}
					type="button">
					<ArrowLeft size={12} />
					Back
				</button>
			</div>

			<h1 className="mt-3 text-2xl font-medium">{state.name}</h1>
			{state.summary && <p className="mt-1.5 max-w-2xl leading-relaxed text-shell-muted">{state.summary}</p>}

			<div className="mt-6 overflow-hidden rounded-xl border border-shell-border">
				<Specimen spec={spec} tall />
			</div>

			<p className="mt-4 max-w-2xl border-l-2 border-shell-border pl-3 text-[12px] leading-relaxed text-shell-muted">
				{state.rule}
			</p>

			<button
				className="mt-7 flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
				data-testid="wizard-commit"
				disabled={busy}
				onClick={onCommit}
				type="button">
				{busy && <Loader2 className="animate-spin" size={13} />}
				Use these foundations
			</button>
		</div>
	)
}

/**
 * The question surface with a scripted payload — `scripts/preview-wizard.ts`
 * only. No IPC: taste has to be checkable without a model in the room.
 */
export function __PreviewQuestion({
	question,
	base,
	index,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	index: number
}) {
	return (
		<div className="max-w-3xl">
			<Question
				baseOverride={base}
				onAnswer={() => {}}
				onFinishNow={index > 0 ? () => {} : undefined}
				state={{ phase: "question", description: "", current: question, asked: index, cap: 10, history: [] }}
			/>
		</div>
	)
}

// ── the widgets ─────────────────────────────────────────────────────────────

/** What a widget reports upward: the answer it would submit, plus its reason. */
interface Pick {
	answer: Omit<WizardAnswerWire, "questionId" | "question" | "kind">
	reason?: string
}

/**
 * The model's reason for whatever is currently selected. Rendered by the
 * widget, directly under its cards — the one thing it must never sit below is
 * the escape hatch, which is about *leaving* these options.
 */
function Reason({ reason }: { reason?: string }) {
	if (!reason) return null
	return (
		<p className="mt-3 flex max-w-2xl items-start gap-2 leading-relaxed text-shell-muted" data-testid="wizard-reason">
			<Sparkles className="mt-1 shrink-0 text-caret-accent" size={12} />
			{reason}
		</p>
	)
}

function Widget({
	question,
	base,
	onPick,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	onPick(pick: Pick | null): void
}) {
	switch (question.kind) {
		case "options":
		case "boolean":
			return <OptionsWidget base={base} onPick={onPick} question={question} />
		case "color":
			return <ColorWidget base={base} onPick={onPick} question={question} />
		case "font":
			return <FontWidget base={base} onPick={onPick} question={question} />
		case "scale":
			return <ScaleWidget base={base} onPick={onPick} question={question} />
		case "chips":
			return <ChipsWidget onPick={onPick} question={question} />
		case "text":
			return <TextWidget onPick={onPick} question={question} />
		case "assumptions":
			return <AssumptionsWidget onPick={onPick} question={question} />
	}
}

function OptionsWidget({
	question,
	base,
	onPick,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	onPick(pick: Pick | null): void
}) {
	const options = question.options ?? []
	const [selected, setSelected] = useState(question.recommendedId ?? options[0]?.id ?? "")

	useFonts(options.flatMap((option) => familiesOf({ ...base, ...option.spec })))

	useEffect(() => {
		const option = options.find((candidate) => candidate.id === selected)
		if (option) onPick({ answer: { value: option.id, label: option.label }, reason: option.reason })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selected])

	const columns = options.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"

	return (
		<div>
			<div className={cn("grid gap-4", columns)}>
				{options.map((option) => (
					<OptionCard
						key={option.id}
						onSelect={() => setSelected(option.id)}
						option={option}
						recommended={option.id === question.recommendedId}
						selected={option.id === selected}>
						<Specimen spec={{ ...base, ...option.spec }} />
					</OptionCard>
				))}
			</div>
			<Reason reason={options.find((option) => option.id === selected)?.reason} />
		</div>
	)
}

function ColorWidget({
	question,
	base,
	onPick,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	onPick(pick: Pick | null): void
}) {
	const options = question.options ?? []
	const [selected, setSelected] = useState(question.recommendedId ?? options[0]?.id ?? "")
	const [custom, setCustom] = useState<string | null>(null)
	const [hexDraft, setHexDraft] = useState("")

	useFonts(familiesOf(base))

	useEffect(() => {
		if (custom) {
			onPick({ answer: { value: custom, label: "your own colour", wasOther: true } })
			return
		}
		const option = options.find((candidate) => candidate.id === selected)
		if (option?.hex) onPick({ answer: { value: option.hex, label: option.label }, reason: option.reason })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selected, custom])

	const applyHex = (value: string) => {
		const hex = normalizeHexInput(value)
		if (hex) setCustom(hex)
	}

	const active = custom ?? options.find((candidate) => candidate.id === selected)?.hex ?? "#888888"

	return (
		<div>
			<div className="grid gap-4 md:grid-cols-3">
				{options.map((option) => (
					<OptionCard
						key={option.id}
						onSelect={() => {
							setCustom(null)
							setSelected(option.id)
						}}
						option={option}
						recommended={option.id === question.recommendedId && !custom}
						selected={option.id === selected && !custom}>
						<Specimen spec={{ ...base, accent: option.hex }} />
					</OptionCard>
				))}
			</div>

			{!custom && <Reason reason={options.find((option) => option.id === selected)?.reason} />}

			{/* The escape hatch the interview was designed around: a real picker, a
			    hex field, and an eyedropper for "it's the colour of my logo". */}
			<div
				className={cn(
					"mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
					custom ? "border-caret-accent" : "border-shell-border",
				)}
				data-testid="wizard-color-other">
				<span className="text-[12px] text-shell-muted">None of these — use my colour:</span>

				<label className="relative inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-shell-border">
					<input
						className="absolute -inset-2 cursor-pointer opacity-0"
						onChange={(event) => setCustom(event.target.value)}
						type="color"
						value={active}
					/>
					<span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: active }} />
				</label>

				<input
					className="w-24 rounded-lg border border-shell-border bg-shell-panel px-2 py-1 font-mono text-[12px] outline-none focus:border-caret-accent/60"
					data-testid="wizard-hex"
					onBlur={() => hexDraft && applyHex(hexDraft)}
					onChange={(event) => setHexDraft(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && applyHex(hexDraft)}
					placeholder="#2563eb"
					value={hexDraft}
				/>

				{"EyeDropper" in window && (
					<button
						className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
						onClick={async () => {
							try {
								const dropper = new (
									window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }
								).EyeDropper()
								const result = await dropper.open()
								setCustom(result.sRGBHex)
							} catch {
								// Cancelled — nothing to do.
							}
						}}
						title="Pick a colour from anywhere on screen — your logo, a site you like"
						type="button">
						<Pipette size={12} />
						Pick from screen
					</button>
				)}

				{custom && (
					<span className="flex items-center gap-2 text-[12px]">
						<span className="inline-block size-4 rounded" style={{ background: custom }} />
						<span className="font-mono">{custom}</span>
					</span>
				)}
			</div>
		</div>
	)
}

function FontWidget({
	question,
	base,
	onPick,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	onPick(pick: Pick | null): void
}) {
	const options = question.options ?? []
	const [selected, setSelected] = useState(question.recommendedId ?? options[0]?.id ?? "")
	const [customFamily, setCustomFamily] = useState<string | null>(null)
	const [query, setQuery] = useState("")
	const [results, setResults] = useState<Array<{ family: string; category: string }>>([])

	useFonts([
		...options.flatMap((option) => familiesOf({ ...base, ...option.spec, displayFamily: option.label })),
		...(customFamily ? [customFamily] : []),
		...results.slice(0, 6).map((font) => font.family),
	])

	useEffect(() => {
		if (customFamily) {
			onPick({ answer: { value: customFamily, label: customFamily, wasOther: true } })
			return
		}
		const option = options.find((candidate) => candidate.id === selected)
		if (option) onPick({ answer: { value: option.label, label: option.label }, reason: option.reason })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selected, customFamily])

	// Debounced: the search endpoint may go to Google's API.
	useEffect(() => {
		if (query.trim().length < 2) {
			setResults([])
			return
		}
		const timer = setTimeout(() => {
			void invoke("fonts:search", query).then((fonts) => setResults(fonts.slice(0, 6)))
		}, 250)
		return () => clearTimeout(timer)
	}, [query])

	return (
		<div>
			<div className="grid gap-4 md:grid-cols-3">
				{options.map((option) => (
					<OptionCard
						key={option.id}
						onSelect={() => {
							setCustomFamily(null)
							setSelected(option.id)
						}}
						option={option}
						recommended={option.id === question.recommendedId && !customFamily}
						selected={option.id === selected && !customFamily}>
						{/* The option's label IS the family — the card renders in it. */}
						<Specimen spec={{ ...base, ...option.spec, displayFamily: option.label }} />
					</OptionCard>
				))}
			</div>

			{!customFamily && <Reason reason={options.find((option) => option.id === selected)?.reason} />}

			{question.other === "font" && (
				<div
					className={cn(
						"mt-4 rounded-xl border px-4 py-3 transition-colors",
						customFamily ? "border-caret-accent" : "border-shell-border",
					)}
					data-testid="wizard-font-other">
					<div className="flex items-center gap-2">
						<Search className="shrink-0 text-shell-muted" size={13} />
						<input
							className="w-full bg-transparent text-[13px] outline-none placeholder:text-shell-muted"
							data-testid="wizard-font-search"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="None of these — search all of Google Fonts…"
							value={query}
						/>
						{customFamily && <span className="shrink-0 text-[12px] text-shell-muted">using {customFamily}</span>}
					</div>

					{results.length > 0 && (
						<div className="mt-2 flex flex-col">
							{results.map((font) => (
								<button
									className="flex items-baseline justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
									key={font.family}
									onClick={() => {
										setCustomFamily(font.family)
										setQuery("")
										setResults([])
									}}
									type="button">
									<span style={{ fontFamily: `"${font.family}", sans-serif`, fontSize: 16 }}>
										{font.family}
									</span>
									<span className="text-[11px] text-shell-muted">{font.category}</span>
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Density, rounding, loudness: one specimen that morphs as the user drags
 * across the steps. The numbers live in each step's spec and never on screen.
 */
function ScaleWidget({
	question,
	base,
	onPick,
}: {
	question: WizardQuestionWire
	base: WizardSpecWire
	onPick(pick: Pick | null): void
}) {
	const steps = question.steps ?? []
	const [index, setIndex] = useState(question.defaultStep ?? Math.floor(steps.length / 2))
	const [custom, setCustom] = useState("")

	useFonts(familiesOf(base))

	useEffect(() => {
		// Their own words win over the slider: a scale offers a handful of points
		// on one axis, and the thing they actually want may not be on it.
		if (custom.trim()) {
			onPick({ answer: { value: custom.trim(), label: custom.trim(), wasOther: true } })
			return
		}
		const step = steps[index]
		if (step) onPick({ answer: { value: step.label, label: step.label } })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [index, custom])

	const spec = { ...base, ...steps[index]?.spec }

	return (
		<div>
			<div className="overflow-hidden rounded-xl border border-shell-border">
				<Specimen morph spec={spec} />
			</div>

			<div className="mt-4">
				<div className="flex items-center justify-between text-[11.5px] text-shell-muted">
					<span>{question.leftLabel}</span>
					<span>{question.rightLabel}</span>
				</div>
				<div className="mt-2 flex gap-1.5" data-testid="wizard-scale">
					{steps.map((step, stepIndex) => (
						<button
							className={cn(
								"h-8 flex-1 rounded-lg border text-[11.5px] transition-colors",
								stepIndex === index && !custom.trim()
									? "border-caret-accent bg-caret-accent/15 text-caret-accent"
									: "border-shell-border text-shell-muted hover:bg-white/5",
							)}
							key={step.label}
							onClick={() => {
								setCustom("")
								setIndex(stepIndex)
							}}
							type="button">
							{step.label}
						</button>
					))}
				</div>

				{question.other === "text" && (
					<input
						className={cn(
							"mt-3 w-full rounded-lg border bg-shell-panel px-3 py-1.5 text-[12.5px] outline-none",
							custom.trim() ? "border-caret-accent" : "border-shell-border focus:border-caret-accent/60",
						)}
						data-testid="wizard-scale-other"
						onChange={(event) => setCustom(event.target.value)}
						placeholder="Or say it in your own words…"
						value={custom}
					/>
				)}
			</div>
		</div>
	)
}

function ChipsWidget({ question, onPick }: { question: WizardQuestionWire; onPick(pick: Pick | null): void }) {
	const options = question.options ?? []
	const [picked, setPicked] = useState<Set<string>>(new Set(question.recommendedId ? [question.recommendedId] : []))
	const [customs, setCustoms] = useState<string[]>([])
	const [draft, setDraft] = useState("")

	useEffect(() => {
		const labels = [...options.filter((option) => picked.has(option.id)).map((option) => option.label), ...customs]
		onPick(labels.length ? { answer: { value: labels.join(", "), label: `${labels.length} picked` } } : null)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [picked, customs])

	const toggle = (id: string) =>
		setPicked((previous) => {
			const next = new Set(previous)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	const addCustom = () => {
		const value = draft.trim()
		if (value && !customs.includes(value)) setCustoms((previous) => [...previous, value])
		setDraft("")
	}

	return (
		<div>
			<div className="flex flex-wrap gap-2" data-testid="wizard-chips">
				{options.map((option) => {
					const active = picked.has(option.id)
					return (
						<button
							className={cn(
								"rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
								active
									? "border-caret-accent bg-caret-accent/15 text-caret-accent"
									: "border-shell-border text-shell-muted hover:bg-white/5",
							)}
							key={option.id}
							onClick={() => toggle(option.id)}
							title={option.reason}
							type="button">
							{option.label}
						</button>
					)
				})}
				{customs.map((label) => (
					<button
						className="rounded-full border border-caret-accent bg-caret-accent/15 px-3.5 py-1.5 text-[12.5px] text-caret-accent"
						key={label}
						onClick={() => setCustoms((previous) => previous.filter((candidate) => candidate !== label))}
						title="Remove"
						type="button">
						{label}
					</button>
				))}
			</div>

			{question.other === "text" && (
				<div className="mt-3 flex items-center gap-2">
					<input
						className="w-56 rounded-lg border border-shell-border bg-shell-panel px-3 py-1.5 text-[12.5px] outline-none focus:border-caret-accent/60"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => event.key === "Enter" && addCustom()}
						placeholder="Something else…"
						value={draft}
					/>
					<button
						className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-shell-muted transition-colors hover:bg-white/5"
						onClick={addCustom}
						type="button">
						<Plus size={12} />
						Add
					</button>
				</div>
			)}
		</div>
	)
}

function TextWidget({ question, onPick }: { question: WizardQuestionWire; onPick(pick: Pick | null): void }) {
	const [text, setText] = useState("")

	useEffect(() => {
		onPick(text.trim() ? { answer: { value: text.trim() } } : null)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text])

	const shared =
		"w-full rounded-xl border border-shell-border bg-shell-panel px-4 py-3 leading-relaxed outline-none transition-colors focus:border-caret-accent/60"

	return question.multiline ? (
		<textarea
			className={cn(shared, "min-h-24 resize-none")}
			data-testid="wizard-text"
			onChange={(event) => setText(event.target.value)}
			placeholder={question.placeholder}
			value={text}
		/>
	) : (
		<input
			className={shared}
			data-testid="wizard-text"
			onChange={(event) => setText(event.target.value)}
			placeholder={question.placeholder}
			value={text}
		/>
	)
}

/**
 * Inferred statements, confirmed in one pass. Agreeing is the default — the
 * whole point is killing five questions with one screen — and disagreeing
 * opens an inline correction rather than another question.
 */
function AssumptionsWidget({ question, onPick }: { question: WizardQuestionWire; onPick(pick: Pick | null): void }) {
	const options = question.options ?? []
	const [corrections, setCorrections] = useState<Record<string, string | null>>({})

	useEffect(() => {
		const lines = options.map((option) => {
			const correction = corrections[option.id]
			return correction ? `${option.label} → actually: ${correction}` : `${option.label} → yes`
		})
		const corrected = Object.values(corrections).filter(Boolean).length
		onPick({
			answer: { value: lines.join("\n"), label: corrected ? `${corrected} corrected` : "all confirmed" },
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [corrections])

	return (
		<div className="flex flex-col gap-2" data-testid="wizard-assumptions">
			{options.map((option) => {
				const correction = corrections[option.id]
				const disagreeing = correction !== undefined && correction !== null
				return (
					<div
						className={cn(
							"rounded-xl border px-4 py-3 transition-colors",
							disagreeing ? "border-caret-accent/50" : "border-shell-border",
						)}
						key={option.id}>
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-start gap-2.5">
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
										disagreeing ? "border-shell-muted/50" : "border-caret-accent bg-caret-accent text-white",
									)}>
									{!disagreeing && <Check size={10} strokeWidth={3} />}
								</span>
								<div>
									<p className="leading-relaxed">{option.label}</p>
									{option.reason && <p className="mt-0.5 text-[11.5px] text-shell-muted">{option.reason}</p>}
								</div>
							</div>
							<button
								className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
								onClick={() =>
									setCorrections((previous) => ({
										...previous,
										[option.id]: disagreeing ? null : "",
									}))
								}
								type="button">
								{disagreeing ? "Never mind" : "Not quite"}
							</button>
						</div>
						{disagreeing && (
							<input
								autoFocus
								className="mt-2.5 w-full rounded-lg border border-shell-border bg-shell-panel px-3 py-1.5 text-[12.5px] outline-none focus:border-caret-accent/60"
								onChange={(event) =>
									setCorrections((previous) => ({ ...previous, [option.id]: event.target.value }))
								}
								placeholder="What's true instead?"
								value={correction ?? ""}
							/>
						)}
					</div>
				)
			})}
		</div>
	)
}

// ── shared pieces ───────────────────────────────────────────────────────────

function OptionCard({
	option,
	selected,
	recommended,
	onSelect,
	children,
}: {
	option: WizardOptionWire
	selected: boolean
	recommended: boolean
	onSelect(): void
	children: React.ReactNode
}) {
	return (
		<button
			className={cn(
				"group flex flex-col overflow-hidden rounded-xl border text-left transition-colors",
				selected ? "border-caret-accent" : "border-shell-border hover:border-white/20",
			)}
			data-option-id={option.id}
			data-selected={selected}
			data-testid="wizard-option"
			onClick={onSelect}
			type="button">
			{children}
			<div className="flex items-start gap-2 border-t border-shell-border bg-shell-panel px-3 py-2.5">
				<span
					className={cn(
						"mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
						selected ? "border-caret-accent bg-caret-accent text-white" : "border-shell-muted/50",
					)}>
					{selected && <Check size={9} strokeWidth={3} />}
				</span>
				<span className="min-w-0">
					<span className="flex items-center gap-2 font-medium">
						{/* A colour option says what it is at a glance, not only inside the picture. */}
						{option.hex && (
							<span className="inline-block size-3 shrink-0 rounded-[4px]" style={{ background: option.hex }} />
						)}
						{option.label}
						{recommended && (
							<span className="rounded bg-caret-accent/15 px-1.5 py-px text-[10px] font-normal text-caret-accent">
								Recommended
							</span>
						)}
					</span>
				</span>
			</div>
		</button>
	)
}

/**
 * The specimen everything renders through: a heading, body copy, and the
 * accent on exactly one element. `morph` turns on transitions so a scale
 * question visibly reshapes it rather than snapping.
 */
function Specimen({ spec, tall, morph }: { spec: WizardSpecWire; tall?: boolean; morph?: boolean }) {
	const surface = surfaceFor(spec)
	const radius = spec.radius ?? 8
	const unit = spec.spacingUnit ?? 8
	const baseSize = spec.baseSize ?? 15
	const transition = morph ? "all 200ms ease" : undefined

	return (
		<div
			className="flex-1"
			style={{
				background: surface.bg,
				color: surface.text,
				fontFamily: stack(spec.bodyFamily),
				padding: tall ? unit * 4 : unit * 2.5,
				transition,
			}}>
			<p
				style={{
					fontFamily: stack(spec.displayFamily ?? spec.bodyFamily),
					fontSize: tall ? 34 : 21,
					lineHeight: 1.15,
					fontWeight: 500,
					transition,
				}}>
				Built for the way you work
			</p>
			<p className="opacity-70" style={{ fontSize: baseSize, marginTop: unit * 1.5, lineHeight: 1.55, transition }}>
				A short paragraph, so you can see how it reads at the size it will actually be used.
			</p>
			<span
				className="inline-block"
				style={{
					background: spec.accent ?? "#6b7280",
					color: readableOn(spec.accent ?? "#6b7280"),
					borderRadius: Math.min(radius, 24),
					marginTop: unit * 2.5,
					padding: `${unit}px ${unit * 2.5}px`,
					fontSize: baseSize - 1,
					transition,
				}}>
				Get started
			</span>
		</div>
	)
}

/**
 * "Your foundation so far" — fills in as answers land, so the interview reads
 * as building something rather than filling in a quiz.
 */
function SoFar({ history, proposalSpec: finalSpec }: { history: WizardQAWire[]; proposalSpec?: WizardSpecWire }) {
	const spec = finalSpec ?? specFromHistory(history)
	const known = [
		spec.displayFamily && ["Headings", spec.displayFamily],
		spec.bodyFamily && ["Body", spec.bodyFamily],
		spec.accent && ["Colour", spec.accent],
		spec.surface && ["Surface", spec.surface === "dark" ? "Dark" : "Light"],
	].filter(Boolean) as Array<[string, string]>

	return (
		<aside className="hidden w-56 shrink-0 lg:block" data-testid="wizard-so-far">
			<p className="text-[11px] tracking-wider text-shell-muted uppercase">So far</p>
			<div className="mt-3 overflow-hidden rounded-xl border border-shell-border">
				<MiniSpecimen spec={spec} />
			</div>
			<dl className="mt-3 flex flex-col gap-1.5">
				{known.map(([term, value]) => (
					<div className="flex items-center justify-between gap-2 text-[11.5px]" key={term}>
						<dt className="text-shell-muted">{term}</dt>
						<dd className="flex min-w-0 items-center gap-1.5 truncate">
							{term === "Colour" && (
								<span className="inline-block size-3 shrink-0 rounded" style={{ background: value }} />
							)}
							<span className="truncate">{value}</span>
						</dd>
					</div>
				))}
				{known.length === 0 && <p className="text-[11.5px] text-shell-muted">Nothing settled yet.</p>}
			</dl>
		</aside>
	)
}

function MiniSpecimen({ spec }: { spec: WizardSpecWire }) {
	const surface = surfaceFor(spec)
	const unit = spec.spacingUnit ?? 8
	return (
		<div style={{ background: surface.bg, color: surface.text, padding: unit * 1.5, fontFamily: stack(spec.bodyFamily) }}>
			<p style={{ fontFamily: stack(spec.displayFamily ?? spec.bodyFamily), fontSize: 15, fontWeight: 500 }}>Aa</p>
			<p className="opacity-70" style={{ fontSize: 11, marginTop: 4 }}>
				The quick brown fox
			</p>
			<span
				className="mt-2 inline-block"
				style={{
					background: spec.accent ?? "#6b7280",
					color: readableOn(spec.accent ?? "#6b7280"),
					borderRadius: Math.min(spec.radius ?? 8, 12),
					padding: "3px 8px",
					fontSize: 10,
				}}>
				Button
			</span>
		</div>
	)
}

// ── derivations ─────────────────────────────────────────────────────────────

/**
 * The accumulated look, from the transcript alone.
 *
 * Local and deterministic — no model involved. An answer contributes whatever
 * its picked option's spec declared, colour answers contribute the hex, font
 * answers the family.
 */
function specFromHistory(history: WizardQAWire[]): WizardSpecWire {
	const spec: WizardSpecWire = {}
	for (const qa of history) {
		if (qa.answer.skipped) continue
		const picked = qa.question.options?.find(
			(option) => option.id === qa.answer.value || option.hex === qa.answer.value || option.label === qa.answer.value,
		)
		if (picked?.spec) Object.assign(spec, stripUndefined(picked.spec))

		if (qa.question.kind === "color") spec.accent = qa.answer.value || spec.accent
		if (qa.question.kind === "font") {
			const family = qa.answer.value
			if (picked?.spec?.bodyFamily) {
				spec.displayFamily = family
				spec.bodyFamily = picked.spec.bodyFamily
			} else if (!spec.displayFamily) {
				spec.displayFamily = family
				spec.bodyFamily = spec.bodyFamily ?? family
			} else {
				spec.bodyFamily = family
			}
		}
		if (qa.question.kind === "scale") {
			const step = qa.question.steps?.find((candidate) => candidate.label === qa.answer.value)
			if (step?.spec) Object.assign(spec, stripUndefined(step.spec))
		}
	}
	return spec
}

function proposalSpec(state: Extract<WizardStateWire, { phase: "finish" }>): WizardSpecWire {
	const proposal = state.proposal
	const radius = { sharp: 2, soft: 8, round: 16, pill: 24 }[proposal.radiusCharacter]
	return {
		displayFamily: proposal.displayFamily,
		bodyFamily: proposal.bodyFamily,
		surface: proposal.surface,
		accent: proposal.brand,
		neutral: proposal.neutral,
		radius,
		spacingUnit: proposal.spacingUnit <= 6 ? 4 : 8,
		baseSize: proposal.baseSize,
	}
}

function stripUndefined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function stack(family?: string): string {
	return family ? `"${family}", ui-sans-serif, sans-serif` : "ui-sans-serif, system-ui, sans-serif"
}

function normalizeHexInput(value: string): string | null {
	const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim())
	if (!match) return null
	const hex = match[1].toLowerCase()
	return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`
}

function familiesOf(spec: WizardSpecWire): string[] {
	return [spec.displayFamily, spec.bodyFamily].filter(Boolean) as string[]
}

/** Loads Google Fonts stylesheets for whatever families the screen shows. */
function useFonts(families: string[]): void {
	const key = [...new Set(families.filter(Boolean))].sort().join("|")
	useEffect(() => {
		if (!key) return
		const url = `https://fonts.googleapis.com/css2?${key
			.split("|")
			.map((family) => `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600`)
			.join("&")}&display=swap`
		const link = document.createElement("link")
		link.rel = "stylesheet"
		link.href = url
		document.head.appendChild(link)
		return () => link.remove()
	}, [key])
}

/** Non-pure surfaces per neutral character — the difference the eye reads as considered. */
const LIGHT_SURFACES: Record<string, { bg: string; text: string }> = {
	warm: { bg: "#faf7f2", text: "#2a2520" },
	cool: { bg: "#f7f8fa", text: "#1a1d24" },
	true: { bg: "#f8f8f8", text: "#1c1c1c" },
	"slight-tint": { bg: "#f6f7f9", text: "#20242b" },
}

const DARK_SURFACES: Record<string, { bg: string; text: string }> = {
	warm: { bg: "#191512", text: "#f0ebe4" },
	cool: { bg: "#0e1116", text: "#e6e9ef" },
	true: { bg: "#111111", text: "#ededed" },
	"slight-tint": { bg: "#101319", text: "#e8ebf1" },
}

function surfaceFor(spec: WizardSpecWire): { bg: string; text: string } {
	const table = spec.surface === "dark" ? DARK_SURFACES : LIGHT_SURFACES
	return table[spec.neutral ?? "cool"] ?? table.cool
}

/** Black or white on a given background, by relative luminance. */
function readableOn(hex: string): string {
	const value = hex.replace("#", "")
	if (value.length < 6) return "#ffffff"
	const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255)
	const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111111" : "#ffffff"
}

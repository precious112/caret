/**
 * The Presets tab: the deterministic curated flow.
 *
 * One typed sentence, then four screens of pointing — fixed steps, options
 * ordered by the description's tags, every combination one somebody approved.
 * No model anywhere, which is the point of this tab: identical screens on
 * every machine, full control, zero spend. The AI-run wizard next door is the
 * default; this is for the user who wants the machine out of the room.
 *
 * Held to the same rules as every foundation surface: no design vocabulary,
 * specimens over labels, and a preselected pick on every screen.
 */
import { ArrowLeft, Check, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { InterviewStateWire, RankedOptionWire, SpecimenWire } from "../../../shared/ipc"
import { invoke } from "../ipc"
import { cn } from "../lib/utils"

export function FoundationInterview({
	projectPath,
	onCommitted,
	onSwitchToManual,
}: {
	projectPath: string
	onCommitted(name: string): void
	onSwitchToManual(): void
}) {
	const [state, setState] = useState<InterviewStateWire | null>(null)
	const [busy, setBusy] = useState(true)
	const [error, setError] = useState<string | null>(null)

	// An interview abandoned mid-flow costs real model calls to rebuild, so it
	// resumes rather than restarts.
	useEffect(() => {
		let cancelled = false
		void invoke("foundation:resume", projectPath)
			.then((resumed) => {
				if (cancelled) return
				setState(resumed ?? { phase: "describe", description: "" })
			})
			.finally(() => !cancelled && setBusy(false))
		return () => {
			cancelled = true
		}
	}, [projectPath])

	async function step<T>(run: () => Promise<T>, apply: (result: T) => void): Promise<void> {
		setBusy(true)
		setError(null)
		try {
			apply(await run())
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	if (!state) return <Centered>{busy ? "Loading…" : "Something went wrong."}</Centered>

	return (
		<div className="flex-1 overflow-auto bg-shell-bg" data-testid="foundation-interview">
			<div className="mx-auto max-w-4xl px-8 py-10">
				{error && (
					<div className="mb-6 border-l-2 border-red-500/60 pl-3 text-red-200" data-testid="foundation-error">
						{error}
					</div>
				)}

				{state.phase === "describe" && (
					<DescribeScreen
						busy={busy}
						initial={state.description}
						onSkip={onSwitchToManual}
						onSubmit={(description) =>
							step(
								() => invoke("foundation:start", projectPath, description),
								(next) => setState(next),
							)
						}
					/>
				)}

				{state.phase === "step" && (
					<StepScreen
						busy={busy}
						onBack={() =>
							step(
								() => invoke("foundation:back", projectPath),
								(next) => setState(next),
							)
						}
						onPick={(optionId) =>
							step(
								() => invoke("foundation:answer", projectPath, state.current.stepId, optionId),
								(next) => setState(next),
							)
						}
						state={state.current}
					/>
				)}

				{state.phase === "summary" && (
					<SummaryScreen
						busy={busy}
						name={state.name}
						onBack={() =>
							step(
								() => invoke("foundation:back", projectPath),
								(next) => setState(next),
							)
						}
						onCommit={() =>
							step(
								() => invoke("foundation:commit", projectPath),
								(result) => onCommitted(result.name),
							)
						}
						preview={state.preview}
					/>
				)}
			</div>
		</div>
	)
}

function Centered({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-1 items-center justify-center bg-shell-bg text-shell-muted">{children}</div>
}

/**
 * The only typing in the flow.
 *
 * Deliberately one open field rather than a set of dropdowns: what someone is
 * building is the one thing they can already describe without help, and it is
 * what every later step is grounded in.
 */
function DescribeScreen({
	initial,
	busy,
	onSubmit,
	onSkip,
}: {
	initial: string
	busy: boolean
	onSubmit(description: string): void
	onSkip(): void
}) {
	const [text, setText] = useState(initial)
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => ref.current?.focus(), [])

	const ready = text.trim().length >= 8

	return (
		<div className="fade-in">
			<h1 className="text-2xl font-medium">Describe what you're building.</h1>
			<p className="mt-2 max-w-xl leading-relaxed text-shell-muted">
				In your own words — what it is and who it's for. Everything after this is picking between pictures, and this is
				what those pictures get chosen from.
			</p>

			<textarea
				className="mt-6 min-h-28 w-full resize-none rounded-xl border border-shell-border bg-shell-panel px-4 py-3 leading-relaxed outline-none transition-colors focus:border-caret-accent/60"
				data-testid="foundation-describe"
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					// Enter submits; a description is one or two sentences, and reaching
					// for the mouse to continue is friction on the only typed screen.
					if (event.key === "Enter" && !event.shiftKey && ready) {
						event.preventDefault()
						onSubmit(text)
					}
				}}
				placeholder="A dashboard where support teams triage tickets all day. They live in it."
				ref={ref}
				value={text}
			/>

			<div className="mt-4 flex items-center gap-2">
				<button
					className="flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
					data-testid="foundation-begin"
					disabled={!ready || busy}
					onClick={() => onSubmit(text)}
					type="button">
					{busy && <Loader2 className="animate-spin" size={13} />}
					Start
				</button>
				<button
					className="rounded-lg px-3 py-2 text-shell-muted transition-colors hover:bg-white/5"
					onClick={onSkip}
					type="button">
					I'd rather set them by hand
				</button>
			</div>
		</div>
	)
}

function StepScreen({
	state,
	busy,
	onPick,
	onBack,
}: {
	state: Extract<InterviewStateWire, { phase: "step" }>["current"]
	busy: boolean
	onPick(optionId: string): void
	onBack(): void
}) {
	// The recommendation, preselected. Pressing through gives a considered
	// foundation rather than whatever happened to be first.
	const [selected, setSelected] = useState(state.options[0]?.id ?? "")
	useEffect(() => setSelected(state.options[0]?.id ?? ""), [state.stepId, state.options])

	useFonts(state.options.map((option) => option.specimen.fontUrl))

	return (
		<div className="fade-in" data-testid="foundation-step">
			<div className="flex items-center justify-between">
				<p className="text-[11px] tracking-wider text-shell-muted uppercase">
					{state.step} of {state.total}
				</p>
				{state.step > 1 && (
					<button
						className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
						data-testid="foundation-back"
						disabled={busy}
						onClick={onBack}
						type="button">
						<ArrowLeft size={12} />
						Back
					</button>
				)}
			</div>

			<h1 className="mt-3 text-2xl font-medium">{state.title}</h1>
			<p className="mt-1.5 max-w-2xl leading-relaxed text-shell-muted">{state.subtitle}</p>

			<div className="mt-6 grid gap-4 md:grid-cols-3">
				{state.options.map((option) => (
					<OptionCard
						key={option.id}
						onSelect={() => setSelected(option.id)}
						option={option}
						selected={option.id === selected}
					/>
				))}
			</div>

			<button
				className="mt-7 flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
				data-testid="foundation-continue"
				disabled={!selected || busy}
				onClick={() => onPick(selected)}
				type="button">
				{busy && <Loader2 className="animate-spin" size={13} />}
				Continue
			</button>
		</div>
	)
}

/** One option, rendered as the thing it would produce rather than named. */
function OptionCard({ option, selected, onSelect }: { option: RankedOptionWire; selected: boolean; onSelect(): void }) {
	return (
		<button
			className={cn(
				"group flex flex-col overflow-hidden rounded-xl border text-left transition-colors",
				selected ? "border-caret-accent" : "border-shell-border hover:border-white/20",
			)}
			data-option-id={option.id}
			data-selected={selected}
			data-testid="foundation-option"
			onClick={onSelect}
			type="button">
			<Specimen specimen={option.specimen} />
			<div className="flex items-start gap-2 border-t border-shell-border bg-shell-panel px-3 py-2.5">
				<span
					className={cn(
						"mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
						selected ? "border-caret-accent bg-caret-accent text-white" : "border-shell-muted/50",
					)}>
					{selected && <Check size={9} strokeWidth={3} />}
				</span>
				<span className="min-w-0">
					<span className="block font-medium">{option.name}</span>
					<span className="mt-0.5 block text-[11.5px] leading-relaxed text-shell-muted">{option.summary}</span>
				</span>
			</div>
		</button>
	)
}

/**
 * The specimen itself — a heading, body copy, and the accent on exactly one
 * element, which is also the restraint rule most palette recipes carry. So the
 * picture demonstrates the rule as well as the colours.
 */
function Specimen({ specimen, tall }: { specimen: SpecimenWire; tall?: boolean }) {
	const surface = surfaceFor(specimen)
	const radius = specimen.radius[3] ?? 8

	return (
		<div
			className={cn("flex-1", tall ? "p-8" : "p-5")}
			style={{ background: surface.bg, color: surface.text, fontFamily: bodyStack(specimen) }}>
			<p
				style={{
					fontFamily: displayStack(specimen),
					fontSize: tall ? 34 : 21,
					lineHeight: 1.15,
					fontWeight: 500,
				}}>
				Built for the way you work
			</p>
			<p
				className="opacity-70"
				style={{ fontSize: specimen.baseSize, marginTop: specimen.spacingUnit * 2, lineHeight: 1.55 }}>
				A short paragraph, so you can see how it reads at the size it will actually be used.
			</p>
			<span
				className="inline-block"
				style={{
					background: specimen.brandColor,
					// A bright accent takes dark text; a deep one takes white. Picking
					// one and using it everywhere leaves half the specimens illegible —
					// and an illegible button is advertising the wrong thing.
					color: readableOn(specimen.brandColor),
					borderRadius: radius,
					marginTop: specimen.spacingUnit * 3,
					padding: `${specimen.spacingUnit * 1.5}px ${specimen.spacingUnit * 3}px`,
					fontSize: specimen.baseSize - 1,
				}}>
				Get started
			</span>
		</div>
	)
}

/**
 * The last screen: the whole foundation on one page, not a swatch sheet.
 *
 * Every earlier screen showed one decision at a time. This is the first time the
 * combination is visible, and it is the only honest place to confirm — a set of
 * choices that each looked right can still be wrong together.
 */
function SummaryScreen({
	preview,
	name,
	busy,
	onCommit,
	onBack,
}: {
	preview: SpecimenWire
	name: string
	busy: boolean
	onCommit(): void
	onBack(): void
}) {
	useFonts([preview.fontUrl])

	return (
		<div className="fade-in" data-testid="foundation-summary">
			<div className="flex items-center justify-between">
				<p className="text-[11px] tracking-wider text-shell-muted uppercase">Everything together</p>
				<button
					className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text"
					data-testid="foundation-back"
					disabled={busy}
					onClick={onBack}
					type="button">
					<ArrowLeft size={12} />
					Back
				</button>
			</div>

			<h1 className="mt-3 text-2xl font-medium">{name}</h1>
			<p className="mt-1.5 max-w-2xl leading-relaxed text-shell-muted">
				This is what pages will be built from. You can change any of it later in the token editor.
			</p>

			<div className="mt-6 overflow-hidden rounded-xl border border-shell-border">
				<Specimen specimen={preview} tall />
			</div>

			<button
				className="mt-7 flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
				data-testid="foundation-commit"
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
 * Loads the specimens' real typefaces.
 *
 * A specimen in the fallback face is not a specimen of anything — it is a
 * picture of a decision the user did not make. Loaded per screen rather than
 * per card so switching selection does not re-request the same stylesheet.
 */
function useFonts(urls: string[]): void {
	const key = urls.join("|")
	useEffect(() => {
		const links = [...new Set(key.split("|").filter(Boolean))].map((href) => {
			const link = document.createElement("link")
			link.rel = "stylesheet"
			link.href = href
			document.head.appendChild(link)
			return link
		})
		return () => links.forEach((link) => link.remove())
	}, [key])
}

function displayStack(specimen: SpecimenWire): string {
	return `"${specimen.displayFamily}", ${specimen.displayFallback}`
}

function bodyStack(specimen: SpecimenWire): string {
	return `"${specimen.bodyFamily}", ${specimen.bodyFallback}`
}

/**
 * Surface and text per neutral character.
 *
 * None are pure white or pure black — that difference is what the eye reads as
 * considered, and showing it in the specimen is the point.
 */
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

function surfaceFor(specimen: SpecimenWire): { bg: string; text: string } {
	const table = specimen.surface === "dark" ? DARK_SURFACES : LIGHT_SURFACES
	return table[specimen.neutralCharacter] ?? table.cool
}

/** Black or white on a given background, by relative luminance. */
function readableOn(hex: string): string {
	const value = hex.replace("#", "")
	const channels = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16) / 255)
	const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111111" : "#ffffff"
}

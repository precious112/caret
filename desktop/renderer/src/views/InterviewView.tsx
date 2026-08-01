/**
 * The foundation interview.
 *
 * Two screens, and the difference between them is the whole point. Questions are
 * plain language with a few concrete answers. Options are *specimens* — the real
 * typeface, the palette applied to real components — because "Instrument Serif
 * with a cool near-monochrome palette" means nothing to someone who is not a
 * designer, and a picture of it means everything.
 *
 * Nothing here shows a hex code, a scale ratio or a radius value. Someone who
 * wants those has the token editor.
 */
import { useEffect, useState } from "react"

import type { InterviewPromptWire, PresentedCandidateWire } from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"

export function InterviewView({ onDone }: { onDone(): void }) {
	const [prompt, setPrompt] = useState<InterviewPromptWire | null>(null)

	useEffect(() => on("interview:prompt", (next) => setPrompt(next)), [])

	// Specimens have to render in the real typeface or they are worthless as
	// specimens. Loading here rather than per-card avoids a flash of the fallback
	// on every re-render.
	useEffect(() => {
		if (prompt?.kind !== "options") return
		const links = prompt.candidates.map((candidate) => {
			const link = document.createElement("link")
			link.rel = "stylesheet"
			link.href = candidate.fontUrl
			document.head.appendChild(link)
			return link
		})
		return () => links.forEach((link) => link.remove())
	}, [prompt])

	const respond = (answer: string | null) => {
		if (!prompt) return
		void invoke("interview:respond", prompt.id, answer)
		setPrompt(null)
	}

	if (!prompt) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 bg-shell-bg p-8 text-center">
				<p className="text-shell-muted">
					Ask your agent to set up this project's foundations, or run its
					<code className="mx-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">foundation_interview</code>
					prompt.
				</p>
				<button
					className="rounded-lg px-3 py-1.5 text-shell-muted transition-colors hover:bg-white/5"
					onClick={onDone}
					type="button">
					Set them up by hand instead
				</button>
			</div>
		)
	}

	return (
		<div className="flex-1 overflow-auto bg-shell-bg p-8">
			<div className="mx-auto max-w-3xl">
				{prompt.step !== undefined && prompt.total !== undefined && (
					<p className="mb-4 text-[11px] uppercase tracking-wider text-shell-muted">
						{prompt.step} of {prompt.total}
					</p>
				)}

				{prompt.kind === "question" ? (
					<QuestionScreen onAnswer={respond} prompt={prompt} />
				) : (
					<OptionsScreen onPick={respond} prompt={prompt} />
				)}

				<button
					className="mt-8 rounded-lg px-3 py-1.5 text-shell-muted transition-colors hover:bg-white/5"
					onClick={() => respond(null)}
					type="button">
					Skip this
				</button>
			</div>
		</div>
	)
}

function QuestionScreen({
	prompt,
	onAnswer,
}: {
	prompt: Extract<InterviewPromptWire, { kind: "question" }>
	onAnswer(answer: string): void
}) {
	return (
		<div className="fade-in">
			<h1 className="text-xl font-medium">{prompt.question}</h1>
			{prompt.hint && <p className="mt-1.5 text-shell-muted">{prompt.hint}</p>}

			<div className="mt-6 flex flex-col gap-2">
				{prompt.choices.map((choice) => (
					<button
						className="rounded-xl border border-shell-border bg-shell-panel px-4 py-3 text-left transition-colors hover:border-caret-accent/50 hover:bg-white/5"
						key={choice}
						onClick={() => onAnswer(choice)}
						type="button">
						{choice}
					</button>
				))}
			</div>
		</div>
	)
}

function OptionsScreen({
	prompt,
	onPick,
}: {
	prompt: Extract<InterviewPromptWire, { kind: "options" }>
	onPick(id: string): void
}) {
	return (
		<div className="fade-in">
			<h1 className="text-xl font-medium">{prompt.title}</h1>
			{prompt.subtitle && <p className="mt-1.5 text-shell-muted">{prompt.subtitle}</p>}

			<div className="mt-6 grid gap-4 md:grid-cols-2">
				{prompt.candidates.map((candidate) => (
					<Specimen candidate={candidate} key={candidate.id} onPick={() => onPick(candidate.id)} />
				))}
			</div>
		</div>
	)
}

/**
 * One candidate, rendered as the thing it would produce.
 *
 * A heading in the display face, body text in the body face, and the accent
 * colour on exactly one element — which is also the restraint rule most of the
 * palette recipes carry, so the specimen demonstrates the rule as well as the
 * colours.
 */
function Specimen({ candidate, onPick }: { candidate: PresentedCandidateWire; onPick(): void }) {
	const surface = SURFACES[candidate.neutralCharacter] ?? SURFACES.cool
	const cardRadius = candidate.radius[3] ?? 8
	const buttonRadius = candidate.radius[candidate.radius.length - 1] === 9999 ? cardRadius : cardRadius

	return (
		<button
			className="group flex flex-col overflow-hidden rounded-xl border border-shell-border text-left transition-colors hover:border-caret-accent"
			onClick={onPick}
			type="button">
			<div className="flex-1 p-6" style={{ background: surface.bg, color: surface.text }}>
				<p
					className="text-[26px] leading-tight"
					style={{ fontFamily: `"${candidate.displayFamily}", serif`, fontWeight: 500 }}>
					Built for the way you work
				</p>
				<p
					className="mt-3 opacity-70"
					style={{ fontFamily: `"${candidate.bodyFamily}", system-ui`, fontSize: candidate.baseSize }}>
					A short paragraph, so you can see how it reads at the size it will actually be used.
				</p>
				<span
					className="mt-5 inline-block px-4 py-2 text-white"
					style={{
						background: candidate.brandColor,
						borderRadius: buttonRadius,
						fontFamily: `"${candidate.bodyFamily}", system-ui`,
						fontSize: candidate.baseSize - 2,
					}}>
					Get started
				</span>
			</div>

			<div className="border-t border-shell-border bg-shell-panel px-4 py-3">
				<p className="font-medium">{candidate.name}</p>
				<p className="mt-0.5 text-[11.5px] leading-relaxed text-shell-muted">{candidate.summary}</p>
			</div>
		</button>
	)
}

/**
 * Surface and text colours per neutral character.
 *
 * None of them are pure white or pure black — that is the difference the eye
 * reads as considered, and showing it in the specimen is the point.
 */
const SURFACES: Record<string, { bg: string; text: string }> = {
	warm: { bg: "#faf7f2", text: "#2a2520" },
	cool: { bg: "#f7f8fa", text: "#1a1d24" },
	true: { bg: "#f8f8f8", text: "#1c1c1c" },
	"slight-tint": { bg: "#f6f7f9", text: "#20242b" },
}

export const _cn = cn

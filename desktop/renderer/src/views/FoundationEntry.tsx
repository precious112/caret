/**
 * The one flow into a design system: describe, then choose how much control.
 *
 * The describe screen used to live inside the wizard; it moved here so the
 * choice of route comes AFTER Caret knows what is being built — all three
 * routes want the description (the interviews ground their questions in it,
 * the manual editor prefills the vibe step).
 *
 * The three cards are user modes, not feature tiers. None is a lesser door:
 * all three end in the same `foundation.json`.
 */
import { Loader2, PenTool, Sparkles, Users } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import type { WizardModeWire, WizardStateWire } from "../../../shared/ipc"
import { invoke } from "../ipc"

interface Props {
	projectPath: string
	/** An interview began; the first turn (or its needs-backend refusal) is `state`. */
	onStarted(state: WizardStateWire, description: string): void
	onManual(description: string): void
	/** Preview harness only: open on the chooser with a canned description. */
	__previewDescription?: string
}

const CHOICES: Array<{
	mode: WizardModeWire | "manual"
	testid: string
	icon: typeof Sparkles
	title: string
	who: string
	what: string
}> = [
	{
		mode: "ai-led",
		testid: "foundation-mode-ai",
		icon: Sparkles,
		title: "AI does the heavy lifting",
		who: "You'd rather build than pick colours.",
		what: "A few plain-language questions, then a complete design system you can always adjust later.",
	},
	{
		mode: "collaborative",
		testid: "foundation-mode-collaborative",
		icon: Users,
		title: "Decide it together",
		who: "You have design opinions and want them heard.",
		what: "A longer interview that walks every decision — the full palette, type, spacing, depth — proposing, never assuming.",
	},
	{
		mode: "manual",
		testid: "foundation-mode-manual",
		icon: PenTool,
		title: "Set every token yourself",
		who: "You know exactly what you want.",
		what: "The token editor, no AI anywhere: colours, type, spacing, corners and depth, by hand.",
	},
]

export function FoundationEntry({ projectPath, onStarted, onManual, __previewDescription }: Props) {
	const [description, setDescription] = useState(__previewDescription ?? "")
	const [described, setDescribed] = useState(Boolean(__previewDescription))
	const [starting, setStarting] = useState<WizardModeWire | null>(null)
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		if (!described) ref.current?.focus()
	}, [described])
	const ready = description.trim().length >= 8

	async function start(mode: WizardModeWire) {
		setStarting(mode)
		try {
			const state = await invoke("wizard:start", projectPath, description.trim(), mode)
			onStarted(state, description.trim())
		} finally {
			setStarting(null)
		}
	}

	return (
		<div className="flex-1 overflow-auto">
			<div className="mx-auto max-w-3xl px-8 py-10">
				{!described ? (
					<div className="fade-in">
						<h1 className="text-2xl font-medium">What are you building?</h1>
						<p className="mt-2 max-w-xl leading-relaxed text-shell-muted">
							What it is, who it's for, anything you already know you want. Everything that follows is grounded in
							this — the better the description, the better the foundations.
						</p>

						<textarea
							className="mt-6 min-h-28 w-full resize-none rounded-xl border border-shell-border bg-shell-panel px-4 py-3 leading-relaxed outline-none transition-colors focus:border-caret-accent/60"
							data-testid="foundation-describe"
							onChange={(event) => setDescription(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey && ready) {
									event.preventDefault()
									setDescribed(true)
								}
							}}
							placeholder="A dashboard where support teams triage tickets all day. Dark, calm, serious."
							ref={ref}
							value={description}
						/>

						<button
							className="mt-4 flex items-center gap-2 rounded-lg bg-caret-accent px-4 py-2 font-medium text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
							data-testid="foundation-describe-continue"
							disabled={!ready}
							onClick={() => setDescribed(true)}
							type="button">
							Continue
						</button>
					</div>
				) : (
					<div className="fade-in">
						<button
							className="text-[11.5px] text-shell-muted transition-colors hover:text-shell-text"
							data-testid="foundation-describe-back"
							onClick={() => setDescribed(false)}
							type="button">
							← "{description.trim().length > 60 ? `${description.trim().slice(0, 60)}…` : description.trim()}"
						</button>
						<h1 className="mt-3 text-2xl font-medium">How much of the design do you want to own?</h1>
						<p className="mt-2 max-w-xl leading-relaxed text-shell-muted">
							All three end in the same design system, and you can always edit it afterwards.
						</p>

						<div className="mt-6 grid gap-4">
							{CHOICES.map((choice) => {
								const Icon = choice.icon
								const busy = starting === choice.mode
								return (
									<button
										className="flex items-start gap-4 rounded-xl border border-shell-border bg-shell-panel p-5 text-left transition-colors hover:border-caret-accent/60 disabled:opacity-50"
										data-testid={choice.testid}
										disabled={starting !== null}
										key={choice.mode}
										onClick={() =>
											choice.mode === "manual" ? onManual(description.trim()) : start(choice.mode)
										}
										type="button">
										<span className="mt-0.5 rounded-lg bg-caret-accent/10 p-2 text-caret-accent">
											{busy ? <Loader2 className="animate-spin" size={16} /> : <Icon size={16} />}
										</span>
										<span className="min-w-0">
											<span className="block font-medium">{choice.title}</span>
											<span className="mt-0.5 block text-[12.5px] text-shell-muted">{choice.who}</span>
											<span className="mt-1.5 block text-[12.5px] leading-relaxed text-shell-muted">
												{choice.what}
											</span>
										</span>
									</button>
								)
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

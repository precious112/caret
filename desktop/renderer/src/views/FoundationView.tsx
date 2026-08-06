/**
 * The foundation surface — two ways in, one `foundation.json` out.
 *
 * **Interview** is the default: describe what you're building, then point at
 * specimens. Caret runs it on its own backend, which is why it is no longer
 * gated on an agent being connected — the old gate made the highest-leverage
 * screen in the product unreachable for exactly the user it was built for. With
 * no backend it still runs, ordering the same curated options deterministically
 * instead of with a model's reasoning.
 *
 * **By hand** is the token editor, unchanged. A designer who knows what they
 * want should not have to sit through four screens to get to it.
 *
 * Both write the same file, so neither is a lesser mode.
 */
import { useEffect, useState } from "react"

import type { ProjectState } from "../../../shared/ipc"
import { TokenWizard } from "../components/design-wizard/TokenWizard"
import { on } from "../ipc"
import { cn } from "../lib/utils"
import { setActiveProject } from "../services/design-client"
import { FoundationInterview } from "./FoundationInterview"
import { InterviewView } from "./InterviewView"

/** `agent` is only ever entered by an external agent pushing a question. */
type Mode = "interview" | "manual" | "agent"

export function FoundationView({
	project,
	onDone,
	onInterviewAnswered,
}: {
	project: ProjectState
	onDone(): void
	onInterviewAnswered?(): void
}) {
	// Caret runs the interview itself now, so it is the default regardless of
	// backend state — it degrades rather than disappearing.
	const [mode, setMode] = useState<Mode>("interview")

	// The wizard's data layer is module-scoped to one project per window.
	useEffect(() => setActiveProject(project.path), [project.path])

	// An *agent's* question still wins over whatever is on screen: unlike Caret's
	// own interview, there is a tool call blocked on it.
	useEffect(() => on("interview:prompt", () => setMode("agent")), [])

	return (
		<div className="flex flex-1 flex-col overflow-hidden bg-shell-bg">
			{!project.hasFoundation && (
				<div className="border-b border-shell-border bg-caret-accent/10 px-8 py-3">
					<p className="mx-auto max-w-3xl">
						Set your foundations before generating any pages. Everything an agent writes will be styled from these,
						and changing them afterwards means restyling what already exists.
					</p>
				</div>
			)}

			<div className="flex items-center gap-1 border-b border-shell-border px-8 py-2">
				<ModeTab
					active={mode === "interview" || mode === "agent"}
					label="Answer a few questions"
					onClick={() => setMode("interview")}
				/>
				<ModeTab active={mode === "manual"} label="Set them by hand" onClick={() => setMode("manual")} />
			</div>

			{mode === "agent" && <InterviewView onAnswered={onInterviewAnswered} onDone={() => setMode("manual")} />}
			{mode === "interview" && (
				<FoundationInterview onCommitted={onDone} onSwitchToManual={() => setMode("manual")} projectPath={project.path} />
			)}
			{mode === "manual" && <TokenWizard onDone={onDone} />}
		</div>
	)
}

function ModeTab({
	active,
	label,
	onClick,
	disabled,
	title,
}: {
	active: boolean
	label: string
	onClick(): void
	disabled?: boolean
	title?: string
}) {
	return (
		<button
			className={cn(
				"rounded-lg px-3 py-1.5 transition-colors",
				active ? "bg-caret-accent/15 text-caret-accent" : "text-shell-muted hover:bg-white/5",
				disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
			)}
			data-testid={`foundation-tab-${label.includes("questions") ? "interview" : "manual"}`}
			disabled={disabled}
			onClick={onClick}
			title={title}
			type="button">
			{label}
		</button>
	)
}

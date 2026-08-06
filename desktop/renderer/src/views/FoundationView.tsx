/**
 * The foundation surface — three doors, one `foundation.json` out.
 *
 * **Interview** (default): the AI-run token wizard. The model reads the
 * project description, decides what to ask, and constructs the tokens; every
 * question renders through Caret's own widget components. Built for the
 * developer who is not design-savvy — which is the user this product is for.
 *
 * **Presets**: the deterministic curated flow. Same describe-then-point shape,
 * fixed steps, no model anywhere — for someone who wants full control and
 * identical screens every time.
 *
 * **By hand**: the token editor, unchanged, for a pro who knows exactly what
 * they want.
 *
 * All three write the same file, so none is a lesser mode.
 */
import { useEffect, useState } from "react"

import type { ProjectState } from "../../../shared/ipc"
import { TokenWizard } from "../components/design-wizard/TokenWizard"
import { on } from "../ipc"
import { cn } from "../lib/utils"
import { setActiveProject } from "../services/design-client"
import { FoundationInterview } from "./FoundationInterview"
import { InterviewView } from "./InterviewView"
import { WizardView } from "./WizardView"

/** `agent` is only ever entered by an external agent pushing a question. */
type Mode = "wizard" | "presets" | "manual" | "agent"

export function FoundationView({
	project,
	onDone,
	onInterviewAnswered,
}: {
	project: ProjectState
	onDone(): void
	onInterviewAnswered?(): void
}) {
	const [mode, setMode] = useState<Mode>("wizard")

	// The wizard's data layer is module-scoped to one project per window.
	useEffect(() => setActiveProject(project.path), [project.path])

	// An *external* agent's question wins over whatever is on screen: unlike
	// Caret's own flows, there is a tool call blocked on it.
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
					active={mode === "wizard" || mode === "agent"}
					label="Answer a few questions"
					onClick={() => setMode("wizard")}
					testid="foundation-tab-interview"
				/>
				<ModeTab
					active={mode === "presets"}
					label="Pick from presets"
					onClick={() => setMode("presets")}
					testid="foundation-tab-presets"
				/>
				<ModeTab
					active={mode === "manual"}
					label="Set them by hand"
					onClick={() => setMode("manual")}
					testid="foundation-tab-manual"
				/>
			</div>

			{mode === "agent" && <InterviewView onAnswered={onInterviewAnswered} onDone={() => setMode("manual")} />}
			{mode === "wizard" && (
				<WizardView
					onCommitted={onDone}
					onSwitchToManual={() => setMode("manual")}
					onSwitchToPresets={() => setMode("presets")}
					projectPath={project.path}
				/>
			)}
			{mode === "presets" && (
				<FoundationInterview onCommitted={onDone} onSwitchToManual={() => setMode("manual")} projectPath={project.path} />
			)}
			{mode === "manual" && <TokenWizard onDone={onDone} />}
		</div>
	)
}

function ModeTab({ active, label, onClick, testid }: { active: boolean; label: string; onClick(): void; testid: string }) {
	return (
		<button
			className={cn(
				"rounded-lg px-3 py-1.5 transition-colors",
				active ? "bg-caret-accent/15 text-caret-accent" : "text-shell-muted hover:bg-white/5",
			)}
			data-testid={testid}
			onClick={onClick}
			type="button">
			{label}
		</button>
	)
}

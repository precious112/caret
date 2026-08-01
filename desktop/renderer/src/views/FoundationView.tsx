/**
 * The foundation surface — two ways in, one `foundation.json` out.
 *
 * **Interview** is the default when an agent is connected: plain questions, then
 * specimens to point at. It exists because a form assumes you already know what
 * to put in it, which is exactly what Caret's user does not.
 *
 * **By hand** is the token editor, unchanged. A designer who knows what they
 * want should not have to sit through five questions to get to it, and it is
 * also the no-agent path — so the fallback is the full editor rather than a
 * degraded interview.
 *
 * Both write the same file, so neither is a lesser mode.
 */
import { useEffect, useState } from "react"

import type { ProjectState } from "../../../shared/ipc"
import { TokenWizard } from "../components/design-wizard/TokenWizard"
import { cn } from "../lib/utils"
import { setActiveProject } from "../services/design-client"
import { InterviewView } from "./InterviewView"

type Mode = "interview" | "manual"

export function FoundationView({ project, onDone }: { project: ProjectState; onDone(): void }) {
	// Without an agent there is nobody to run the interview, so the editor is the
	// only honest default.
	const [mode, setMode] = useState<Mode>(project.agentConnected ? "interview" : "manual")

	// The wizard's data layer is module-scoped to one project per window.
	useEffect(() => setActiveProject(project.path), [project.path])

	useEffect(() => {
		if (!project.agentConnected) setMode("manual")
	}, [project.agentConnected])

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
					active={mode === "interview"}
					disabled={!project.agentConnected}
					label="Answer a few questions"
					onClick={() => setMode("interview")}
					title={project.agentConnected ? undefined : "Connect an agent to run the interview"}
				/>
				<ModeTab active={mode === "manual"} label="Set them by hand" onClick={() => setMode("manual")} />
			</div>

			{mode === "interview" ? <InterviewView onDone={() => setMode("manual")} /> : <TokenWizard onDone={onDone} />}
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
			disabled={disabled}
			onClick={onClick}
			title={title}
			type="button">
			{label}
		</button>
	)
}

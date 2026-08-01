/**
 * The foundation surface.
 *
 * Today this is the token wizard carried over from the extension. Phase 6.5
 * turns it into an agent-led interview over a curated library — the wizard stays
 * as the no-agent path and the pro path, so it keeps its place here rather than
 * being replaced.
 */
import { useEffect } from "react"

import type { ProjectState } from "../../../shared/ipc"
import { TokenWizard } from "../components/design-wizard/TokenWizard"
import { setActiveProject } from "../services/design-client"

export function FoundationView({ project, onDone }: { project: ProjectState; onDone(): void }) {
	// The wizard's data layer is module-scoped to one project per window.
	useEffect(() => setActiveProject(project.path), [project.path])

	return (
		<div className="flex-1 overflow-auto bg-shell-bg">
			{!project.hasFoundation && (
				<div className="border-b border-shell-border bg-caret-accent/10 px-8 py-3">
					<p className="mx-auto max-w-3xl">
						Set your foundations before generating any pages. Every page an agent writes will be styled from these,
						and changing them afterwards means restyling everything that already exists.
					</p>
				</div>
			)}
			<TokenWizard onDone={onDone} />
		</div>
	)
}

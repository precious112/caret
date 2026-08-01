/**
 * Connecting an agent.
 *
 * The whole premise is that Caret does not own the agent, so this screen has to
 * be genuinely good — it is the point where a user either gets Caret working
 * with the tool they already use, or gives up. Each client gets its exact
 * command or config file, with this project's URL and token already in it,
 * because a config that has to be hand-edited is a config that gets typed wrong.
 *
 * The token is a real credential. It is shown, because the user needs it, and
 * it is scoped to one project and regenerated on every launch.
 */

import { Check, Copy } from "lucide-react"
import { useEffect, useState } from "react"

import type { AgentClientConfig, ProjectState } from "../../../shared/ipc"
import { invoke } from "../ipc"
import { cn } from "../lib/utils"

export function AgentPanel({ project, onClose }: { project: ProjectState; onClose(): void }) {
	const [configs, setConfigs] = useState<AgentClientConfig[]>([])
	const [selected, setSelected] = useState(0)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		void invoke("agent:clientConfigs", project.path).then(setConfigs)
	}, [project.path, project.mcpUrl])

	const active = configs[selected]

	const copy = async () => {
		if (!active) return
		await navigator.clipboard.writeText(active.snippet)
		setCopied(true)
		setTimeout(() => setCopied(false), 1600)
	}

	return (
		<div className="flex-1 overflow-auto bg-shell-bg p-8">
			<div className="mx-auto max-w-2xl">
				<header className="mb-6">
					<h1 className="text-lg font-medium">Connect an agent</h1>
					<p className="mt-1 text-shell-muted">
						Caret doesn't bundle an agent — it exposes this project's design layer over MCP, and you point whichever
						agent you already use at it.
					</p>
				</header>

				{project.agentConnected && (
					<div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-emerald-300">
						<Check size={15} />
						An agent is connected to this project.
					</div>
				)}

				{!project.mcpUrl ? (
					<p className="text-shell-muted">Starting the MCP server…</p>
				) : (
					<>
						<div className="mb-3 flex flex-wrap gap-1.5">
							{configs.map((config, index) => (
								<button
									className={cn(
										"rounded-lg px-3 py-1.5 transition-colors",
										index === selected ? "bg-caret-accent text-white" : "bg-white/5 hover:bg-white/10",
									)}
									key={config.client}
									onClick={() => setSelected(index)}
									type="button">
									{config.client}
								</button>
							))}
						</div>

						{active && (
							<div className="fade-in rounded-xl border border-shell-border bg-shell-panel p-4">
								<p className="mb-2 text-shell-muted">{active.instruction}</p>
								{active.targetPath && (
									<p className="mb-2 font-mono text-[11px] text-shell-muted">{active.targetPath}</p>
								)}
								<pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed">
									{active.snippet}
								</pre>
								<button
									className="mt-3 flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 transition-colors hover:bg-white/10"
									onClick={copy}
									type="button">
									{copied ? <Check size={13} /> : <Copy size={13} />}
									{copied ? "Copied" : "Copy"}
								</button>
							</div>
						)}

						<p className="mt-4 text-[11.5px] leading-relaxed text-shell-muted">
							This server is bound to 127.0.0.1, serves only this project, and requires the bearer token above. Both
							the port and the token change every time Caret starts, so a config you saved from a previous session
							will need updating.
						</p>
					</>
				)}

				<button
					className="mt-8 rounded-lg px-3 py-1.5 text-shell-muted transition-colors hover:bg-white/5"
					onClick={onClose}
					type="button">
					Back to canvas
				</button>
			</div>
		</div>
	)
}

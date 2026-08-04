/**
 * Choosing what does the work.
 *
 * Two ways an agent relates to Caret, and they are not alternatives — they are
 * opposite directions:
 *
 * - **Caret's backend** runs the things you click in Caret. This screen's top
 *   half. One is bundled, so a fresh install can already do work.
 * - **Your own agent over MCP** is you, in a terminal, telling your agent to
 *   work on the design layer. That is the bottom half, and it cannot power the
 *   buttons in this window — MCP has no way to start work from Caret's side.
 *
 * The setup names **routes**, never prices or quotas: both drift, and a screen
 * that quotes a number becomes wrong without anyone touching it.
 */

import { Check, ChevronRight, Copy, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { AgentClientConfig, BackendReportWire, ProjectState } from "../../../shared/ipc"
import { invoke } from "../ipc"
import { cn } from "../lib/utils"

/** One line per backend about how it is paid for. Routes, not prices. */
const BILLING_NOTE: Record<string, string> = {
	opencode: "Bring your own API key, an OpenCode subscription, or OpenCode credits.",
	claude: "Signing in here draws Claude's separate Agent SDK credit pool — not your usual Claude Code limits.",
	codex: "Uses your Codex CLI sign-in, or a key in CODEX_API_KEY.",
	kimi: "Uses your Kimi CLI sign-in.",
}

export function BackendPanel({ project, onClose }: { project: ProjectState; onClose(): void }) {
	const [backends, setBackends] = useState<BackendReportWire[] | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [model, setModel] = useState("")
	const [effort, setEffort] = useState("")
	const [busy, setBusy] = useState(false)

	const refresh = useCallback(async () => {
		setBusy(true)
		const [reports, state, prefs] = await Promise.all([
			invoke("agent:backends"),
			invoke("agent:state", project.path),
			invoke("prefs:get"),
		])
		setBackends(reports)
		setSelected(state?.backendId ?? null)
		setModel(String(prefs.backendModel ?? ""))
		setEffort(String(prefs.backendEffort ?? ""))
		setBusy(false)
	}, [project.path])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const choose = async (id: BackendReportWire["id"]) => {
		setSelected(id)
		await invoke("agent:selectBackend", id)
		await refresh()
	}

	return (
		<div className="flex-1 overflow-auto bg-shell-bg p-8" data-testid="backend-panel">
			<div className="mx-auto max-w-2xl">
				<header className="mb-6 flex items-start gap-3">
					<div className="flex-1">
						<h1 className="text-lg font-medium">Backend</h1>
						<p className="mt-1 text-shell-muted">
							What runs the work you start in Caret — syncs, edits you describe in words, and the chat.
						</p>
					</div>
					<button
						className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
						disabled={busy}
						onClick={() => void refresh()}
						type="button">
						<RefreshCw className={cn(busy && "animate-spin")} size={13} />
						Check again
					</button>
				</header>

				<div className="flex flex-col gap-2">
					{(backends ?? []).map((backend) => (
						<BackendRow
							backend={backend}
							key={backend.id}
							onChoose={() => void choose(backend.id)}
							selected={selected === backend.id}
						/>
					))}
					{backends === null && <p className="text-shell-muted">Looking for backends…</p>}
				</div>

				<label className="mt-4 block">
					<span className="text-shell-muted">Model</span>
					<input
						className="mt-1 w-full rounded-lg border border-shell-border bg-shell-panel px-2.5 py-1.5 outline-none placeholder:text-shell-muted focus:border-caret-accent/60"
						data-testid="backend-model"
						onBlur={() => void invoke("prefs:set", { backendModel: model.trim() })}
						onChange={(event) => setModel(event.target.value)}
						placeholder="Leave empty for the backend's own default"
						value={model}
					/>
					<span className="mt-1 block text-[11.5px] leading-relaxed text-shell-muted">
						In the backend's own naming, e.g. <code className="font-mono">anthropic/claude-sonnet-5</code>. Empty is
						usually right.
					</span>
				</label>

				<label className="mt-3 block">
					<span className="text-shell-muted">Reasoning effort</span>
					<select
						className="mt-1 w-full rounded-lg border border-shell-border bg-shell-panel px-2.5 py-1.5 outline-none focus:border-caret-accent/60"
						data-testid="backend-effort"
						onChange={(event) => {
							setEffort(event.target.value)
							void invoke("prefs:set", { backendEffort: event.target.value })
						}}
						value={effort}>
						<option value="">The backend's default</option>
						<option value="minimal">Minimal</option>
						<option value="low">Low</option>
						<option value="medium">Medium</option>
						<option value="high">High</option>
						<option value="xhigh">Extra high</option>
					</select>
					<span className="mt-1 block text-[11.5px] leading-relaxed text-shell-muted">
						Backends that have no such setting ignore it. On Codex, leaving this at the default means <em>no</em>{" "}
						reasoning rather than some.
					</span>
				</label>

				<p className="mt-4 text-[11.5px] leading-relaxed text-shell-muted">
					Caret runs its bundled backend from inside the app, never from your PATH, so upgrading your own copy of a tool
					can't change what Caret executes. Everything it writes to your app's own source asks first, unless you say
					otherwise for a project.
				</p>

				<McpSection project={project} />

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

function BackendRow({ backend, selected, onChoose }: { backend: BackendReportWire; selected: boolean; onChoose(): void }) {
	return (
		<div
			className={cn(
				"rounded-xl border p-3.5 transition-colors",
				selected ? "border-caret-accent/60 bg-caret-accent/5" : "border-shell-border bg-shell-panel",
			)}
			data-testid={`backend-${backend.id}`}>
			<div className="flex items-center gap-2">
				<span className="font-medium">{backend.displayName}</span>

				{backend.ready ? (
					<span className="flex items-center gap-1 text-[11px] text-emerald-300">
						<Check size={11} />
						ready
					</span>
				) : (
					<span className="text-[11px] text-amber-300">{backend.installed ? "needs sign-in" : "not installed"}</span>
				)}

				{backend.permissionModel === "sandbox" && (
					<span
						className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
						title="This backend has no per-action permission callback. Caret confines it with a sandbox instead, so a plan genuinely cannot write — but inside a write session Caret cannot ask you about individual files.">
						can't ask per file
					</span>
				)}

				{backend.untested && (
					<span
						className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-shell-muted"
						title="Written to spec, but never run against a live subscription.">
						untested
					</span>
				)}

				<div className="flex-1" />

				{selected ? (
					<span className="text-[11px] text-caret-accent">in use</span>
				) : (
					<button
						className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 transition-colors hover:bg-white/10 disabled:opacity-40"
						disabled={!backend.ready}
						onClick={onChoose}
						type="button">
						Use this
						<ChevronRight size={12} />
					</button>
				)}
			</div>

			<p className="mt-1.5 leading-relaxed text-shell-muted">{backend.detail}</p>

			{backend.remedy && (
				<div className="mt-2">
					<p className="text-[11.5px] text-shell-muted">{backend.remedy.label}:</p>
					{backend.remedy.command && (
						// Shown to run, not run for you: these flows want a real terminal
						// (a browser hand-off, a device code), and one spawned from a GUI
						// with nowhere to type is a dead end. Press "Check again" after.
						<CopyableCommand command={backend.remedy.command} />
					)}
					{backend.remedy.url && (
						<a
							className="text-caret-accent hover:underline"
							href={backend.remedy.url}
							rel="noreferrer"
							target="_blank">
							{backend.remedy.url}
						</a>
					)}
				</div>
			)}

			{backend.permissionModel === "sandbox" && (
				<p className="mt-2 text-[11.5px] leading-relaxed text-amber-200/80">
					Caret can't approve this backend's writes one at a time — it has no way to ask. A plan still can't touch your
					app, but during an apply the "ask before app changes" setting has no effect here.
				</p>
			)}

			<p className="mt-2 text-[11.5px] leading-relaxed text-shell-muted">{BILLING_NOTE[backend.id]}</p>
		</div>
	)
}

function CopyableCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false)
	return (
		<div className="mt-1 flex items-center gap-2">
			<code className="flex-1 overflow-x-auto rounded-lg bg-black/40 px-2.5 py-1.5 font-mono text-[11.5px]">{command}</code>
			<button
				className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1.5 transition-colors hover:bg-white/10"
				onClick={async () => {
					await navigator.clipboard.writeText(command)
					setCopied(true)
					setTimeout(() => setCopied(false), 1600)
				}}
				type="button">
				{copied ? <Check size={12} /> : <Copy size={12} />}
			</button>
		</div>
	)
}

/**
 * The inbound half, deliberately below the fold.
 *
 * It is real and supported, and it is secondary: it enables an agent in your own
 * terminal to work on the design layer, not the buttons in this window.
 */
function McpSection({ project }: { project: ProjectState }) {
	const [configs, setConfigs] = useState<AgentClientConfig[]>([])
	const [selected, setSelected] = useState(0)
	const [open, setOpen] = useState(false)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		if (open) void invoke("agent:clientConfigs", project.path).then(setConfigs)
	}, [open, project.path, project.mcpUrl])

	const active = configs[selected]

	return (
		<section className="mt-8 border-t border-shell-border pt-6" data-testid="mcp-section">
			<button className="flex items-center gap-1.5 font-medium" onClick={() => setOpen(!open)} type="button">
				<ChevronRight className={cn("transition-transform", open && "rotate-90")} size={14} />
				Connect your own agent to this project
			</button>
			<p className="mt-1 ml-5 leading-relaxed text-shell-muted">
				Point Claude Code, Cursor or another MCP client at this project so it can read and write the design layer from
				your terminal. This is the other direction — it doesn't power Caret's own buttons.
			</p>

			{open && (
				<div className="mt-3 ml-5">
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
								<div className="rounded-xl border border-shell-border bg-shell-panel p-4">
									<p className="mb-2 text-shell-muted">{active.instruction}</p>
									{active.targetPath && (
										<p className="mb-2 font-mono text-[11px] text-shell-muted">{active.targetPath}</p>
									)}
									<pre className="overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed">
										{active.snippet}
									</pre>
									<button
										className="mt-3 flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 transition-colors hover:bg-white/10"
										onClick={async () => {
											await navigator.clipboard.writeText(active.snippet)
											setCopied(true)
											setTimeout(() => setCopied(false), 1600)
										}}
										type="button">
										{copied ? <Check size={13} /> : <Copy size={13} />}
										{copied ? "Copied" : "Copy"}
									</button>
								</div>
							)}

							<p className="mt-3 text-[11.5px] leading-relaxed text-shell-muted">
								This server is bound to 127.0.0.1, serves only this project, and requires the token above. Both
								the port and the token change every time Caret starts.
							</p>
						</>
					)}
				</div>
			)}
		</section>
	)
}

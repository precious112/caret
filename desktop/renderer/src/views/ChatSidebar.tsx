/**
 * The chat with Caret's own backend.
 *
 * Everything Caret starts — a sync, an AI edit, an overlay instruction — runs in
 * here, so there is one place to watch work happen, answer a permission, or stop
 * it. A sidebar rather than a modal for exactly that reason: the design is still
 * visible while the agent changes it.
 *
 * It renders whatever state main pushes and holds none of its own beyond the
 * draft message. The transcript is built once, in the design core, by the same
 * reducer that rebuilds old sessions — so what you see replayed is what you saw
 * live.
 */

import { AlertTriangle, Check, ChevronDown, ChevronRight, History, Plus, Send, Square, Wrench, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { AgentSessionWire, AgentStateWire, ProjectState, TranscriptEntryWire } from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"

export const CHAT_SIDEBAR_WIDTH = 380

interface ChatSidebarProps {
	project: ProjectState
	onClose(): void
	onOpenBackendSetup(): void
}

export function ChatSidebar({ project, onClose, onOpenBackendSetup }: ChatSidebarProps) {
	const [state, setState] = useState<AgentStateWire | null>(null)
	const [draft, setDraft] = useState("")
	const [sessions, setSessions] = useState<AgentSessionWire[] | null>(null)
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		void invoke("agent:state", project.path).then(setState)
		return on("agent:state", (path, next) => {
			if (path === project.path) setState(next)
		})
	}, [project.path])

	// Sticks to the bottom while a turn streams. Checked against the scroll
	// position first: yanking the view back down while someone is reading an
	// earlier tool call is the most common way a chat panel becomes unusable.
	useEffect(() => {
		const element = scrollRef.current
		if (!element) return
		const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
		if (nearBottom) element.scrollTop = element.scrollHeight
	}, [state])

	const entries = state?.transcript.entries ?? []
	const streaming = state?.streaming ?? false

	const send = () => {
		const text = draft.trim()
		if (!text || streaming) return
		setDraft("")
		void invoke("agent:send", project.path, text)
	}

	return (
		<aside
			className="flex h-full shrink-0 flex-col border-l border-shell-border bg-shell-panel"
			data-testid="chat-sidebar"
			style={{ width: CHAT_SIDEBAR_WIDTH }}>
			<header className="flex h-10 shrink-0 items-center gap-2 border-b border-shell-border px-3">
				<span className="truncate text-[12px] font-medium" data-testid="chat-title">
					{state?.activity?.title ?? "Chat"}
				</span>
				{state?.activity?.mode === "read-only" && (
					<span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-shell-muted">plan only</span>
				)}

				<div className="flex-1" />

				<IconButton
					label="Earlier sessions"
					onClick={() => {
						if (sessions) {
							setSessions(null)
							return
						}
						void invoke("agent:sessions", project.path).then(setSessions)
					}}>
					<History size={13} />
				</IconButton>
				<IconButton
					label="New chat"
					onClick={() => {
						setSessions(null)
						void invoke("agent:reset", project.path)
					}}>
					<Plus size={13} />
				</IconButton>
				<IconButton label="Close" onClick={onClose}>
					<X size={13} />
				</IconButton>
			</header>

			{sessions && (
				<SessionList
					onPick={(id) => {
						setSessions(null)
						void invoke("agent:replay", project.path, id)
					}}
					sessions={sessions}
				/>
			)}

			<div className="flex-1 overflow-y-auto px-3 py-3" data-testid="chat-transcript" ref={scrollRef}>
				{!state?.ready && <NoBackend detail={state?.blocked} onOpenBackendSetup={onOpenBackendSetup} />}

				{entries.length === 0 && state?.ready && (
					<p className="px-1 py-6 text-center text-[12px] leading-relaxed text-shell-muted">
						Ask for a change, or describe what you want to build.
						<br />
						Caret can see this project's foundations and assets.
					</p>
				)}

				<div className="flex flex-col gap-2.5">
					{entries.map((entry) => (
						<Entry
							entry={entry}
							key={entry.id}
							onRespond={(requestId, decision) =>
								void invoke("agent:permission", project.path, requestId, decision)
							}
						/>
					))}
				</div>

				<FileChanges files={state?.transcript.files ?? []} />
			</div>

			{state?.pendingApproval && (
				<div className="border-t border-caret-accent/30 bg-caret-accent/10 px-3 py-3" data-testid="chat-approval">
					<p className="mb-2.5 leading-relaxed">{state.pendingApproval.question}</p>
					<div className="flex gap-2">
						<button
							className="rounded-lg bg-caret-accent px-3 py-1.5 font-medium text-white transition-colors hover:bg-caret-accent-hover"
							onClick={() => void invoke("agent:approval", project.path, state.pendingApproval!.id, true)}
							type="button">
							{state.pendingApproval.confirmLabel}
						</button>
						<button
							className="rounded-lg bg-white/5 px-3 py-1.5 transition-colors hover:bg-white/10"
							onClick={() => void invoke("agent:approval", project.path, state.pendingApproval!.id, false)}
							type="button">
							{state.pendingApproval.cancelLabel}
						</button>
					</div>
				</div>
			)}

			<footer className="shrink-0 border-t border-shell-border p-2.5">
				<div className="flex items-end gap-2">
					<textarea
						className="max-h-40 min-h-[38px] flex-1 resize-none rounded-lg border border-shell-border bg-shell-bg px-2.5 py-2 leading-relaxed outline-none placeholder:text-shell-muted focus:border-caret-accent/60"
						data-testid="chat-input"
						disabled={!state?.ready}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault()
								send()
							}
						}}
						placeholder={state?.ready ? "Describe a change…" : "No backend connected"}
						rows={1}
						value={draft}
					/>

					{streaming ? (
						<button
							className="flex size-[38px] items-center justify-center rounded-lg bg-white/5 transition-colors hover:bg-white/10"
							data-testid="chat-stop"
							onClick={() => void invoke("agent:abort", project.path)}
							title="Stop"
							type="button">
							<Square size={13} />
						</button>
					) : (
						<button
							className="flex size-[38px] items-center justify-center rounded-lg bg-caret-accent text-white transition-colors hover:bg-caret-accent-hover disabled:opacity-40"
							data-testid="chat-send"
							disabled={!state?.ready || draft.trim().length === 0}
							onClick={send}
							title="Send"
							type="button">
							<Send size={13} />
						</button>
					)}
				</div>

				<Usage state={state} />
			</footer>
		</aside>
	)
}

function NoBackend({ detail, onOpenBackendSetup }: { detail?: string | null; onOpenBackendSetup(): void }) {
	return (
		<div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" data-testid="chat-no-backend">
			<p className="leading-relaxed text-amber-200">{detail ?? "No coding backend is set up yet."}</p>
			<button
				className="mt-2.5 rounded-lg bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
				onClick={onOpenBackendSetup}
				type="button">
				Open backend settings
			</button>
		</div>
	)
}

function SessionList({ sessions, onPick }: { sessions: AgentSessionWire[]; onPick(id: string): void }) {
	return (
		<div className="max-h-56 overflow-y-auto border-b border-shell-border" data-testid="chat-sessions">
			{sessions.length === 0 ? (
				<p className="px-3 py-3 text-shell-muted">Nothing here yet.</p>
			) : (
				sessions.map((session) => (
					<button
						className="block w-full truncate px-3 py-2 text-left transition-colors hover:bg-white/5"
						key={session.id}
						onClick={() => onPick(session.id)}
						type="button">
						{session.title}
					</button>
				))
			)}
		</div>
	)
}

function Entry({
	entry,
	onRespond,
}: {
	entry: TranscriptEntryWire
	onRespond(requestId: string, decision: "allow" | "deny" | "allow-always"): void
}) {
	switch (entry.kind) {
		case "user":
			return (
				<div className="fade-in self-end rounded-xl rounded-br-sm bg-caret-accent/15 px-3 py-2 leading-relaxed whitespace-pre-wrap">
					{entry.text}
				</div>
			)

		case "assistant":
			return <div className="fade-in leading-relaxed whitespace-pre-wrap">{entry.text}</div>

		case "thinking":
			return <Thinking text={entry.text} />

		case "tool":
			return (
				<div className="flex items-center gap-2 text-[11.5px] text-shell-muted" data-testid="chat-tool">
					<Wrench className={cn("shrink-0", entry.status === "running" && "animate-pulse")} size={11} />
					<span className="shrink-0">{entry.name}</span>
					<span className={cn("truncate", entry.status === "failed" && "text-red-300")}>{entry.summary}</span>
				</div>
			)

		case "permission":
			return <Permission entry={entry} onRespond={onRespond} />

		case "error":
			return (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-red-200">
					<AlertTriangle className="mt-0.5 shrink-0" size={13} />
					<span className="leading-relaxed">{entry.message}</span>
				</div>
			)

		case "note":
			return <p className="text-[11.5px] leading-relaxed text-shell-muted italic">{entry.text}</p>
	}
}

/**
 * Collapsed by default, and that is the point: reasoning is useful when
 * something went wrong and noise the rest of the time.
 */
function Thinking({ text }: { text: string }) {
	const [open, setOpen] = useState(false)
	return (
		<div className="text-[11.5px] text-shell-muted">
			<button className="flex items-center gap-1 hover:text-shell-text" onClick={() => setOpen(!open)} type="button">
				{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
				Thinking
			</button>
			{open && <p className="mt-1 pl-4 leading-relaxed whitespace-pre-wrap">{text}</p>}
		</div>
	)
}

function Permission({
	entry,
	onRespond,
}: {
	entry: Extract<TranscriptEntryWire, { kind: "permission" }>
	onRespond(requestId: string, decision: "allow" | "deny" | "allow-always"): void
}) {
	if (entry.status !== "pending") {
		return (
			<p className="text-[11.5px] text-shell-muted" data-testid="chat-permission-resolved">
				{entry.status === "allowed" ? "Allowed" : "Refused"}
				{entry.automatic ? ` — ${entry.automatic}` : ""}
			</p>
		)
	}

	return (
		<div className="fade-in rounded-xl border border-amber-500/30 bg-amber-500/5 p-3" data-testid="chat-permission">
			<p className="mb-2.5 leading-relaxed">{entry.summary}</p>
			<div className="flex flex-wrap gap-2">
				<button
					className="rounded-lg bg-caret-accent px-2.5 py-1.5 font-medium text-white transition-colors hover:bg-caret-accent-hover"
					data-testid="chat-permission-allow"
					onClick={() => onRespond(entry.requestId, "allow")}
					type="button">
					Allow
				</button>
				<button
					className="rounded-lg bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
					onClick={() => onRespond(entry.requestId, "allow-always")}
					type="button">
					Always for this project
				</button>
				<button
					className="rounded-lg bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
					data-testid="chat-permission-deny"
					onClick={() => onRespond(entry.requestId, "deny")}
					type="button">
					Refuse
				</button>
			</div>
		</div>
	)
}

function FileChanges({ files }: { files: string[] }) {
	if (files.length === 0) return null
	return (
		<div className="mt-4 rounded-xl border border-shell-border p-2.5" data-testid="chat-files">
			<p className="mb-1.5 text-[11px] tracking-wide text-shell-muted uppercase">Changed</p>
			{files.map((file) => (
				<p className="flex items-center gap-1.5 truncate text-[11.5px]" key={file} title={file}>
					<Check className="shrink-0 text-emerald-400" size={11} />
					{file.split("/").slice(-2).join("/")}
				</p>
			))}
		</div>
	)
}

function Usage({ state }: { state: AgentStateWire | null }) {
	const summary = useMemo(() => {
		if (!state) return null
		const { inputTokens, outputTokens, costUsd } = state.transcript.usage
		if (inputTokens + outputTokens === 0) return null
		const tokens = `${Math.round((inputTokens + outputTokens) / 1000)}k tokens`
		return costUsd > 0 ? `${tokens} · $${costUsd.toFixed(3)}` : tokens
	}, [state])

	if (!summary && !state?.backendName) return null

	return (
		<p className="mt-1.5 px-0.5 text-[10.5px] text-shell-muted">
			{state?.backendName}
			{summary ? ` · ${summary}` : ""}
		</p>
	)
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick(): void }) {
	return (
		<button
			className="flex size-6 items-center justify-center rounded transition-colors hover:bg-white/10"
			onClick={onClick}
			title={label}
			type="button">
			{children}
		</button>
	)
}

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
 *
 * **Two rules this panel is held to**, both of which it broke in its first form:
 *
 * 1. *Colour is reserved.* The shell exists to frame the user's design work, and
 *    accent-tinted chrome makes their own colours hard to judge. Accent appears
 *    on exactly one thing: something waiting on an answer.
 * 2. *Turns group.* Uniform spacing between every entry means a user message, a
 *    thinking block, four tool lines and the reply all read as one undifferentiated
 *    column. The gap between turns is what makes a transcript scannable.
 */

import { AlertTriangle, ChevronDown, ChevronRight, History, Paperclip, Plus, Send, Square, Wrench, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { AgentSessionWire, AgentStateWire, ProjectState, TranscriptEntryWire } from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"
import { Markdown } from "./Markdown"

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
	const inputRef = useRef<HTMLTextAreaElement>(null)

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
	const turns = useMemo(() => groupIntoTurns(entries), [entries])

	const send = () => {
		const text = draft.trim()
		if (!text || streaming) return
		setDraft("")
		void invoke("agent:send", project.path, text)
	}

	const composer = {
		draft,
		setDraft,
		send,
		streaming,
		ready: state?.ready ?? false,
		model: describeModel(state?.model ?? "", state?.providerName),
		effort: state?.effort ?? "",
		inputRef,
		onOpenBackendSetup,
		onStop: () => void invoke("agent:abort", project.path),
		onReferenceAsset: () => {
			setDraft(draft.endsWith("@") || draft.endsWith(" ") || draft === "" ? `${draft}@` : `${draft} @`)
			inputRef.current?.focus()
		},
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

			<div className="flex-1 overflow-y-auto px-3.5 py-4" data-testid="chat-transcript" ref={scrollRef}>
				{!state?.ready && <NoBackend detail={state?.blocked} onOpenBackendSetup={onOpenBackendSetup} />}

				{entries.length === 0 && state?.ready && (
					<p className="px-1 py-8 text-center text-[12px] leading-relaxed text-shell-muted">
						Ask for a change, or describe what you want to build.
						<br />
						Caret can see this project's foundations and assets.
					</p>
				)}

				{turns.map((turn, index) => (
					// The gap between turns is six times the gap inside one. That ratio
					// is the whole reason a long transcript stays readable.
					<div className={cn("flex flex-col gap-1.5", index > 0 && "mt-7")} key={turn[0]?.id ?? index}>
						{turn.map((entry) => (
							<Entry
								entry={entry}
								key={entry.id}
								onRespond={(requestId, decision) =>
									void invoke("agent:permission", project.path, requestId, decision)
								}
							/>
						))}
					</div>
				))}

				<FileChanges files={state?.transcript.files ?? []} />
			</div>

			{state?.pendingApproval && (
				<div className="border-t border-caret-accent/40 px-3.5 py-3" data-testid="chat-approval">
					<p className="mb-2.5 leading-relaxed">{state.pendingApproval.question}</p>
					<div className="flex gap-2">
						<button
							className="rounded-lg bg-caret-accent px-3 py-1.5 font-medium text-white transition-colors hover:bg-caret-accent-hover"
							onClick={() => void invoke("agent:approval", project.path, state.pendingApproval?.id ?? "", true)}
							type="button">
							{state.pendingApproval.confirmLabel}
						</button>
						<button
							className="rounded-lg px-3 py-1.5 text-shell-muted transition-colors hover:bg-white/5"
							onClick={() => void invoke("agent:approval", project.path, state.pendingApproval?.id ?? "", false)}
							type="button">
							{state.pendingApproval.cancelLabel}
						</button>
					</div>
				</div>
			)}

			<Composer {...composer} />
		</aside>
	)
}

// ── composers ───────────────────────────────────────────────────────────────

interface ComposerProps {
	draft: string
	setDraft(value: string): void
	send(): void
	streaming: boolean
	ready: boolean
	model: string
	effort: string
	onOpenBackendSetup(): void
	onReferenceAsset(): void
	onStop(): void
	inputRef: React.RefObject<HTMLTextAreaElement | null>
}

const PLACEHOLDER = "Ask for a change, @ for an asset…"

function useComposerKeys(send: () => void) {
	return (event: React.KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault()
			send()
		}
	}
}

/**
 * The composer: one surface that holds its own controls.
 *
 * Two other arrangements were built and looked at side by side at real size —
 * a calmer one with the controls above the box, and a single-row one. Both lost
 * to this for the same reason: they put the model and the effort *below or above*
 * the box as a caption, and a caption is a label where this needs a control. The
 * thing you most want to vary per message should not be a click away in another
 * surface, which is what the first version of this panel did.
 */
function Composer(props: ComposerProps) {
	const onKeyDown = useComposerKeys(props.send)
	return (
		<footer className="shrink-0 p-2.5">
			<div className="rounded-xl border border-shell-border bg-shell-bg focus-within:border-white/20">
				<textarea
					className="max-h-40 min-h-[46px] w-full resize-none bg-transparent px-3 pt-2.5 leading-relaxed outline-none placeholder:text-shell-muted"
					data-testid="chat-input"
					disabled={!props.ready}
					onChange={(event) => props.setDraft(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={props.ready ? PLACEHOLDER : "No backend connected"}
					ref={props.inputRef}
					rows={1}
					value={props.draft}
				/>
				<div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
					{/*
					 * Types the `@` rather than opening a picker, because the picker is
					 * Phase 6.6 and does not exist yet. The expansion behind it *does* —
					 * `@tag` resolves to a real asset before any instruction reaches an
					 * agent — so this is a shortcut to something that works, not a stub
					 * for something that does not.
					 */}
					<IconButton label="Reference an asset" onClick={props.onReferenceAsset}>
						<Paperclip size={13} />
					</IconButton>
					<Pill grow label={props.model} onClick={props.onOpenBackendSetup} />
					{props.effort && <Pill label={props.effort} onClick={props.onOpenBackendSetup} />}
					<div className="flex-1" />
					<SendButton {...props} />
				</div>
			</div>
		</footer>
	)
}

/** Neutral, not accent: sending is the expected act, not the urgent one. */
function SendButton(props: ComposerProps) {
	if (props.streaming) {
		return (
			<button
				className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-white/15"
				data-testid="chat-stop"
				onClick={props.onStop}
				title="Stop"
				type="button">
				<Square size={12} />
			</button>
		)
	}
	return (
		<button
			className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-30"
			data-testid="chat-send"
			disabled={!props.ready || props.draft.trim().length === 0}
			onClick={props.send}
			title="Send"
			type="button">
			<Send size={12} />
		</button>
	)
}

function Pill({ label, onClick, grow }: { label: string; onClick(): void; grow?: boolean }) {
	return (
		<button
			className={cn(
				"flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-shell-muted transition-colors hover:bg-white/5 hover:text-shell-text",
				grow && "shrink",
			)}
			onClick={onClick}
			type="button">
			<span className="truncate">{label}</span>
			<ChevronDown className="shrink-0" size={10} />
		</button>
	)
}

// ── transcript ──────────────────────────────────────────────────────────────

/** Splits a flat transcript into turns, each beginning at what the user said. */
function groupIntoTurns(entries: TranscriptEntryWire[]): TranscriptEntryWire[][] {
	const turns: TranscriptEntryWire[][] = []
	for (const entry of entries) {
		if (entry.kind === "user" || turns.length === 0) turns.push([])
		turns[turns.length - 1].push(entry)
	}
	return turns
}

function NoBackend({ detail, onOpenBackendSetup }: { detail?: string | null; onOpenBackendSetup(): void }) {
	return (
		<div className="mb-3 border-l-2 border-amber-500/60 pl-3" data-testid="chat-no-backend">
			<p className="leading-relaxed text-amber-200">{detail ?? "No coding backend is set up yet."}</p>
			<button
				className="mt-2 text-shell-muted underline underline-offset-2 transition-colors hover:text-shell-text"
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
				<div className="fade-in mb-1 max-w-[82%] self-end rounded-xl rounded-br-sm bg-white/[0.07] px-3 py-2 leading-relaxed whitespace-pre-wrap">
					{entry.text}
				</div>
			)

		case "assistant":
			return <Markdown className="fade-in leading-relaxed" text={entry.text} />

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
			// A rule, not a filled card. At this width a stack of tinted boxes reads
			// as noise, and the text is the part that matters.
			return (
				<div className="flex items-start gap-2 border-l-2 border-red-500/60 pl-3 text-red-200">
					<AlertTriangle className="mt-0.5 shrink-0" size={13} />
					<span className="leading-relaxed">{entry.message}</span>
				</div>
			)

		case "note":
			return (
				<p className="border-l-2 border-shell-border pl-3 text-[11.5px] leading-relaxed text-shell-muted">{entry.text}</p>
			)
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
			{/* Reasoning is markdown too — models bold their conclusions in it, and
			    those are the words you're opening this to find. */}
			{open && <Markdown className="mt-1 pl-4 leading-relaxed" text={text} />}
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
				{entry.automatic ? `: ${entry.automatic}` : ""}
			</p>
		)
	}

	// The one place accent is spent: something is waiting on an answer.
	return (
		<div className="fade-in border-l-2 border-caret-accent py-0.5 pl-3" data-testid="chat-permission">
			<p className="mb-2 leading-relaxed">{entry.summary}</p>
			<div className="flex flex-wrap gap-1.5">
				<button
					className="rounded-lg bg-white/10 px-2.5 py-1 font-medium transition-colors hover:bg-white/20"
					data-testid="chat-permission-allow"
					onClick={() => onRespond(entry.requestId, "allow")}
					type="button">
					Allow
				</button>
				<button
					className="rounded-lg px-2.5 py-1 text-shell-muted transition-colors hover:bg-white/5"
					onClick={() => onRespond(entry.requestId, "allow-always")}
					type="button">
					Always
				</button>
				<button
					className="rounded-lg px-2.5 py-1 text-shell-muted transition-colors hover:bg-white/5"
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
		<div className="mt-7 border-t border-shell-border pt-2.5" data-testid="chat-files">
			<p className="mb-1.5 text-[11px] tracking-wide text-shell-muted uppercase">
				Changed {files.length > 1 ? `· ${files.length}` : ""}
			</p>
			{files.map((file) => (
				<p className="truncate text-[11.5px] text-shell-muted" key={file} title={file}>
					{file.split("/").slice(-2).join("/")}
				</p>
			))}
		</div>
	)
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick(): void }) {
	return (
		<button
			className="flex size-7 shrink-0 items-center justify-center rounded-lg text-shell-muted transition-colors hover:bg-white/10 hover:text-shell-text"
			onClick={onClick}
			title={label}
			type="button">
			{children}
		</button>
	)
}

/**
 * A model, named as `model (provider)`.
 *
 * This slot used to render the *backend's* display name, so the composer said
 * "OpenCode (bundled)" as though that were a model. It is not: OpenCode is the
 * agent loop Caret drives, and it reaches several providers, one of which is
 * free and one of which is not. When Caret hosts its own inference it becomes a
 * provider on the same footing.
 *
 * OpenCode's ids already carry the provider (`opencode-go/gpt-5.6-luna`); the
 * other backends' are bare, so the provider comes from the backend itself.
 */
function describeModel(model: string, providerName: string | null | undefined): string {
	if (!model) return "default model"

	const slash = model.lastIndexOf("/")
	if (slash === -1) return providerName ? `${model} (${providerName})` : model
	return `${model.slice(slash + 1)} (${model.slice(0, slash)})`
}

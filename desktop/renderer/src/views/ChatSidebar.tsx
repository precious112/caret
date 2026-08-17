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

import {
	AlertTriangle,
	AtSign,
	ChevronDown,
	ChevronRight,
	History,
	ImagePlus,
	Paperclip,
	Plus,
	Send,
	Square,
	Wrench,
	X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ThinkingOrb } from "thinking-orbs"

import type {
	AgentSessionWire,
	AgentStateWire,
	AssetEntryWire,
	ComposerImage,
	InterviewPromptWire,
	ProjectState,
	TranscriptEntryWire,
} from "../../../shared/ipc"
import { invoke, on } from "../ipc"
import { cn } from "../lib/utils"
import { AssetMentionList, type AssetMentions, useAssetMentions } from "./AssetMentions"
import { splitAssetTags } from "./asset-tags"
import { Markdown } from "./Markdown"

export const CHAT_SIDEBAR_WIDTH = 380

/** The one prompt kind this sidebar renders; everything else is Foundation's. */
type AssetOptionsPromptWire = Extract<InterviewPromptWire, { kind: "asset-options" }>

interface ChatSidebarProps {
	project: ProjectState
	onClose(): void
	onOpenBackendSetup(): void
	/** Opens the asset viewer over the canvas. State lives in App, not here. */
	onViewAsset(tag: string): void
}

export function ChatSidebar({ project, onClose, onOpenBackendSetup, onViewAsset }: ChatSidebarProps) {
	const [state, setState] = useState<AgentStateWire | null>(null)
	const [draft, setDraft] = useState("")
	const [attached, setAttached] = useState<ComposerImage[]>([])
	const [sessions, setSessions] = useState<AgentSessionWire[] | null>(null)
	const [assets, setAssets] = useState<AssetEntryWire[]>([])
	const [assetPrompt, setAssetPrompt] = useState<AssetOptionsPromptWire | null>(null)
	const scrollRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		void invoke("agent:state", project.path).then(setState)
		return on("agent:state", (path, next) => {
			if (path === project.path) setState(next)
		})
	}, [project.path])

	// Tag detection and option thumbnails both need the current index. Followed
	// on the same event the library follows, because assets arrive from agents
	// and from Finder, not only from this window's own surfaces.
	useEffect(() => {
		const refresh = () => void invoke("assets:list", project.path).then((list) => setAssets(list ?? []))
		refresh()
		return on("assets:changed", (changed) => {
			if (changed === project.path) refresh()
		})
	}, [project.path])

	// Asset picks dock here rather than on the interview surface — the plan they
	// belong to is this conversation. The mount-time catch-up is not optional:
	// a prompt sent before this listener existed is lost forever, and an agent
	// can ask while the sidebar is closed.
	useEffect(() => {
		const keep = (prompt: InterviewPromptWire | null) => {
			if (prompt?.kind === "asset-options") setAssetPrompt(prompt)
		}
		void invoke("interview:pending").then(keep)
		return on("interview:prompt", keep)
	}, [])

	const resolveAssetPrompt = (picked: string | null) => {
		if (!assetPrompt) return
		void invoke("interview:respond", assetPrompt.id, picked)
		setAssetPrompt(null)
	}

	const assetTags = useMemo(() => new Set(assets.map((asset) => asset.tag)), [assets])

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

	const mentions = useAssetMentions({ project, draft, setDraft, inputRef })

	const send = () => {
		const text = draft.trim()
		if (!text || streaming) return
		const images = attached.map((image) => image.dataUrl)
		setDraft("")
		setAttached([])
		void invoke("agent:send", project.path, text, images.length > 0 ? images : undefined)
	}

	// Pasted and dropped files never touch main: the renderer already holds the
	// bytes, and a round trip through a path would only be a chance to lose them.
	const attachFiles = useCallback((files: File[]) => {
		const images = files.filter((file) => file.type.startsWith("image/"))
		if (images.length === 0) return
		void Promise.all(
			images.map(
				(file) =>
					new Promise<ComposerImage | null>((resolve) => {
						const reader = new FileReader()
						reader.onload = () =>
							resolve(
								typeof reader.result === "string"
									? { name: file.name || "pasted image", dataUrl: reader.result }
									: null,
							)
						reader.onerror = () => resolve(null)
						reader.readAsDataURL(file)
					}),
			),
		).then((read) =>
			setAttached((current) => [...current, ...read.filter((image): image is ComposerImage => image !== null)]),
		)
	}, [])

	const composer = {
		draft,
		setDraft,
		attached,
		setAttached,
		attachFiles,
		send,
		streaming,
		ready: state?.ready ?? false,
		model: describeModel(state?.model ?? "", state?.providerName),
		effort: state?.effort ?? "",
		inputRef,
		mentions,
		onOpenBackendSetup,
		onStop: () => void invoke("agent:abort", project.path),
		onReferenceAsset: mentions.begin,
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
								assetTags={assetTags}
								entry={entry}
								key={entry.id}
								onRespond={(requestId, decision) =>
									void invoke("agent:permission", project.path, requestId, decision)
								}
								onViewAsset={onViewAsset}
							/>
						))}
					</div>
				))}

				{state?.streaming && <WorkingRow />}

				<FileChanges files={state?.transcript.files ?? []} />
			</div>

			{assetPrompt && (
				<AssetOptionsBlock
					canvasUrl={project.canvasUrl}
					onDismiss={() => resolveAssetPrompt(null)}
					onPick={(tag) => resolveAssetPrompt(tag)}
					onView={onViewAsset}
					prompt={assetPrompt}
				/>
			)}

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
	attached: ComposerImage[]
	setAttached: React.Dispatch<React.SetStateAction<ComposerImage[]>>
	attachFiles(files: File[]): void
	send(): void
	streaming: boolean
	ready: boolean
	model: string
	effort: string
	onOpenBackendSetup(): void
	onReferenceAsset(): void
	onStop(): void
	inputRef: React.RefObject<HTMLTextAreaElement | null>
	mentions: AssetMentions
}

const PLACEHOLDER = "Ask for a change, @ for an asset…"

function useComposerKeys(send: () => void, mentions: AssetMentions) {
	return (event: React.KeyboardEvent) => {
		// The picker gets first refusal on every key. Enter chooses an asset when
		// the list is open and sends only when it is not — otherwise picking an
		// asset would also send the half-written message.
		if (mentions.handleKeyDown(event)) return
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
	const onKeyDown = useComposerKeys(props.send, props.mentions)

	// A textarea does not grow on its own. Height tracks content up to the
	// max-height ceiling (10rem, from `max-h-40`); past it, the box holds still
	// and the text scrolls inside. Driven by the draft value rather than input
	// events so sending — which clears the draft — also collapses the box.
	useEffect(() => {
		const el = props.inputRef.current
		if (!el) return
		el.style.height = "auto"
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}, [props.draft, props.inputRef])

	return (
		<footer
			className="relative shrink-0 p-2.5"
			onDragOver={(event) => event.preventDefault()}
			onDrop={(event) => {
				if (event.dataTransfer.files.length === 0) return
				event.preventDefault()
				props.attachFiles(Array.from(event.dataTransfer.files))
			}}>
			<AssetMentionList mentions={props.mentions} />
			<div className="rounded-xl border border-shell-border bg-shell-bg focus-within:border-white/20">
				<AttachedImages attached={props.attached} setAttached={props.setAttached} />
				<textarea
					className="max-h-40 min-h-[46px] w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 leading-relaxed outline-none placeholder:text-shell-muted"
					data-testid="chat-input"
					disabled={!props.ready}
					onChange={(event) => props.setDraft(event.target.value)}
					onKeyDown={onKeyDown}
					// A screenshot in the clipboard is the commonest way anyone has an
					// image to show; making them save it to disk first would be the only
					// step in this flow that leaves the app.
					onPaste={(event) => {
						const files = Array.from(event.clipboardData.files)
						if (files.length === 0) return
						event.preventDefault()
						props.attachFiles(files)
					}}
					placeholder={props.ready ? PLACEHOLDER : "No backend connected"}
					ref={props.inputRef}
					rows={1}
					value={props.draft}
				/>
				<div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
					<AttachMenu {...props} />
					<Pill grow label={props.model} onClick={props.onOpenBackendSetup} />
					{props.effort && <Pill label={props.effort} onClick={props.onOpenBackendSetup} />}
					<div className="flex-1" />
					<SendButton {...props} />
				</div>
			</div>
		</footer>
	)
}

/**
 * The paperclip, which now covers two different acts.
 *
 * Tagging an asset puts a name in the message that the agent resolves to a file
 * in the library and can *use in the page*. Attaching an image only lets the
 * model look at it — a reference to imitate, a screenshot of something wrong.
 * They were one button because the second did not exist; conflating them would
 * mean either every reference photo becomes a permanent asset or every asset
 * has to be described in words.
 *
 * `@` is untouched. Tagging still works by typing it, and this menu item does
 * exactly what the button did before: types the `@` and lets the picker open.
 */
function AttachMenu(props: ComposerProps) {
	const [open, setOpen] = useState(false)

	// Any click that is not on the menu closes it. Registered while open only, so
	// the common case costs nothing.
	useEffect(() => {
		if (!open) return
		const close = () => setOpen(false)
		window.addEventListener("pointerdown", close)
		return () => window.removeEventListener("pointerdown", close)
	}, [open])

	const choose = (act: () => void) => () => {
		setOpen(false)
		act()
	}

	return (
		<div className="relative" onPointerDown={(event) => event.stopPropagation()}>
			<IconButton label="Attach" onClick={() => setOpen(!open)}>
				<Paperclip size={13} />
			</IconButton>
			{open && (
				<div
					className="absolute bottom-8 left-0 z-20 w-44 overflow-hidden rounded-lg border border-shell-border bg-shell-panel py-1 shadow-lg"
					data-testid="chat-attach-menu">
					<AttachMenuItem
						hint="Name a file from the library so the agent can put it in the page"
						icon={<AtSign size={12} />}
						label="Tag asset"
						onClick={choose(props.onReferenceAsset)}
						testId="chat-attach-asset"
					/>
					<AttachMenuItem
						hint="Something for the model to look at, not added to the library"
						icon={<ImagePlus size={12} />}
						label="Upload image"
						onClick={choose(() => {
							void invoke("chat:pickImages").then((images) => {
								if (images && images.length > 0) props.setAttached((current) => [...current, ...images])
							})
						})}
						testId="chat-attach-image"
					/>
				</div>
			)}
		</div>
	)
}

function AttachMenuItem({
	hint,
	icon,
	label,
	onClick,
	testId,
}: {
	hint: string
	icon: React.ReactNode
	label: string
	onClick(): void
	testId: string
}) {
	return (
		<button
			className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/5"
			data-testid={testId}
			onClick={onClick}
			type="button">
			<span className="mt-0.5 text-shell-muted">{icon}</span>
			<span className="min-w-0">
				<span className="block text-[12px]">{label}</span>
				<span className="block text-[10.5px] leading-snug text-shell-muted">{hint}</span>
			</span>
		</button>
	)
}

/** Thumbnails above the text, so what is going with the message is never a guess. */
function AttachedImages({
	attached,
	setAttached,
}: {
	attached: ComposerImage[]
	setAttached: React.Dispatch<React.SetStateAction<ComposerImage[]>>
}) {
	if (attached.length === 0) return null
	return (
		<div className="flex flex-wrap gap-1.5 px-3 pt-2.5" data-testid="chat-attachments">
			{attached.map((image, index) => (
				<span className="group relative" key={`${image.name}-${index}`} title={image.name}>
					<img
						alt={image.name}
						className="size-11 rounded-md border border-shell-border object-cover"
						src={image.dataUrl}
					/>
					<button
						className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-shell-panel text-shell-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-shell-text"
						onClick={() => setAttached((current) => current.filter((_, at) => at !== index))}
						title={`Remove ${image.name}`}
						type="button">
						<X size={10} />
					</button>
				</span>
			))}
		</div>
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

/**
 * Sessions the History list should not carry.
 *
 * Visual edits create one session per click of the pencil, so a working
 * afternoon buries the actual conversations under dozens of "Edit" rows. The
 * pill already reported each one when it happened, and provenance keeps the
 * durable record — the History list is for conversations someone might want to
 * reopen. Syncs stay listed: their transcripts answer "what did that sync do".
 * (Titles are Caret's own, set at session creation, so matching on them is
 * matching on our own constants — "AI edit" covers pre-lane sessions.)
 */
const HIDDEN_SESSION_TITLES = new Set(["Edit", "AI edit"])

function SessionList({ sessions: allSessions, onPick }: { sessions: AgentSessionWire[]; onPick(id: string): void }) {
	const sessions = allSessions.filter((session) => !HIDDEN_SESSION_TITLES.has(session.title))
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
	assetTags,
	onViewAsset,
}: {
	entry: TranscriptEntryWire
	onRespond(requestId: string, decision: "allow" | "deny" | "allow-always"): void
	assetTags: ReadonlySet<string>
	onViewAsset(tag: string): void
}) {
	switch (entry.kind) {
		case "user":
			return (
				<div className="fade-in mb-1 max-w-[82%] self-end rounded-xl rounded-br-sm bg-white/[0.07] px-3 py-2 leading-relaxed whitespace-pre-wrap">
					<TaggedText onTag={onViewAsset} tags={assetTags} text={entry.text} />
				</div>
			)

		case "assistant":
			return (
				<Markdown assetTags={assetTags} className="fade-in leading-relaxed" onAssetTag={onViewAsset} text={entry.text} />
			)

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
 * Plain text with known `@tags` made clickable, for the user's own bubbles.
 * The assistant side gets the same treatment inside `Markdown`, off the same
 * tokenizer, so the two halves of a conversation agree on what is a tag.
 */
function TaggedText({ text, tags, onTag }: { text: string; tags: ReadonlySet<string>; onTag(tag: string): void }) {
	const segments = useMemo(() => splitAssetTags(text, tags), [text, tags])
	return (
		<>
			{segments.map((segment, index) =>
				segment.kind === "tag" ? (
					<button
						className="text-caret-accent transition-colors hover:text-caret-accent-hover"
						data-testid="chat-asset-tag"
						key={index}
						onClick={() => onTag(segment.tag)}
						type="button">
						@{segment.tag}
					</button>
				) : (
					<span key={index}>{segment.text}</span>
				),
			)}
		</>
	)
}

/**
 * Assets the agent offered against one question, docked where approvals dock —
 * the tool call is blocked on this, which is what earns it the accent border.
 * Each chip is two acts on purpose: the picture opens the viewer for a closer
 * look, "Use this" is the answer. Looking must never commit.
 */
function AssetOptionsBlock({
	prompt,
	canvasUrl,
	onPick,
	onView,
	onDismiss,
}: {
	prompt: Extract<InterviewPromptWire, { kind: "asset-options" }>
	canvasUrl: string | null
	onPick(tag: string): void
	onView(tag: string): void
	onDismiss(): void
}) {
	// Same absolutising the library does: this chrome is not served by Vite, so
	// the index's relative paths would 404 against the chrome's own origin.
	const absolute = (url: string) => (canvasUrl ? new URL(url, canvasUrl).toString() : null)

	return (
		<div className="border-t border-caret-accent/40 px-3.5 py-3" data-testid="chat-asset-options">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<p className="leading-relaxed">{prompt.question}</p>
					{prompt.why && <p className="mt-0.5 text-[11.5px] leading-relaxed text-shell-muted">{prompt.why}</p>}
				</div>
				<button
					className="flex size-6 shrink-0 items-center justify-center rounded-lg text-shell-muted transition-colors hover:bg-white/10 hover:text-shell-text"
					data-testid="chat-asset-options-dismiss"
					onClick={onDismiss}
					title="Dismiss"
					type="button">
					<X size={12} />
				</button>
			</div>

			<div className="mt-2.5 flex flex-wrap gap-2">
				{prompt.options.map((option) => {
					const preview = option.kind === "video" && option.posterUrl ? option.posterUrl : option.url
					const src = option.kind === "image" || option.kind === "vector" || option.posterUrl ? absolute(preview) : null
					return (
						<div
							className="w-[104px] overflow-hidden rounded-lg border border-shell-border"
							data-testid="chat-asset-option"
							key={option.tag}>
							<button
								className="block h-16 w-full bg-black/20"
								onClick={() => onView(option.tag)}
								title={`Look at @${option.tag}`}
								type="button">
								{src ? (
									<img alt={option.tag} className="size-full object-cover" src={src} />
								) : (
									<span className="flex size-full items-center justify-center text-[10px] tracking-wide text-shell-muted uppercase">
										{option.kind}
									</span>
								)}
							</button>
							<p className="truncate px-1.5 pt-1 font-mono text-[10.5px] text-shell-muted" title={`@${option.tag}`}>
								@{option.tag}
							</p>
							<button
								className="w-full px-1.5 pt-0.5 pb-1.5 text-left text-[11px] font-medium text-caret-accent transition-colors hover:text-caret-accent-hover"
								data-testid="chat-asset-option-use"
								onClick={() => onPick(option.tag)}
								type="button">
								Use this
							</button>
						</div>
					)
				})}
			</div>
		</div>
	)
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

/** Beyond this, the list is a wall — the count says the rest. */
const FILE_CHANGES_SHOWN = 5

/**
 * The turn's heartbeat: visible for the whole streaming window, not only until
 * first output. Long silences happen mid-turn too (thinking gaps, tool waits),
 * and this row is what says "still alive" through them. The elapsed counter is
 * the honest half — an animation loops identically whether the process is
 * alive or wedged; a counter cannot lie about time passing.
 */
function WorkingRow() {
	const [startedAt] = useState(() => Date.now())
	const [, tick] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => tick((n) => n + 1), 1000)
		return () => clearInterval(timer)
	}, [])

	const seconds = Math.floor((Date.now() - startedAt) / 1000)

	return (
		<div className="mt-3 flex items-center gap-2.5 text-[12px] text-shell-muted" data-testid="chat-working">
			<ThinkingOrb size={20} state="working" theme="dark" />
			<span>Working…</span>
			{seconds >= 3 && <span className="tabular-nums text-shell-muted/70">{seconds}s</span>}
		</div>
	)
}

function FileChanges({ files }: { files: string[] }) {
	const [expanded, setExpanded] = useState(false)
	if (files.length === 0) return null

	// Unbounded, a big turn's file list eats the whole sidebar — eleven lines of
	// paths crowding out the conversation they belong to.
	const shown = expanded ? files : files.slice(0, FILE_CHANGES_SHOWN)
	const hidden = files.length - shown.length

	return (
		<div className="mt-7 border-t border-shell-border pt-2.5" data-testid="chat-files">
			<p className="mb-1.5 text-[11px] tracking-wide text-shell-muted uppercase">
				Changed {files.length > 1 ? `· ${files.length}` : ""}
			</p>
			{shown.map((file) => (
				<p className="truncate text-[11.5px] text-shell-muted" key={file} title={file}>
					{file.split("/").slice(-2).join("/")}
				</p>
			))}
			{hidden > 0 && (
				<button
					className="mt-0.5 text-[11.5px] text-shell-muted underline-offset-2 hover:text-shell-text hover:underline"
					onClick={() => setExpanded(true)}
					type="button">
					+{hidden} more…
				</button>
			)}
			{expanded && files.length > FILE_CHANGES_SHOWN && (
				<button
					className="mt-0.5 text-[11.5px] text-shell-muted underline-offset-2 hover:text-shell-text hover:underline"
					onClick={() => setExpanded(false)}
					type="button">
					Show fewer
				</button>
			)}
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

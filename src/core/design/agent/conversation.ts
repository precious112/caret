/**
 * One project's chat with its backend.
 *
 * This is where Caret owning the loop actually shows up: it starts sessions,
 * decides every permission, keeps the transcript, and hands the renderer a state
 * object rather than a stream of half-interpreted backend events.
 *
 * **One session per activity** — a sync, an edit, a brainstorm — never one
 * endless thread. The history panel then reads as a list of things the user did,
 * which is the only shape in which chat history is worth keeping at all.
 */
import { Logger } from "@/shared/services/Logger"
import { expandReferences, readAssetIndex } from "../assets"
import {
	type BackendEvent,
	type BackendId,
	type BackendSession,
	type CodingBackend,
	NoBackendError,
	type PermissionDecision,
	type ReasoningEffort,
	type SessionMode,
} from "./backend"
import { type AppWritePolicy, rulePermission } from "./permissions"
import { addNote, addUserMessage, applyEvent, emptyTranscript, resolvePermission, type TranscriptState } from "./transcript"

export type ActivityKind = "chat" | "edit" | "sync-plan" | "sync-apply" | "flow-sync"

export interface Activity {
	id: string
	kind: ActivityKind
	title: string
	mode: SessionMode
	sessionId: string
}

/** A yes/no Caret is waiting on before it does the next thing. */
export interface PendingApproval {
	id: string
	question: string
	confirmLabel: string
	cancelLabel: string
}

export interface ConversationState {
	backendId: BackendId | null
	backendName: string | null
	/** Who serves this backend's models, for ids that do not name a provider. */
	providerName: string | null
	ready: boolean
	/** Why it is not ready, when it is not. */
	blocked: string | null
	activity: Activity | null
	streaming: boolean
	transcript: TranscriptState
	pendingApproval: PendingApproval | null
	/** Whether app-path writes still prompt in this project. */
	appWrites: AppWritePolicy
	/**
	 * The chosen model and effort, as configured.
	 *
	 * Pushed rather than read by the renderer. The chat panel used to fetch these
	 * from preferences itself, keyed on the backend id — so changing the *model*
	 * never re-ran the fetch and the composer showed a stale value forever. State
	 * the user can change belongs on one path out of main, not two.
	 */
	model: string | null
	effort: string | null
}

export interface ConversationDeps {
	projectPath: string
	/** The configured backend, or null when the user has not chosen one that works. */
	resolveBackend(): Promise<CodingBackend | null>
	model(): string | undefined
	effort(): ReasoningEffort | undefined
	appWrites(): AppWritePolicy
	setAppWrites(policy: AppWritePolicy): Promise<void>
	/** Foundations, authoring rules and the asset index, injected directly. */
	systemPrompt(): Promise<string | undefined>
	onChange(state: ConversationState): void
}

export interface RunRequest {
	kind: ActivityKind
	title: string
	mode: SessionMode
	/** What the model receives. */
	prompt: string
	/**
	 * What the chat shows instead, when the two differ.
	 *
	 * Caret's own prompts are instruction blocks — the sync worklist is a page of
	 * `<explicit_instructions>` — and pasting one into the transcript as if the
	 * user had typed it makes the chat unreadable at the exact moment they are
	 * trying to follow what is happening.
	 */
	displayPrompt?: string
	images?: string[]
	/** Continue an existing backend session instead of opening a new one. */
	resumeSessionId?: string
	/** Line shown above the turn, in Caret's own voice. */
	note?: string
}

export interface RunOutcome {
	ok: boolean
	sessionId: string | null
	/** Everything the assistant said this turn, concatenated. */
	text: string
	filesChanged: string[]
}

/** State pushes are coalesced to this interval so token streaming isn't one IPC per character. */
const PUSH_INTERVAL_MS = 60

/** A prompt's first line, sized for a list row. */
function firstLine(text: string): string {
	const line = text.trim().split("\n")[0] ?? ""
	return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

let activityCounter = 0

export class AgentConversation {
	private transcript = emptyTranscript()
	private activity: Activity | null = null
	private session: BackendSession | null = null
	private streaming = false
	private pendingApproval: PendingApproval | null = null
	private approvalResolver: ((ok: boolean) => void) | null = null
	private backendId: BackendId | null = null
	private stopRequested = false
	private backendName: string | null = null
	private providerName: string | null = null
	private blocked: string | null = null
	private pushTimer: NodeJS.Timeout | null = null

	constructor(private readonly deps: ConversationDeps) {}

	getState(): ConversationState {
		return {
			backendId: this.backendId,
			backendName: this.backendName,
			providerName: this.providerName,
			ready: this.backendId !== null && this.blocked === null,
			blocked: this.blocked,
			activity: this.activity,
			streaming: this.streaming,
			transcript: this.transcript,
			pendingApproval: this.pendingApproval,
			appWrites: this.deps.appWrites(),
			model: this.deps.model() ?? null,
			effort: this.deps.effort() ?? null,
		}
	}

	/** Clears the transcript and starts a fresh activity next time. */
	reset(): void {
		this.transcript = emptyTranscript()
		this.activity = null
		this.pendingApproval = null
		this.push(true)
	}

	/**
	 * Runs one turn, streaming into the transcript.
	 *
	 * Refuses rather than queues when there is no backend. A design tool that
	 * silently accepts work nothing will ever do is the exact failure the MCP
	 * outbound path had.
	 */
	async run(request: RunRequest): Promise<RunOutcome> {
		// Reset before anything async: a Stop pressed while the session is still
		// being opened is aimed at this turn.
		this.stopRequested = false

		if (!this.activity || this.activity.kind !== request.kind || request.resumeSessionId) {
			this.transcript = request.resumeSessionId ? this.transcript : emptyTranscript()
		}

		// **Echo before anything asynchronous.** Opening a session is a real
		// round-trip — an availability probe, an HTTP call, the system-prompt
		// build — and it used to run before the user's own message was even added
		// to the transcript. On a cold backend that was seconds in which pressing
		// Enter changed nothing on screen, which reads as a hang. The first
		// hundred milliseconds decide whether the app feels alive; nothing about
		// them may wait on a network.
		activityCounter += 1
		this.activity = {
			id: `activity-${activityCounter}`,
			kind: request.kind,
			title: request.title,
			mode: request.mode,
			sessionId: request.resumeSessionId ?? "",
		}
		if (request.note) addNote(this.transcript, request.note)
		addUserMessage(this.transcript, request.displayPrompt ?? request.prompt)
		this.streaming = true
		this.push(true)

		// The session title is what the History panel shows, and a list reading
		// "Chat, Chat, Chat" identifies nothing. A chat is named by its opening
		// message — the user's own words are the best available summary of what
		// the conversation was about.
		const sessionTitle =
			request.kind === "chat" ? firstLine(request.displayPrompt ?? request.prompt) || request.title : request.title

		let session: BackendSession
		try {
			const backend = await this.resolve(request.kind)
			session = await backend.startSession({
				workingDirectory: this.deps.projectPath,
				mode: request.mode,
				model: this.deps.model(),
				effort: this.deps.effort(),
				title: sessionTitle,
				resumeSessionId: request.resumeSessionId,
				systemPrompt: await this.deps.systemPrompt(),
			})
		} catch (err) {
			// The echo promised work; a failure to even open the session has to
			// land in the same transcript, not vanish into a rejected promise.
			this.streaming = false
			applyEvent(this.transcript, {
				type: "error",
				message: err instanceof Error ? err.message : String(err),
				recoverable: true,
			})
			this.push(true)
			throw err
		}

		this.session = session
		this.activity = { ...this.activity, sessionId: session.id }

		let text = ""
		let ok = true
		// A turn can end without the model ever having run: the backend accepts
		// the prompt, its own loop finds nothing to do, and a perfectly real idle
		// arrives over an otherwise empty stream. That is a failed turn, not a
		// quiet success — reporting it `ok` is how a broken sync spent days being
		// blamed on the model. `done` alone is not activity.
		let sawActivity = false

		try {
			for await (const event of session.send({ text: request.prompt, images: request.images })) {
				if (event.type !== "done") sawActivity = true
				if (event.type === "text") text += event.text
				if (event.type === "error") ok = false

				applyEvent(this.transcript, event)

				if (event.type === "permission") {
					// Not awaited: the stream has to keep flowing while a decision is
					// made, or a second permission request in the same turn deadlocks
					// behind the first one's prompt.
					void this.decide(session, event)
				}

				this.push(event.type === "done")
			}
		} catch (err) {
			ok = false
			applyEvent(this.transcript, {
				type: "error",
				message: err instanceof Error ? err.message : String(err),
				recoverable: true,
			})
		} finally {
			// A user's Stop can also end a turn before its first event; that is
			// their call, not a backend fault.
			if (ok && !sawActivity && !this.stopRequested) {
				ok = false
				applyEvent(this.transcript, {
					type: "error",
					message:
						"The backend accepted the prompt but never ran it — nothing was done. This is a Caret↔backend fault, not the model.",
					recoverable: true,
				})
			}
			this.streaming = false
			this.push(true)
		}

		return { ok, sessionId: session.id, text, filesChanged: [...this.transcript.files] }
	}

	/**
	 * Continues the current activity, or opens a brainstorming one.
	 *
	 * `@tag` is resolved here rather than by the caller, so every surface that can
	 * send a chat message gets it — and here rather than left to the model, which
	 * is the rule §4.6 states for the visual editor and holds for the same reason:
	 * an agent that fails to resolve a tag does not error, it invents an asset
	 * that suits the name. The chat still shows what the user typed; only the
	 * model sees the expansion.
	 */
	async sendMessage(text: string): Promise<RunOutcome> {
		const current = this.activity
		const expansion = expandReferences(text, await readAssetIndex(this.deps.projectPath))
		const prompt =
			expansion.unknown.length > 0
				? `${expansion.text}\n\nThe user referred to ${expansion.unknown
						.map((tag) => `@${tag}`)
						.join(
							", ",
						)}, which ${expansion.unknown.length === 1 ? "is not an asset" : "are not assets"} in this project. Do not invent ${
						expansion.unknown.length === 1 ? "it" : "them"
					} — say the tag does not exist and list what does.`
				: expansion.text

		return this.run({
			kind: current?.kind ?? "chat",
			title: current?.title ?? "Chat",
			mode: current?.mode ?? "write",
			prompt,
			displayPrompt: prompt === text ? undefined : text,
			resumeSessionId: current?.sessionId,
		})
	}

	async abort(): Promise<void> {
		this.stopRequested = true
		await this.session?.abort()
		// A pending approval outlives the turn it belongs to unless it is cleared,
		// and a stop button that leaves a dead question on screen is worse than no
		// stop button.
		this.resolveApproval(false)
		this.streaming = false
		this.push(true)
	}

	/** The user answering a permission prompt Caret chose to surface. */
	async respondToPermission(requestId: string, decision: PermissionDecision): Promise<void> {
		if (decision === "allow-always") await this.deps.setAppWrites("allow")
		resolvePermission(this.transcript, requestId, decision === "deny" ? "denied" : "allowed")
		await this.session?.respondToPermission(requestId, decision)
		this.push(true)
	}

	/** Asks the user a yes/no and waits. Used by sync between plan and apply. */
	requestApproval(approval: PendingApproval): Promise<boolean> {
		this.resolveApproval(false)
		this.pendingApproval = approval
		this.push(true)
		return new Promise<boolean>((resolve) => {
			this.approvalResolver = resolve
		})
	}

	respondToApproval(id: string, ok: boolean): void {
		if (this.pendingApproval?.id !== id) return
		this.resolveApproval(ok)
		this.push(true)
	}

	/** Re-pushes state after something outside the conversation changed it. */
	touch(): void {
		this.push(true)
	}

	note(text: string): void {
		addNote(this.transcript, text)
		this.push(true)
	}

	/** Rebuilds the transcript from a past session, using the live reducer. */
	async replay(sessionId: string): Promise<boolean> {
		const backend = await this.deps.resolveBackend()
		if (!backend?.readTranscript) return false

		const events = await backend.readTranscript(this.deps.projectPath, sessionId).catch((err) => {
			Logger.warn(`[agent] could not replay ${sessionId}: ${err}`)
			return null
		})
		if (!events) return false

		this.transcript = emptyTranscript()
		for (const event of events) applyEvent(this.transcript, event)
		this.activity = { id: `replay-${sessionId}`, kind: "chat", title: "Earlier session", mode: "write", sessionId }
		this.streaming = false
		this.push(true)
		return true
	}

	async close(): Promise<void> {
		if (this.pushTimer) clearTimeout(this.pushTimer)
		this.resolveApproval(false)
		await this.session?.close().catch(() => {})
	}

	/** Refreshes which backend is configured, for the state the chrome renders. */
	async refreshBackend(): Promise<void> {
		try {
			const backend = await this.deps.resolveBackend()
			this.backendId = backend?.id ?? null
			this.backendName = backend?.displayName ?? null
			this.providerName = backend?.providerName ?? null
			this.blocked = backend ? null : new NoBackendError("chat").message
		} catch (err) {
			this.backendId = null
			this.backendName = null
			this.providerName = null
			this.blocked = err instanceof Error ? err.message : String(err)
		}
		this.push(true)
	}

	private async resolve(kind: ActivityKind): Promise<CodingBackend> {
		const backend = await this.deps.resolveBackend()
		if (!backend) {
			await this.refreshBackend()
			throw new NoBackendError(
				kind === "sync-plan" || kind === "sync-apply" ? "sync" : kind === "chat" ? "chat" : "visual-edit",
			)
		}
		this.backendId = backend.id
		this.backendName = backend.displayName
		this.providerName = backend.providerName
		this.blocked = null
		return backend
	}

	/**
	 * Caret's answer to one permission request.
	 *
	 * The ruling is computed here and either applied straight away or turned into
	 * a question. Either way the transcript records what happened and why — a
	 * silent auto-approval is indistinguishable from an agent that was never
	 * checked.
	 */
	private async decide(session: BackendSession, event: Extract<BackendEvent, { type: "permission" }>): Promise<void> {
		const ruling = rulePermission(
			{ action: event.tool, patterns: event.path ? [event.path] : [] },
			{ projectPath: this.deps.projectPath, mode: session.mode, appWrites: this.deps.appWrites() },
		)

		if (ruling.kind === "auto") {
			resolvePermission(this.transcript, event.requestId, ruling.decision === "deny" ? "denied" : "allowed", ruling.reason)
			await session.respondToPermission(event.requestId, ruling.decision)
			this.push(true)
			return
		}

		// Left pending: the renderer is showing it and the user answers.
		const entry = this.transcript.entries.find((e) => e.kind === "permission" && e.requestId === event.requestId)
		if (entry && entry.kind === "permission") entry.summary = ruling.summary
		this.push(true)
	}

	private resolveApproval(ok: boolean): void {
		const resolver = this.approvalResolver
		this.approvalResolver = null
		this.pendingApproval = null
		resolver?.(ok)
	}

	/**
	 * Pushes state to the renderer, coalesced.
	 *
	 * Immediate on anything the user is waiting on (a permission, the end of a
	 * turn); throttled for token streaming, which would otherwise be one IPC
	 * message per character.
	 */
	private push(immediate = false): void {
		if (immediate) {
			if (this.pushTimer) {
				clearTimeout(this.pushTimer)
				this.pushTimer = null
			}
			this.deps.onChange(this.getState())
			return
		}

		if (this.pushTimer) return
		this.pushTimer = setTimeout(() => {
			this.pushTimer = null
			this.deps.onChange(this.getState())
		}, PUSH_INTERVAL_MS)
	}
}

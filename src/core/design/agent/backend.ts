/**
 * The coding-backend seam.
 *
 * Caret owns the loop for everything that starts in Caret's window — sync, AI
 * edits, the overlay editor, the foundation interview. MCP cannot carry that
 * direction (it is client-initiated), so those features run on an agent Caret
 * drives itself, behind this interface.
 *
 * All adapters conform to this. Anything a backend emits that does not map onto
 * {@link BackendEvent} is dropped rather than passed through half-understood — a
 * half-understood event in a chat transcript reads as a bug in Caret.
 *
 * Running with **no** backend is a supported state. Every feature that needs one
 * refuses with {@link NoBackendError}, which names the fix.
 */

export type BackendId = "opencode" | "claude" | "codex" | "kimi"

/** What a session is allowed to do. Enforced by Caret, not by backend config. */
export type SessionMode = "read-only" | "write"

/**
 * How hard the model should think.
 *
 * Named in the vocabulary the backends themselves use rather than Caret's own,
 * because every one of them already has a spelling for this and inventing a
 * fifth would mean a mapping table that is wrong for somebody. Backends without
 * the concept ignore it — see each adapter.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

/**
 * How a backend can be held to Caret's permission rules.
 *
 * - `ask` — it raises a request per action and obeys the answer, so Caret decides
 *   every write individually and the per-project "ask before app writes" toggle
 *   means what it says.
 * - `sandbox` — it has no such callback. The boundary is a mode chosen before the
 *   turn starts: a plan genuinely cannot write, but inside a write session Caret
 *   cannot intercept individual files.
 *
 * This is a real difference in what the user is agreeing to, so it is on the
 * interface and shown in the UI rather than left in a comment.
 */
export type PermissionModel = "ask" | "sandbox"

/**
 * A model, and who serves it.
 *
 * The distinction is not pedantry. A *backend* is the agent loop Caret drives —
 * OpenCode, Claude Code, Codex. A *provider* is who serves the weights, and one
 * backend commonly reaches several: the bundled OpenCode alone sees OpenCode Go
 * and OpenCode Zen, which differ in whether they cost money. Collapsing the two
 * is how a backend's name ends up displayed where a model's belongs.
 */
export interface ModelOption {
	/** What Caret persists and sends, in the backend's own namespace. */
	id: string
	/** What the user reads, without the provider prefix. */
	label: string
	/** Free at the provider. Worth showing; a bill is not a nice surprise. */
	free?: boolean
}

export interface ModelGroup {
	providerId: string
	providerName: string
	models: ModelOption[]
}

export interface StartSessionOptions {
	workingDirectory: string
	/** `read-only` is the plan phase: the agent may read anything and write nothing. */
	mode: SessionMode
	/** Backend's own model namespace. Omitted means the backend's default. */
	model?: string
	/** Omitted means the backend's default, which is not always "some". */
	effort?: ReasoningEffort
	resumeSessionId?: string
	title?: string
	/** Prepended to the backend's own system prompt (foundations, rules, assets). */
	systemPrompt?: string
}

export type PermissionDecision = "allow" | "deny" | "allow-always"

export interface SendInput {
	text: string
	/** Data URLs. The overlay editor sends screenshots this way. */
	images?: string[]
}

export type BackendEvent =
	/**
	 * Replay only. A live turn never emits this — the caller already knows what it
	 * sent — but rehydrating an old session has to put the user's own turns back
	 * or the transcript reads as the agent talking to itself.
	 */
	| { type: "user-message"; text: string }
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool-start"; callId: string; name: string; summary: string }
	| { type: "tool-end"; callId: string; name: string; ok: boolean; summary?: string }
	| { type: "file-changed"; path: string }
	| { type: "permission"; requestId: string; tool: string; path?: string; summary: string }
	/**
	 * The backend settled a permission by a path that never went through Caret —
	 * its own config allowed it, a timeout rejected it. Without this, the ask
	 * stays on screen as live buttons while the agent visibly moves on: a ghost
	 * request nobody can act on.
	 */
	| { type: "permission-resolved"; requestId: string; allowed: boolean }
	| { type: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number }
	| { type: "done"; text: string }
	| { type: "error"; message: string; recoverable: boolean }

export interface BackendSession {
	readonly id: string
	readonly mode: SessionMode
	/** Streams normalised events until the turn finishes. */
	send(input: SendInput): AsyncIterable<BackendEvent>
	respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>
	/** Idempotent. */
	abort(): Promise<void>
	close(): Promise<void>
}

export interface StructuredRequest {
	/** Where the work happens — the backend may still read the project. */
	workingDirectory: string
	prompt: string
	/** JSON Schema. Enums in it are the anti-slop floor: a model cannot answer outside them. */
	schema: Record<string, unknown>
	model?: string
	effort?: ReasoningEffort
	systemPrompt?: string
}

export interface StructuredResult<T> {
	value: T
	/**
	 * True when the backend has no native schema-constrained mode and the result
	 * came from prompt-and-parse. Callers must treat their own post-validation as
	 * load-bearing in that case — schema-valid is a weaker guarantee here.
	 */
	emulated: boolean
}

/** Why a backend can or cannot be used, in terms the setup screen can render. */
export interface AvailabilityReport {
	id: BackendId
	displayName: string
	/** The executable/SDK is present. */
	installed: boolean
	/** Credentials are present and usable. */
	authenticated: boolean
	/** Installed and authenticated — the only state in which sessions start. */
	ready: boolean
	/** One line the user reads. Never a stack trace. */
	detail: string
	permissionModel: PermissionModel
	providerName: string
	/** What to do about it, when it is not ready. */
	remedy?: { label: string; command?: string; url?: string }
	/**
	 * Written to spec but never exercised against a live subscription. Shown as
	 * such rather than presented as equally proven.
	 */
	untested?: boolean
}

export interface CodingBackend {
	readonly id: BackendId
	readonly displayName: string
	/**
	 * Who serves this backend's models when their ids do not say so themselves.
	 * OpenCode's ids are already `provider/model`; Claude's are bare.
	 */
	readonly providerName: string
	readonly permissionModel: PermissionModel
	availability(): Promise<AvailabilityReport>
	startSession(options: StartSessionOptions): Promise<BackendSession>
	/** One-shot, JSON-schema-constrained. Carries the interview and recipe narrowing. */
	structured<T>(request: StructuredRequest): Promise<StructuredResult<T>>
	/**
	 * Models this backend can reach, grouped by provider.
	 *
	 * Optional because not every backend can answer it — Codex has no
	 * enumeration API at all — and a made-up list is worse than none. Absent
	 * means the UI asks the user to type an id.
	 */
	listModels?(): Promise<ModelGroup[]>
	/** Sessions previously run in this project, newest first. */
	listSessions?(workingDirectory: string): Promise<BackendSessionSummary[]>
	/**
	 * An old session replayed as the same events a live one emits, so the chat is
	 * rebuilt by the reducer that built it the first time rather than by a second
	 * implementation that can disagree with it.
	 */
	readTranscript?(workingDirectory: string, sessionId: string): Promise<BackendEvent[]>
	/** Releases any process or connection the adapter is holding. */
	dispose?(): Promise<void>
}

export interface BackendSessionSummary {
	id: string
	title: string
	updatedAt: number
}

/** Features that need a backend, for the refusal message. */
export type BackendFeature = "sync" | "visual-edit" | "flow-sync" | "interview" | "chat"

const NO_BACKEND_MESSAGE: Record<BackendFeature, string> = {
	sync: "Syncing the design into your app needs a coding backend. Open Settings → Backend to use the one bundled with Caret, or connect the agent you already pay for.",
	"visual-edit":
		"Describing a change in words needs a coding backend. Open Settings → Backend to set one up. Direct edits — text, colour, images — keep working without it.",
	"flow-sync":
		"Updating page navigation to match the flow needs a coding backend. Open Settings → Backend to set one up. The flow file itself has been updated either way.",
	interview:
		"The interview runs without a backend — it just loses the reasoning behind each recommendation. Open Settings → Backend to get it back.",
	chat: "Chat needs a coding backend. Open Settings → Backend to use the one bundled with Caret, or connect the agent you already pay for.",
}

/**
 * No backend is configured, or the configured one is not ready.
 *
 * The message names the fix per feature. "No backend configured" on its own
 * tells nobody what to do, and pointing at MCP would be actively wrong: an
 * external agent connected over MCP enables none of these, because MCP cannot
 * carry work outwards.
 */
export class NoBackendError extends Error {
	constructor(
		readonly feature: BackendFeature,
		detail?: string,
	) {
		super(detail ? `${NO_BACKEND_MESSAGE[feature]} (${detail})` : NO_BACKEND_MESSAGE[feature])
		this.name = "NoBackendError"
	}
}

/** A backend refused, or died mid-turn. Distinct from "there is no backend". */
export class BackendError extends Error {
	constructor(
		message: string,
		readonly recoverable = true,
	) {
		super(message)
		this.name = "BackendError"
	}
}

/** The model answered, but not with something the schema allows. */
export class StructuredOutputError extends BackendError {
	constructor(detail: string) {
		super(`The model did not produce a valid answer: ${detail}`, true)
		this.name = "StructuredOutputError"
	}
}

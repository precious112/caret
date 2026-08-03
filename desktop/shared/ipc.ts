/**
 * The IPC contract between the Electron main process and the app-chrome renderer.
 *
 * This replaces the extension↔webview gRPC-over-message-passing layer, which
 * existed only to cross the VS Code webview boundary. Electron IPC crosses the
 * same boundary natively, so the entire `proto/` + generated-client apparatus is
 * gone and this file is the whole interface.
 *
 * Types here are declared locally rather than imported from `src/core/design`.
 * That is deliberate: the design core is main-process code that touches the
 * filesystem and spawns processes, and a renderer that can `import` it is a
 * renderer that can be made to run it. Keeping the wire types structural means
 * the boundary is enforced by what is importable, not by remembering not to.
 */

/** Mirrors `FoundationTokens` in the design core. */
export interface FoundationTokensWire {
	vibe: { description: string; tags: string[] }
	color: {
		brand: { seed: string; scale: Record<string, string> }
		neutral: { character: string; scale: Record<string, string> }
		semantic: { success: string; warning: string; error: string; info: string }
	}
	typography: {
		fontFamily: string
		fallback: string
		scaleRatio: number
		baseSize: number
		scale: Record<string, number | string>
	}
	spacing: { baseUnit: number; scale: number[] }
	radius: { character: string; scale: number[] }
}

/** Mirrors `PageMeta` in the design core. */
export interface PageMetaWire {
	id: string
	title: string
	type: string
	states: string[]
	tags: string[]
}

/** Canvas → host, forwarded by the chrome. Mirrors `DesignInboundMessage`. */
export interface DesignInboundWire {
	source: "caret-vite"
	type: string
	payload: Record<string, unknown>
}

/** Host → canvas. Mirrors `DesignOutboundMessage`. */
export interface DesignOutboundWire {
	source: "caret-host"
	type: string
	payload: Record<string, unknown>
}

export interface ProjectSummary {
	/** Absolute path of the project root. */
	path: string
	/** Directory name, used as the display name. */
	name: string
	/** False when the path no longer exists on disk. */
	exists: boolean
	/** Whether the project already has a `.caret/` design layer. */
	hasDesignLayer: boolean
}

export interface ProjectState {
	path: string
	name: string
	/** Vite URL for the canvas, or null while booting / after a crash. */
	canvasUrl: string | null
	/** MCP endpoint an agent should be pointed at, or null if the server is down. */
	mcpUrl: string | null
	/** Whether an agent is currently connected over MCP. */
	agentConnected: boolean
	/** Whether foundation tokens have been set (gates the onboarding prompt). */
	hasFoundation: boolean
}

export type NotificationLevel = "info" | "warn" | "error"

export interface NotificationRequest {
	id: string
	level: NotificationLevel
	message: string
	actions: string[]
}

export interface AgentClientConfig {
	/** Display name, e.g. "Claude Code". */
	client: string
	/** What the user runs, or the file they paste into. */
	instruction: string
	/** The config snippet itself. */
	snippet: string
	/** Where the snippet goes, when it is a file. */
	targetPath?: string
}

/** A candidate rendered as something to look at, never as a list of values. */
export interface PresentedCandidateWire {
	id: string
	name: string
	summary: string
	fontUrl: string
	displayFamily: string
	displayFallback: string
	bodyFamily: string
	bodyFallback: string
	surface: "light" | "dark"
	brandColor: string
	neutralCharacter: string
	radius: number[]
	baseSize: number
}

export type InterviewPromptWire =
	| { kind: "question"; id: string; question: string; hint?: string; choices: string[]; step?: number; total?: number }
	| {
			kind: "options"
			id: string
			title: string
			subtitle?: string
			candidates: PresentedCandidateWire[]
			step?: number
			total?: number
	  }

/**
 * The coding backend Caret drives, as the renderer sees it.
 *
 * Structural mirrors of the core types, like every other `*Wire` here, so a
 * renderer import of main-process code stays a compile error.
 */
export type BackendIdWire = "opencode" | "claude" | "codex" | "kimi"

export interface BackendReportWire {
	id: BackendIdWire
	displayName: string
	installed: boolean
	authenticated: boolean
	ready: boolean
	detail: string
	remedy?: { label: string; command?: string; url?: string }
	untested?: boolean
}

export type TranscriptEntryWire =
	| { kind: "user"; id: string; text: string }
	| { kind: "assistant"; id: string; text: string }
	| { kind: "thinking"; id: string; text: string }
	| { kind: "tool"; id: string; callId: string; name: string; summary: string; status: "running" | "ok" | "failed" }
	| {
			kind: "permission"
			id: string
			requestId: string
			summary: string
			status: "pending" | "allowed" | "denied"
			automatic?: string
	  }
	| { kind: "error"; id: string; message: string }
	| { kind: "note"; id: string; text: string }

export interface AgentStateWire {
	backendId: BackendIdWire | null
	backendName: string | null
	ready: boolean
	blocked: string | null
	activity: { id: string; kind: string; title: string; mode: "read-only" | "write"; sessionId: string } | null
	streaming: boolean
	transcript: {
		entries: TranscriptEntryWire[]
		files: string[]
		usage: { inputTokens: number; outputTokens: number; costUsd: number }
	}
	pendingApproval: { id: string; question: string; confirmLabel: string; cancelLabel: string } | null
	appWrites: "ask" | "allow"
}

export interface AgentSessionWire {
	id: string
	title: string
	updatedAt: number
}

export interface SyncOutcome {
	status: string
	message: string
}

export interface WriteResult {
	ok: boolean
	error?: string
}

export interface FontOptionWire {
	family: string
	category: string
	variants: string[]
}

/**
 * An asset as the renderer sees it.
 *
 * A structural mirror rather than the core type, like every other `*Wire` here,
 * so a renderer import of main-process code stays a compile error.
 */
export interface AssetEntryWire {
	tag: string
	file: string
	url: string
	kind: "image" | "vector" | "video" | "model"
	mime: string
	width: number | null
	height: number | null
	bytes: number
	alt: string
	description: string
	origin: string
	addedAt: string
}

export interface AssetAddResult {
	added: string[]
	/** Files that could not be added, each with a reason the user can act on. */
	rejected: Array<{ file: string; reason: string }>
}

/** Renderer → main. Each entry is an `ipcRenderer.invoke` channel. */
export interface IpcRequests {
	"project:pickFolder": () => string | null
	"project:open": (projectPath: string) => ProjectState | null
	"project:close": (projectPath: string) => void
	"project:recents": () => ProjectSummary[]
	"project:forgetRecent": (projectPath: string) => void
	"project:state": (projectPath: string) => ProjectState | null

	"tokens:read": (projectPath: string) => FoundationTokensWire | null
	"tokens:write": (projectPath: string, tokens: FoundationTokensWire) => WriteResult
	"tokens:generateScale": (
		type: "color" | "typography" | "spacing" | "radius",
		seed: string,
		options?: Record<string, unknown>,
	) => Record<string, string>
	"fonts:search": (query: string) => FontOptionWire[]

	"pages:list": (projectPath: string) => PageMetaWire[]

	"assets:list": (projectPath: string) => AssetEntryWire[]
	/**
	 * Copies files into `.caret/assets/`. Paths come from a drop or a native
	 * dialog, so main does the copying — the renderer never touches the disk.
	 */
	"assets:add": (projectPath: string, sourcePaths: string[]) => AssetAddResult
	"assets:retag": (projectPath: string, from: string, to: string) => WriteResult
	"assets:describe": (projectPath: string, tag: string, fields: { alt?: string; description?: string }) => WriteResult
	"assets:remove": (projectPath: string, tag: string) => WriteResult
	/** Opens a native file picker filtered to supported asset types. */
	"assets:pickFiles": () => string[]

	"sync:now": (projectPath: string) => SyncOutcome
	"sync:rollback": (projectPath: string) => SyncOutcome
	"sync:markSynced": (projectPath: string) => SyncOutcome

	"agent:clientConfigs": (projectPath: string) => AgentClientConfig[]

	/** Everything the chat sidebar renders. Also pushed on the `agent:state` event. */
	"agent:state": (projectPath: string) => AgentStateWire | null
	"agent:send": (projectPath: string, text: string) => void
	"agent:abort": (projectPath: string) => void
	"agent:permission": (projectPath: string, requestId: string, decision: "allow" | "deny" | "allow-always") => void
	"agent:approval": (projectPath: string, id: string, ok: boolean) => void
	"agent:reset": (projectPath: string) => void
	/** Availability of every backend, for the setup screen. Probed live. */
	"agent:backends": () => BackendReportWire[]
	"agent:selectBackend": (id: BackendIdWire | null) => void
	"agent:sessions": (projectPath: string) => AgentSessionWire[]
	"agent:replay": (projectPath: string, sessionId: string) => boolean

	"prefs:get": () => Record<string, unknown>
	"prefs:set": (patch: Record<string, unknown>) => void

	"canvas:message": (projectPath: string, message: DesignInboundWire) => void
	/**
	 * How much room the chrome occupies around the canvas view.
	 *
	 * Layout authority stays in the renderer, which is the only place that knows
	 * how tall the top bar is or whether the chat sidebar is open — main cannot
	 * measure a DOM it does not own.
	 */
	"canvas:setBounds": (projectPath: string, insets: { top: number; right: number }) => void
	/** Parks the canvas off-screen while the chrome shows a full-window surface. */
	"canvas:setVisible": (projectPath: string, visible: boolean) => void

	/** Answers a `notify` prompt raised by main. */
	"notification:respond": (id: string, action: string | null) => void
	/** Answers an interview question or option set. Null means the user skipped. */
	"interview:respond": (id: string, answer: string | null) => void
	/** The full curated library, for the no-agent path. */
	"interview:library": () => unknown
	/** Whatever prompt is waiting, so a late-mounting renderer can recover it. */
	"interview:pending": () => InterviewPromptWire | null
}

/** Main → renderer. Each entry is an `ipcRenderer.on` channel. */
export interface IpcEvents {
	"project:stateChanged": (state: ProjectState) => void
	"canvas:message": (projectPath: string, message: DesignOutboundWire) => void
	"notification:show": (request: NotificationRequest) => void
	"interview:prompt": (prompt: InterviewPromptWire) => void
	/** The asset index changed — by the UI, an agent, or a file dropped in Finder. */
	"assets:changed": (projectPath: string) => void
	/** The chat moved on: a token streamed, a permission was raised, a turn ended. */
	"agent:state": (projectPath: string, state: AgentStateWire) => void
	log: (line: string) => void
}

export type IpcRequestChannel = keyof IpcRequests
export type IpcEventChannel = keyof IpcEvents

/** The API the preload script exposes on `window.caret`. */
export interface CaretBridge {
	invoke<C extends IpcRequestChannel>(
		channel: C,
		...args: Parameters<IpcRequests[C]>
	): Promise<Awaited<ReturnType<IpcRequests[C]>>>
	on<C extends IpcEventChannel>(channel: C, listener: IpcEvents[C]): () => void
	platform: NodeJS.Platform
}

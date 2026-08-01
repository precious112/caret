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
	bodyFamily: string
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

	"sync:now": (projectPath: string) => SyncOutcome
	"sync:rollback": (projectPath: string) => SyncOutcome
	"sync:markSynced": (projectPath: string) => SyncOutcome

	"agent:clientConfigs": (projectPath: string) => AgentClientConfig[]

	"prefs:get": () => Record<string, unknown>
	"prefs:set": (patch: Record<string, unknown>) => void

	"canvas:message": (projectPath: string, message: DesignInboundWire) => void
	/** Height of the chrome's top bar, so main knows where to put the canvas view. */
	"canvas:setBounds": (projectPath: string, inset: number) => void
	/** Parks the canvas off-screen while the chrome shows a full-window surface. */
	"canvas:setVisible": (projectPath: string, visible: boolean) => void

	/** Answers a `notify` prompt raised by main. */
	"notification:respond": (id: string, action: string | null) => void
	/** Answers an interview question or option set. Null means the user skipped. */
	"interview:respond": (id: string, answer: string | null) => void
	/** The full curated library, for the no-agent path. */
	"interview:library": () => unknown
}

/** Main → renderer. Each entry is an `ipcRenderer.on` channel. */
export interface IpcEvents {
	"project:stateChanged": (state: ProjectState) => void
	"canvas:message": (projectPath: string, message: DesignOutboundWire) => void
	"notification:show": (request: NotificationRequest) => void
	"agent:task": (task: { kind: string; prompt: string }) => void
	"interview:prompt": (prompt: InterviewPromptWire) => void
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

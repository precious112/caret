/**
 * The outbound boundary: work Caret starts and hands to an agent.
 *
 * Caret used to call `controller.initTask(prompt)` in four places — design→app
 * sync, visual AI edits, the overlay editor, and flow-restructure nav sync. Each
 * is now an outbound request on this interface.
 *
 * **There is no MCP implementation of this, and there cannot be one.** MCP is
 * client-initiated: a server can hold a tool call open for minutes, but it
 * cannot start one, and every caller above begins with the user clicking
 * something in Caret's window. An earlier version queued these tasks for an
 * agent to collect and nothing ever collected them, so sync and visual edits
 * silently did nothing whenever an agent was connected — worse than refusing.
 *
 * Until the Phase 6.4 backend lands, the only implementation is `NullBridge`,
 * which refuses with a per-feature explanation. That is a supported state, not
 * an error path: running Caret without a backend is fine, and every feature that
 * needs one has to say so plainly rather than appearing to work.
 */
export type AgentTaskKind = "sync" | "visual-edit" | "flow-sync"

export interface AgentTask {
	kind: AgentTaskKind
	/** The fully built prompt. Prompt construction stays in the design core. */
	prompt: string
	/** Data-URL images (overlay-editor screenshots). */
	images?: string[]
	/** Kind-specific structured context, echoed to the agent alongside the prompt. */
	context?: Record<string, unknown>
}

export interface AgentBridge {
	/** Whether an agent is currently connected and able to accept work. */
	connected(): boolean
	/**
	 * Hands a task to the connected agent. Resolves once the task has been
	 * *accepted* — not once the agent has finished it, which Caret cannot observe
	 * for an agent it does not own.
	 *
	 * Rejects with {@link NoAgentConnectedError} when nothing is connected.
	 */
	request(task: AgentTask): Promise<void>
}

export class NoAgentConnectedError extends Error {
	constructor(kind: AgentTaskKind) {
		super(NO_AGENT_MESSAGE[kind])
		this.name = "NoAgentConnectedError"
	}
}

/**
 * What the user sees when they ask for something that needs a backend.
 *
 * Phrased per feature, because "no agent connected" on its own does not tell
 * anyone what to do about it — and pointing at MCP would be actively wrong:
 * connecting an external agent over MCP does not enable any of these, because
 * MCP cannot carry work outwards. Until Phase 6.4 ships a backend these refuse
 * unconditionally, and saying so is the honest state.
 */
const NO_AGENT_MESSAGE: Record<AgentTaskKind, string> = {
	sync: "Syncing the design into your app needs Caret's coding backend, which isn't wired up yet. In the meantime, tell your own agent to sync — it can read the worklist over MCP.",
	"visual-edit":
		"Describing a change in words needs Caret's coding backend, which isn't wired up yet. Direct edits — text, colour, images — keep working without it.",
	"flow-sync":
		"Updating page navigation to match the flow needs Caret's coding backend, which isn't wired up yet. The flow file itself has been updated either way.",
}

/** Refuses every request, with an explanation. The only implementation until Phase 6.4. */
export class NullBridge implements AgentBridge {
	connected(): boolean {
		return false
	}

	async request(task: AgentTask): Promise<void> {
		throw new NoAgentConnectedError(task.kind)
	}
}

// Bridges are looked up per project — see `services.ts`. Each open project has
// its own MCP server, so each has its own agent connection state.

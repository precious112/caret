/**
 * The boundary where Caret stops owning the agent.
 *
 * Caret used to call `controller.initTask(prompt)` in four places — design→app
 * sync, visual AI edits, the overlay editor, and flow-restructure nav sync. Each
 * of those now becomes an outbound request on this interface, so the agent is a
 * dependency the user chooses rather than something Caret bundles.
 *
 * Two implementations ship: `McpBridge` surfaces the task to whichever agent is
 * connected over the local MCP server, and `NullBridge` refuses honestly. The
 * `NullBridge` case is not an error path — running Caret with no agent connected
 * is a supported state, and every feature that needs one must say so plainly
 * rather than silently doing nothing.
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
 * What the user sees when they ask for something that needs an agent and none is
 * connected. Phrased per feature, because "no agent connected" on its own does
 * not tell someone what to do about it.
 */
const NO_AGENT_MESSAGE: Record<AgentTaskKind, string> = {
	sync: "Syncing the design into your app needs a connected agent. Connect one from Caret's agent settings, then try again.",
	"visual-edit":
		"Describing a change in words needs a connected agent. Connect one from Caret's agent settings — direct edits (text, colour, images) keep working without it.",
	"flow-sync":
		"Updating page navigation to match the flow needs a connected agent. The flow file itself has been updated either way.",
}

/** Refuses every request, with an explanation. The default until an agent connects. */
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

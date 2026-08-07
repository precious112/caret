/**
 * One project's coding backend, wired to its window.
 *
 * The design core owns the conversation and the permission rules; this is the
 * host half — where the backend comes from (preferences), what the system prompt
 * says (the project's own foundations), and where state goes (the chrome
 * renderer).
 *
 * Backend selection is deliberately **lazy and re-checked**: a user can install
 * a CLI, sign in, or change their mind between two turns, and a backend resolved
 * once at window open would keep refusing long after the reason was fixed.
 */
import {
	AgentConversation,
	type AppWritePolicy,
	BackendBridge,
	type CodingBackend,
	type ConversationState,
	EditLaneBridge,
	type EditStatus,
	getBackend,
	setProjectBridge,
	setProjectConversation,
	setProjectEditLane,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { getPrefs, setPref } from "./prefs"
import { buildGuide } from "./rules/context"

export interface AgentServiceOptions {
	projectPath: string
	/** Pushes conversation state to the chrome renderer. */
	onState(state: ConversationState): void
	/** Narrates canvas-initiated edits to the canvas pill. */
	onEditStatus(status: EditStatus): void
}

export class AgentService {
	readonly conversation: AgentConversation
	/**
	 * Canvas-initiated edits, on their own conversation.
	 *
	 * Sharing the chat's conversation coupled the surfaces at their worst points:
	 * an AI edit mid-chat wiped the sidebar transcript (run() clears it on
	 * activity-kind change), and an edit's only live feedback lived in a panel
	 * the user wasn't looking at. The lanes share the backend, the permission
	 * rules, provenance and the session record — and no UI.
	 */
	private readonly editConversation: AgentConversation
	readonly editLane: EditLaneBridge

	constructor(private readonly options: AgentServiceOptions) {
		this.conversation = new AgentConversation({
			projectPath: options.projectPath,
			resolveBackend: () => this.resolveBackend(),
			model: () => getPrefs().backendModel || undefined,
			effort: () => getPrefs().backendEffort || undefined,
			appWrites: () => this.appWrites(),
			setAppWrites: (policy) => this.setAppWrites(policy),
			systemPrompt: () => this.systemPrompt(),
			onChange: (state) => options.onState(state),
		})

		this.editLane = new EditLaneBridge(
			() => this.editConversation,
			() => this.conversation.getState().ready,
			(status) => options.onEditStatus(status),
		)
		this.editConversation = new AgentConversation({
			projectPath: options.projectPath,
			resolveBackend: () => this.resolveBackend(),
			model: () => getPrefs().backendModel || undefined,
			effort: () => getPrefs().backendEffort || undefined,
			appWrites: () => this.appWrites(),
			setAppWrites: (policy) => this.setAppWrites(policy),
			systemPrompt: () => this.systemPrompt(),
			onChange: (state) => this.editLane.handleState(state),
		})

		// The bridge is what every outbound feature already calls. Swapping the
		// implementation here is the whole of "route AgentBridge through the
		// backend" — no call site changes.
		setProjectBridge(options.projectPath, new BackendBridge(this.conversation, () => this.conversation.getState().ready))
		setProjectConversation(options.projectPath, this.conversation)
		setProjectEditLane(options.projectPath, this.editLane)
	}

	async start(): Promise<void> {
		await this.conversation.refreshBackend()
	}

	async close(): Promise<void> {
		await this.conversation.close()
		await this.editConversation.close()
	}

	/**
	 * The configured backend, but only if it is actually ready.
	 *
	 * A backend that is installed and signed out is not a backend: returning it
	 * would turn a clear "sign in with this command" into a failed turn three
	 * minutes later.
	 */
	private async resolveBackend(): Promise<CodingBackend | null> {
		const id = getPrefs().backendId
		if (!id) return null

		const backend = getBackend(id)
		try {
			const report = await backend.availability()
			return report.ready ? backend : null
		} catch (err) {
			Logger.warn(`[agent] ${id} availability check failed: ${err}`)
			return null
		}
	}

	private appWrites(): AppWritePolicy {
		return getPrefs().appWritesAllowed.includes(this.options.projectPath) ? "allow" : "ask"
	}

	private async setAppWrites(policy: AppWritePolicy): Promise<void> {
		const current = getPrefs().appWritesAllowed
		const next =
			policy === "allow"
				? [...new Set([...current, this.options.projectPath])]
				: current.filter((path) => path !== this.options.projectPath)
		await setPref("appWritesAllowed", next)
	}

	/**
	 * Foundations, authoring rules and the asset index, straight into the system
	 * prompt.
	 *
	 * This is the capability BYO-agent could never have. The generated rules files
	 * still exist for external agents, but an agent Caret owns is not asked to
	 * *choose* to read them — the one failure mode that made pull-only context
	 * useless in the first place.
	 *
	 * Rebuilt per turn rather than cached: a token change between two turns has to
	 * reach the next one, and the build is a handful of small file reads.
	 */
	private async systemPrompt(): Promise<string | undefined> {
		try {
			return await buildGuide(this.options.projectPath, "embedded")
		} catch (err) {
			Logger.warn(`[agent] could not build the system prompt: ${err}`)
			return undefined
		}
	}
}

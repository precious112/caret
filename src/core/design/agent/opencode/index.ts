/**
 * The OpenCode adapter — the reference implementation of {@link CodingBackend}.
 *
 * Ships bundled and pinned so that connecting a provider is the *only* step —
 * there is never an install to do first. It still needs one: a key, a
 * subscription, or whatever the backend itself offers. Everything here is
 * written against the shapes in
 * `protocol.ts`, which were pinned from the running binary's own OpenAPI
 * document rather than from the published SDK (see that file for why).
 *
 * Caret answers every permission request itself — see `../permissions.ts`. The
 * server config below asks about *everything* that touches the world so that
 * nothing is ever decided behind Caret's back; the `plan` agent on read-only
 * sessions is a second line, not the boundary.
 */
import { Logger } from "@/shared/services/Logger"
import {
	type AvailabilityReport,
	type BackendEvent,
	type BackendSession,
	type BackendSessionSummary,
	type CodingBackend,
	type ModelGroup,
	type PermissionDecision,
	type SendInput,
	type StartSessionOptions,
	StructuredOutputError,
	type StructuredRequest,
	type StructuredResult,
} from "../backend"
import { resolveOpencodeBinary } from "./binary"
import { openEventStream, request } from "./http"
import type {
	OpencodeConfig,
	OpencodeEvent,
	OpencodeFileDiff,
	OpencodePart,
	OpencodePermissionReply,
	OpencodePromptResponse,
	OpencodeProvidersResponse,
	OpencodeSession,
	OpencodeToolState,
} from "./protocol"
import { STRUCTURED_OUTPUT_TOOL } from "./protocol"
import { ensureOpencodeServer, type RunningServer, stopOpencodeServer } from "./server"

/**
 * Passed inline via `OPENCODE_CONFIG_CONTENT`.
 *
 * Caret never writes `~/.config/opencode/*`. The user's own config and
 * credentials are still read by the binary, so an existing signed-in account is
 * picked up without a second login; this only layers Caret's requirements on
 * top.
 */
const CARET_SERVER_CONFIG: OpencodeConfig = {
	// Everything that can change the world asks. Reads do not — a plan phase that
	// prompted on every file read would be unusable, and reading is not the risk.
	permission: {
		edit: "ask",
		bash: "ask",
		webfetch: "ask",
		external_directory: "ask",
	},
	logLevel: "WARN",
}

const DECISION_TO_REPLY: Record<PermissionDecision, OpencodePermissionReply> = {
	allow: "once",
	"allow-always": "always",
	deny: "reject",
}

/** Tools whose input names a file Caret should show in the change list. */
const FILE_TOOLS = new Set(["edit", "write", "patch", "multiedit"])

export class OpencodeBackend implements CodingBackend {
	readonly id = "opencode" as const
	readonly providerName = "OpenCode"
	readonly permissionModel = "ask" as const
	readonly displayName = "OpenCode (bundled)"

	async availability(): Promise<AvailabilityReport> {
		const base = {
			id: this.id,
			displayName: this.displayName,
			permissionModel: this.permissionModel,
			providerName: this.providerName,
		} as const

		const binary = resolveOpencodeBinary()
		if (!binary) {
			return {
				...base,
				installed: false,
				authenticated: false,
				ready: false,
				detail: "The bundled backend is missing from this build.",
				remedy: { label: "Reinstall Caret", url: "https://github.com/precious112/caret/releases" },
			}
		}

		try {
			const server = await this.server()
			const providers = await request<OpencodeProvidersResponse>(server, "/config/providers")
			const names = providers.providers.map((p) => p.name ?? p.id)

			if (names.length === 0) {
				return {
					...base,
					installed: true,
					authenticated: false,
					ready: false,
					detail: "No model provider is reachable. Add your own API key, or sign in to OpenCode.",
					remedy: { label: "OpenCode sign-in", url: "https://opencode.ai/docs/providers" },
				}
			}

			return {
				...base,
				installed: true,
				authenticated: true,
				ready: true,
				detail: `Ready — ${names.join(", ")}.`,
			}
		} catch (err) {
			return {
				...base,
				installed: true,
				authenticated: false,
				ready: false,
				detail: err instanceof Error ? err.message : String(err),
			}
		}
	}

	async startSession(options: StartSessionOptions): Promise<BackendSession> {
		const server = await this.server()

		let id = options.resumeSessionId
		if (!id) {
			const created = await request<OpencodeSession>(server, "/session", {
				method: "POST",
				query: { directory: options.workingDirectory },
				body: { title: options.title ?? "Caret" },
			})
			id = created.id
		}

		return new OpencodeSessionHandle(server, id, options)
	}

	/**
	 * One-shot with a JSON Schema.
	 *
	 * Native first: the server forces a `StructuredOutput` tool call whose input
	 * *is* the object, so nothing is parsed out of prose and an id outside the
	 * schema's enum never reaches Caret.
	 *
	 * Falls back to prompt-and-parse, flagged `emulated`, because the native path
	 * is a **model** capability rather than a server one — a reasoning model that
	 * cannot be given a forced tool choice, or a provider whose speculative
	 * decoding has no grammar support, both fail at the provider with a message
	 * only that provider understands. Both were observed on the bundled backend's
	 * own free models. Degrading to a weaker guarantee beats a caller that works
	 * on some models and not others, and the flag is how the caller knows its own
	 * post-validation just became load-bearing.
	 */
	async structured<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
		try {
			return { value: await this.promptForJson<T>(req, true), emulated: false }
		} catch (err) {
			Logger.warn(`[backend] native structured output failed, emulating: ${err}`)
			return { value: await this.promptForJson<T>(req, false), emulated: true }
		}
	}

	private async promptForJson<T>(req: StructuredRequest, native: boolean): Promise<T> {
		const server = await this.server()
		const created = await request<OpencodeSession>(server, "/session", {
			method: "POST",
			query: { directory: req.workingDirectory },
			body: { title: "Caret — structured" },
		})

		try {
			const response = await request<OpencodePromptResponse>(server, `/session/${created.id}/message`, {
				method: "POST",
				query: { directory: req.workingDirectory },
				body: {
					parts: [{ type: "text", text: native ? req.prompt : emulationPrompt(req) }],
					...(req.systemPrompt ? { system: req.systemPrompt } : {}),
					...(modelRef(req.model) ?? {}),
					...(native ? { format: { type: "json_schema", schema: req.schema } } : {}),
					// The model is answering a question, not doing work. Every tool it
					// could reach for here is a way to spend minutes and get it wrong.
					tools: { bash: false, edit: false, write: false, webfetch: false },
				},
			})

			if (response.info.error) {
				throw new StructuredOutputError(response.info.error.data?.message ?? response.info.error.name)
			}

			if (native) {
				const part = response.parts.find((p) => p.type === "tool" && p.tool === STRUCTURED_OUTPUT_TOOL)
				const value = part && "state" in part ? (part.state as OpencodeToolState).input : undefined
				if (!value) throw new StructuredOutputError("it returned no structured answer at all")
				return value as T
			}

			const text = response.parts
				.filter((p): p is Extract<OpencodePart, { type: "text" }> => p.type === "text")
				.map((p) => p.text)
				.join("")
			return parseJsonAnswer<T>(text)
		} finally {
			await request(server, `/session/${created.id}`, {
				method: "DELETE",
				query: { directory: req.workingDirectory },
			}).catch(() => {})
		}
	}

	/**
	 * Every provider the running server can reach, with its models.
	 *
	 * Ids carry the provider (`opencode-go/gpt-5.6-luna`) because that is what the
	 * prompt route wants, and because it is the only way the free tier and the
	 * paid one stay distinguishable once a model is chosen.
	 */
	async listModels(): Promise<ModelGroup[]> {
		const server = await this.server()
		const providers = await request<OpencodeProvidersResponse>(server, "/config/providers")

		return providers.providers
			.map((provider) => ({
				providerId: provider.id,
				providerName: provider.name ?? provider.id,
				models: Object.entries(provider.models ?? {})
					.map(([id, model]) => ({
						id: `${provider.id}/${id}`,
						label: model.name ?? id,
						free: model.cost?.input === 0 && model.cost?.output === 0,
					}))
					.sort((a, b) => a.label.localeCompare(b.label)),
			}))
			.filter((group) => group.models.length > 0)
	}

	async listSessions(workingDirectory: string): Promise<BackendSessionSummary[]> {
		const server = await this.server()
		const sessions = await request<OpencodeSession[]>(server, "/session", { query: { directory: workingDirectory } })
		return sessions
			.map((session) => ({
				id: session.id,
				title: session.title ?? "Untitled",
				updatedAt: session.time?.updated ?? session.time?.created ?? 0,
			}))
			.sort((a, b) => b.updatedAt - a.updatedAt)
	}

	/**
	 * An old session as the events a live one would have emitted.
	 *
	 * Replaying through the same reducer that built the transcript live is the
	 * point: a history panel with its own parser is a second implementation that
	 * will eventually disagree with the first about what happened.
	 */
	async readTranscript(workingDirectory: string, sessionId: string): Promise<BackendEvent[]> {
		const server = await this.server()
		const messages = await request<Array<{ info: { id: string; role: string }; parts: OpencodePart[] }>>(
			server,
			`/session/${sessionId}/message`,
			{ query: { directory: workingDirectory } },
		)

		const events: BackendEvent[] = []
		for (const message of messages) {
			if (message.info.role === "user") {
				const text = message.parts
					.filter((part): part is Extract<OpencodePart, { type: "text" }> => part.type === "text")
					.map((part) => part.text)
					.join("")
				if (text.trim()) events.push({ type: "user-message", text })
				continue
			}

			// Assistant parts are already terminal here, so the live mapper's
			// suffix bookkeeping is exactly right: nothing was emitted before. The
			// message is announced first, as the live bus would have — the mapper
			// only maps parts of messages it has seen declared as the assistant's.
			const mapper = new EventMapper(sessionId)
			events.push(
				...mapper.map({
					type: "message.updated",
					properties: { sessionID: sessionId, info: { id: message.info.id, role: "assistant" } },
				}),
			)
			for (const part of message.parts) {
				events.push(...mapper.map({ type: "message.part.updated", properties: { sessionID: sessionId, part } }))
			}
		}
		return events
	}

	async dispose(): Promise<void> {
		await stopOpencodeServer()
	}

	private server(): Promise<RunningServer> {
		return ensureOpencodeServer(CARET_SERVER_CONFIG)
	}
}

/** The emulated path's instruction. Deliberately blunt — it is read by weaker models. */
function emulationPrompt(req: StructuredRequest): string {
	return [
		req.prompt,
		"",
		"Reply with a single JSON object and nothing else — no prose, no explanation, no code fence.",
		"It must satisfy this JSON Schema exactly, including every `enum`:",
		JSON.stringify(req.schema),
	].join("\n")
}

/**
 * Pulls the object out of a reply that may be wrapped in a fence or padded with
 * a sentence. Balanced-brace scanning rather than a regex: the values contain
 * prose that itself contains braces.
 */
function parseJsonAnswer<T>(text: string): T {
	const start = text.indexOf("{")
	if (start === -1) throw new StructuredOutputError("it answered with no JSON at all")

	let depth = 0
	let inString = false
	let escaped = false

	for (let index = start; index < text.length; index++) {
		const character = text[index]
		if (escaped) {
			escaped = false
			continue
		}
		if (character === "\\") {
			escaped = true
			continue
		}
		if (character === '"') inString = !inString
		if (inString) continue
		if (character === "{") depth++
		if (character === "}" && --depth === 0) {
			try {
				return JSON.parse(text.slice(start, index + 1)) as T
			} catch (err) {
				throw new StructuredOutputError(`its JSON did not parse (${err})`)
			}
		}
	}
	throw new StructuredOutputError("its JSON was cut off before it closed")
}

/** `provider/model` split into the shape the prompt route wants. */
function modelRef(model: string | undefined): { model: { providerID: string; modelID: string } } | null {
	if (!model) return null
	const slash = model.indexOf("/")
	if (slash <= 0) return null
	return { model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) } }
}

class OpencodeSessionHandle implements BackendSession {
	private aborted = false

	constructor(
		private readonly server: RunningServer,
		readonly id: string,
		private readonly options: StartSessionOptions,
	) {}

	get mode() {
		return this.options.mode
	}

	/**
	 * Streams one turn.
	 *
	 * The event subscription opens *before* the prompt is posted. The other order
	 * has a window in which a fast tool call or an immediate permission request
	 * happens before anyone is listening, and the turn then appears to hang.
	 */
	async *send(input: SendInput): AsyncIterable<BackendEvent> {
		const controller = new AbortController()
		// `directory` is not optional in practice: the server keeps one instance —
		// and one event bus — per directory, so a subscription without it listens
		// to the server process's own working directory and never sees a single
		// event from this project's session.
		const events = await openEventStream<OpencodeEvent>(this.server, "/event", controller.signal, {
			directory: this.options.workingDirectory,
		})

		// The message id is the server's to assign, never Caret's. A client id was
		// tried here (`msg_caret_<uuid>`) to recognise the user's own message on
		// the bus, and it broke resumed sessions entirely: the server's agent loop
		// orders its queue by message id, ids it generates are ascending, and a
		// foreign id sorting *before* the previous turn's assistant messages looks
		// like already-processed history — the loop enters, finds "nothing newer",
		// and exits without ever running the model. An id sorting *after* them is
		// the mirror failure: the same prompt looks perpetually unprocessed and is
		// re-run forever. The mapper recognises the user's message by role instead.
		const mapper = new EventMapper(this.id)

		try {
			await request(this.server, `/session/${this.id}/prompt_async`, {
				method: "POST",
				query: { directory: this.options.workingDirectory },
				body: {
					parts: [
						{ type: "text", text: input.text },
						...(input.images ?? []).map((url, index) => ({
							type: "file" as const,
							mime: mimeOfDataUrl(url),
							filename: `screenshot-${index + 1}.png`,
							url,
						})),
					],
					...(this.options.systemPrompt ? { system: this.options.systemPrompt } : {}),
					...(modelRef(this.options.model) ?? {}),
					// The Plan agent is a second line of defence, never the boundary:
					// upstream subagents have been reported not to inherit it.
					...(this.options.mode === "read-only" ? { agent: "plan" } : {}),
				},
			})

			for await (const event of events) {
				for (const mapped of mapper.map(event)) {
					yield mapped
					if (mapped.type === "done") return
				}
			}
		} finally {
			controller.abort()
		}
	}

	async respondToPermission(requestId: string, decision: PermissionDecision): Promise<void> {
		await request(this.server, `/session/${this.id}/permissions/${requestId}`, {
			method: "POST",
			query: { directory: this.options.workingDirectory },
			body: { response: DECISION_TO_REPLY[decision] },
		}).catch((err) => {
			// A permission that has already been answered (by a timeout, or by the
			// turn ending) is not worth failing the whole turn over.
			Logger.warn(`[backend] permission reply for ${requestId} was refused: ${err}`)
		})
	}

	async abort(): Promise<void> {
		if (this.aborted) return
		this.aborted = true
		await request(this.server, `/session/${this.id}/abort`, {
			method: "POST",
			query: { directory: this.options.workingDirectory },
		}).catch(() => {})
	}

	async close(): Promise<void> {
		await this.abort()
	}

	/** Backend-side diff, used only to enrich Caret's own snapshot diff. */
	async diff(): Promise<OpencodeFileDiff[]> {
		return request<OpencodeFileDiff[]>(this.server, `/session/${this.id}/diff`, {
			query: { directory: this.options.workingDirectory },
		}).catch(() => [])
	}
}

/**
 * Server events → {@link BackendEvent}.
 *
 * Stateful because the server re-sends whole parts as they grow: text arrives as
 * a part that gets longer, not as deltas the chat can simply append. Emitting
 * only the suffix beyond what was already emitted makes the mapping idempotent,
 * which matters because the same part can be re-sent after a tool call.
 *
 * Parts are mapped only for messages the bus has announced as `role:
 * "assistant"` — the server emits `message.updated` before any of a message's
 * parts. The user's own prompt comes back over the same bus, and without this
 * the chat opens every turn by replaying it as if the model had said it.
 * Default-exclude, by role: anything not announced as the assistant's stays
 * off-screen, and no assumption is made about anyone's id scheme (see `send()`
 * for how a Caret-assigned id broke the server's queue ordering).
 *
 * Exported for its tests only.
 */
export class EventMapper {
	private emittedLength = new Map<string, number>()
	private toolStarted = new Set<string>()
	private toolFinished = new Set<string>()
	private assistantMessages = new Set<string>()

	constructor(private readonly sessionId: string) {}

	*map(event: OpencodeEvent): Iterable<BackendEvent> {
		return yield* this.mapEvent(event)
	}

	private *mapEvent(event: OpencodeEvent): Iterable<BackendEvent> {
		switch (event.type) {
			case "message.updated": {
				const properties = event.properties as { sessionID: string; info?: { id?: string; role?: string } }
				if (properties.sessionID !== this.sessionId) return
				const info = properties.info
				if (info?.role === "assistant" && info.id) this.assistantMessages.add(info.id)
				return
			}

			case "message.part.updated": {
				const properties = event.properties as { sessionID: string; part: OpencodePart }
				if (properties.sessionID !== this.sessionId) return
				if (!this.assistantMessages.has(properties.part.messageID)) return
				yield* this.mapPart(properties.part)
				return
			}

			case "permission.asked": {
				const permission = event.properties as {
					id: string
					sessionID: string
					permission: string
					patterns: string[]
				}
				if (permission.sessionID !== this.sessionId) return
				yield {
					type: "permission",
					requestId: permission.id,
					tool: permission.permission,
					path: permission.patterns?.[0],
					summary: permission.patterns?.length
						? `${permission.permission}: ${permission.patterns.join(", ")}`
						: permission.permission,
				}
				return
			}

			case "session.error": {
				const properties = event.properties as {
					sessionID?: string
					error?: { name?: string; data?: { message?: string } }
				}
				if (properties.sessionID && properties.sessionID !== this.sessionId) return
				const message = properties.error?.data?.message ?? properties.error?.name ?? "the backend reported an error"
				// An aborted turn is the user pressing stop, not a failure.
				if (properties.error?.name === "MessageAbortedError") {
					yield { type: "done", text: "" }
					return
				}
				yield { type: "error", message, recoverable: true }
				yield { type: "done", text: "" }
				return
			}

			case "session.idle": {
				const properties = event.properties as { sessionID: string }
				if (properties.sessionID !== this.sessionId) return
				yield { type: "done", text: "" }
				return
			}
		}
	}

	private *mapPart(part: OpencodePart): Iterable<BackendEvent> {
		if (part.type === "text" || part.type === "reasoning") {
			const text = (part as { text?: string }).text ?? ""
			const already = this.emittedLength.get(part.id) ?? 0
			if (text.length <= already) return
			this.emittedLength.set(part.id, text.length)
			yield { type: part.type === "text" ? "text" : "thinking", text: text.slice(already) }
			return
		}

		if (part.type === "tool") {
			const tool = part as { id: string; tool: string; callID: string; state: OpencodeToolState }
			const finished = tool.state.status === "completed" || tool.state.status === "error"

			if (!this.toolStarted.has(tool.callID)) {
				this.toolStarted.add(tool.callID)
				yield { type: "tool-start", callId: tool.callID, name: tool.tool, summary: describeTool(tool.tool, tool.state) }
			}

			if (finished && !this.toolFinished.has(tool.callID)) {
				this.toolFinished.add(tool.callID)
				const path = filePathOf(tool.tool, tool.state)
				if (path && tool.state.status === "completed") yield { type: "file-changed", path }
				yield {
					type: "tool-end",
					callId: tool.callID,
					name: tool.tool,
					ok: tool.state.status === "completed",
					summary: tool.state.status === "error" ? tool.state.error : tool.state.title,
				}
			}
			return
		}

		if (part.type === "step-finish") {
			const step = part as { cost?: number; tokens?: { input?: number; output?: number } }
			yield {
				type: "usage",
				inputTokens: step.tokens?.input,
				outputTokens: step.tokens?.output,
				costUsd: step.cost,
			}
		}
	}
}

/**
 * File changes are derived from the editing tools' own inputs rather than from
 * the server's `file.edited` event, which carries no session id — with two
 * projects open there would be no way to say whose change it was.
 */
function filePathOf(tool: string, state: OpencodeToolState): string | undefined {
	if (!FILE_TOOLS.has(tool)) return undefined
	const input = state.input ?? {}
	const candidate = input.filePath ?? input.file_path ?? input.path ?? input.file
	return typeof candidate === "string" ? candidate : undefined
}

function describeTool(tool: string, state: OpencodeToolState): string {
	if (state.title) return state.title
	const path = filePathOf(tool, state)
	if (path) return path
	const command = state.input?.command
	return typeof command === "string" ? command : tool
}

function mimeOfDataUrl(url: string): string {
	const match = url.match(/^data:([^;,]+)/)
	return match ? match[1] : "image/png"
}

export { CARET_SERVER_CONFIG }

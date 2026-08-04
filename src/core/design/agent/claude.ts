/**
 * The Claude adapter, over `@anthropic-ai/claude-agent-sdk`.
 *
 * Wraps the user's own `claude` CLI, so an existing subscription or key is used
 * without a second login. Caret's permission boundary lands on the SDK's
 * `canUseTool` hook, which is called for every tool the agent wants to run and
 * whose answer the CLI obeys — the closest thing to Caret's own boundary any of
 * the secondary backends offer.
 *
 * **Billing, disclosed at the point of choice:** account auth here draws the
 * separate Agent SDK credit pool rather than normal Claude Code limits. The
 * setup screen says so; this file is where the fact comes from.
 */
import { spawn } from "child_process"
import { randomUUID } from "crypto"

import { Logger } from "@/shared/services/Logger"
import {
	type AvailabilityReport,
	BackendError,
	type BackendEvent,
	type BackendSession,
	type CodingBackend,
	type PermissionDecision,
	type ReasoningEffort,
	type SendInput,
	type StartSessionOptions,
	StructuredOutputError,
	type StructuredRequest,
	type StructuredResult,
} from "./backend"
import { type Deferred, deferred, EventQueue } from "./stream-utils"

const INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code"

/**
 * Caret's effort scale onto Claude's.
 *
 * The two agree on everything except the bottom: Claude has no `minimal`, so it
 * folds into `low`. Written out rather than cast, because a silent cast here
 * would send a string the SDK rejects and the failure would surface as a broken
 * turn rather than as an unsupported setting.
 */
function claudeEffort(effort: ReasoningEffort | undefined): "low" | "medium" | "high" | "xhigh" | undefined {
	if (!effort) return undefined
	return effort === "minimal" ? "low" : effort
}

export class ClaudeBackend implements CodingBackend {
	readonly id = "claude" as const
	readonly permissionModel = "ask" as const
	readonly displayName = "Claude Code"

	async availability(): Promise<AvailabilityReport> {
		const base = { id: this.id, displayName: this.displayName, permissionModel: this.permissionModel } as const

		const status = await probeClaudeAuth()
		if (status.kind === "missing") {
			return {
				...base,
				installed: false,
				authenticated: false,
				ready: false,
				detail: "The Claude Code CLI isn't installed.",
				remedy: { label: "Install it", command: INSTALL_COMMAND },
			}
		}

		if (status.kind === "logged-out") {
			return {
				...base,
				installed: true,
				authenticated: false,
				ready: false,
				detail: "Found, but not signed in.",
				remedy: { label: "Sign in", command: "claude setup-token" },
			}
		}

		return {
			...base,
			installed: true,
			authenticated: true,
			ready: true,
			detail: `Found and signed in (${status.method}).`,
		}
	}

	async startSession(options: StartSessionOptions): Promise<BackendSession> {
		return new ClaudeSession(options)
	}

	async structured<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
		const { query } = await import("@anthropic-ai/claude-agent-sdk")

		const run = query({
			prompt: req.prompt,
			options: {
				cwd: req.workingDirectory,
				model: req.model,
				...(claudeEffort(req.effort) ? { effort: claudeEffort(req.effort) } : {}),
				permissionMode: "plan",
				// Answering a question, not doing work: every tool here is a way to
				// spend minutes and arrive somewhere worse.
				disallowedTools: ["Bash", "Edit", "Write", "WebFetch", "WebSearch"],
				outputFormat: { type: "json_schema", schema: req.schema } as never,
				...(req.systemPrompt ? { systemPrompt: req.systemPrompt } : {}),
			},
		})

		for await (const message of run) {
			if (message.type !== "result") continue
			if (message.subtype !== "success") {
				throw new StructuredOutputError(`the session ended as "${message.subtype}"`)
			}
			const value = (message as { structured_output?: unknown }).structured_output
			if (value === undefined) throw new StructuredOutputError("it returned no structured answer at all")
			return { value: value as T, emulated: false }
		}

		throw new StructuredOutputError("the session ended without a result")
	}
}

type ClaudeAuth = { kind: "missing" } | { kind: "logged-out" } | { kind: "ok"; method: string }

/**
 * `claude auth status` prints JSON and costs no inference, which makes it the
 * one honest way to answer "is this signed in" without spending the user's
 * credits to find out.
 */
async function probeClaudeAuth(): Promise<ClaudeAuth> {
	const output = await runCommand("claude", ["auth", "status"])
	if (output === null) return { kind: "missing" }

	try {
		const parsed = JSON.parse(output) as { loggedIn?: boolean; authMethod?: string }
		if (!parsed.loggedIn) return { kind: "logged-out" }
		return { kind: "ok", method: parsed.authMethod ?? "signed in" }
	} catch {
		// Present but answering in a shape we do not know. Installed is certain;
		// signed-in is not, so it is not claimed.
		return { kind: "logged-out" }
	}
}

/** Runs a command, returning stdout, or null when the executable is absent. */
export function runCommand(command: string, args: string[], timeoutMs = 10_000): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false
		const finish = (value: string | null) => {
			if (settled) return
			settled = true
			resolve(value)
		}

		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
		let stdout = ""
		child.stdout?.on("data", (chunk) => (stdout += chunk.toString()))
		child.on("error", () => finish(null))
		child.on("exit", (code) => finish(code === 0 ? stdout : null))

		const timer = setTimeout(() => {
			child.kill()
			finish(null)
		}, timeoutMs)
		child.on("exit", () => clearTimeout(timer))
	})
}

class ClaudeSession implements BackendSession {
	readonly id: string
	private pending = new Map<string, Deferred<PermissionDecision>>()
	private controller: AbortController | null = null
	private started = false

	constructor(private readonly options: StartSessionOptions) {
		// Caret assigns the id rather than waiting for the first turn to report
		// one, because the chat needs something to key its transcript on before
		// the model has said anything.
		this.id = options.resumeSessionId ?? randomUUID()
	}

	get mode() {
		return this.options.mode
	}

	async *send(input: SendInput): AsyncIterable<BackendEvent> {
		const { query } = await import("@anthropic-ai/claude-agent-sdk")
		const controller = new AbortController()
		this.controller = controller

		const queue = new EventQueue<BackendEvent>()

		const run = query({
			prompt: input.images?.length ? `${input.text}\n\n(Caret attached ${input.images.length} screenshot(s).)` : input.text,
			options: {
				cwd: this.options.workingDirectory,
				model: this.options.model,
				...(claudeEffort(this.options.effort) ? { effort: claudeEffort(this.options.effort) } : {}),
				abortController: controller,
				// Plan mode is the backend's own restriction. Caret's `canUseTool`
				// below is the boundary that actually holds.
				permissionMode: this.options.mode === "read-only" ? "plan" : "default",
				...(this.started || this.options.resumeSessionId ? { resume: this.id } : { sessionId: this.id }),
				...(this.options.systemPrompt ? { systemPrompt: this.options.systemPrompt } : {}),
				canUseTool: async (toolName, toolInput) => {
					const requestId = randomUUID()
					const wait = deferred<PermissionDecision>()
					this.pending.set(requestId, wait)
					queue.push({
						type: "permission",
						requestId,
						tool: toolName,
						path: pathOf(toolInput),
						summary: `${toolName}${pathOf(toolInput) ? `: ${pathOf(toolInput)}` : ""}`,
					})
					const decision = await wait.promise
					return decision === "deny"
						? { behavior: "deny" as const, message: "Caret denied this." }
						: { behavior: "allow" as const, updatedInput: toolInput }
				},
			},
		})

		this.started = true

		// The SDK is consumed on its own task so `canUseTool` can push into the
		// same queue the caller is draining. Awaiting the iterator inline would
		// deadlock: the hook cannot resolve until the caller reads the permission
		// event, and the caller cannot read it until the iterator yields.
		const pump = (async () => {
			try {
				for await (const message of run) {
					for (const event of mapClaudeMessage(message)) queue.push(event)
				}
				queue.push({ type: "done", text: "" })
			} catch (err) {
				queue.push({ type: "error", message: err instanceof Error ? err.message : String(err), recoverable: true })
				queue.push({ type: "done", text: "" })
			} finally {
				queue.close()
			}
		})()

		try {
			for await (const event of queue) {
				yield event
				if (event.type === "done") return
			}
		} finally {
			// Cleared first: `close()` aborting an already-finished turn is how the
			// Codex adapter crashed the process, and this SDK spawns a child too.
			if (this.controller === controller) this.controller = null
			controller.abort()
			// Unblock anything still waiting on a permission nobody will answer.
			for (const wait of this.pending.values()) wait.resolve("deny")
			this.pending.clear()
			await pump.catch(() => {})
		}
	}

	async respondToPermission(requestId: string, decision: PermissionDecision): Promise<void> {
		const wait = this.pending.get(requestId)
		if (!wait) {
			Logger.warn(`[backend] no permission is waiting on ${requestId}`)
			return
		}
		this.pending.delete(requestId)
		wait.resolve(decision)
	}

	async abort(): Promise<void> {
		const controller = this.controller
		this.controller = null
		controller?.abort()
	}

	async close(): Promise<void> {
		await this.abort()
	}
}

function pathOf(input: Record<string, unknown>): string | undefined {
	const candidate = input.file_path ?? input.filePath ?? input.path
	return typeof candidate === "string" ? candidate : undefined
}

/** SDK messages → normalised events. Anything unrecognised is dropped. */
function* mapClaudeMessage(message: { type: string; [key: string]: unknown }): Iterable<BackendEvent> {
	if (message.type === "assistant") {
		const content = (message.message as { content?: unknown[] } | undefined)?.content ?? []
		for (const block of content as Array<Record<string, unknown>>) {
			if (block.type === "text" && typeof block.text === "string") {
				yield { type: "text", text: block.text }
			} else if (block.type === "thinking" && typeof block.thinking === "string") {
				yield { type: "thinking", text: block.thinking }
			} else if (block.type === "tool_use") {
				const name = String(block.name ?? "tool")
				const target = pathOf((block.input as Record<string, unknown>) ?? {})
				yield { type: "tool-start", callId: String(block.id), name, summary: target ?? name }
				// The CLI reports the result in a following user message; Caret marks
				// the call finished there. Editing tools also drive the change list.
				if (target && /edit|write|patch/i.test(name)) yield { type: "file-changed", path: target }
			}
		}
		return
	}

	if (message.type === "user") {
		const content = (message.message as { content?: unknown[] } | undefined)?.content ?? []
		for (const block of content as Array<Record<string, unknown>>) {
			if (block.type !== "tool_result") continue
			yield {
				type: "tool-end",
				callId: String(block.tool_use_id),
				name: "tool",
				ok: block.is_error !== true,
			}
		}
		return
	}

	if (message.type === "result") {
		const usage = message.usage as { input_tokens?: number; output_tokens?: number } | undefined
		yield {
			type: "usage",
			inputTokens: usage?.input_tokens,
			outputTokens: usage?.output_tokens,
			costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
		}
		if (message.subtype !== "success") {
			yield { type: "error", message: `The session ended as "${message.subtype}".`, recoverable: true }
		}
	}
}

export { BackendError }

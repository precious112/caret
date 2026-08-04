/**
 * The Kimi adapter, over `@moonshot-ai/kimi-agent-sdk`. **Written to spec, untested.**
 *
 * No subscription has been available to exercise this against, and it says so in
 * its own availability report.
 *
 * Kimi has no native structured-output mode, so `structured()` here is always
 * emulated — prompt, parse, validate. The `emulated` flag is not a formality on
 * this backend: it is the caller's signal that its own post-validation is the
 * only thing standing between a model's guess and a written foundation.
 *
 * Permissions do arrive as approval requests, so Caret's boundary holds here the
 * way it does on OpenCode: every request is answered by Caret's own rules.
 */
import { randomUUID } from "crypto"

import {
	type AvailabilityReport,
	type BackendEvent,
	type BackendSession,
	type BackendSessionSummary,
	type CodingBackend,
	type PermissionDecision,
	type SendInput,
	type StartSessionOptions,
	StructuredOutputError,
	type StructuredRequest,
	type StructuredResult,
} from "./backend"
import { runCommand } from "./claude"
import { type Deferred, deferred, EventQueue } from "./stream-utils"

const INSTALL_COMMAND = "npm install -g @moonshot-ai/kimi-cli"

export class KimiBackend implements CodingBackend {
	readonly id = "kimi" as const
	readonly permissionModel = "ask" as const
	readonly displayName = "Kimi"

	async availability(): Promise<AvailabilityReport> {
		const base = {
			id: this.id,
			displayName: this.displayName,
			permissionModel: this.permissionModel,
			untested: true,
		} as const

		const version = await runCommand("kimi", ["--version"])
		if (version === null) {
			return {
				...base,
				installed: false,
				authenticated: false,
				ready: false,
				detail: "The Kimi CLI isn't installed.",
				remedy: { label: "Install it", command: INSTALL_COMMAND },
			}
		}

		const loggedIn = await this.isLoggedIn()
		if (!loggedIn) {
			return {
				...base,
				installed: true,
				authenticated: false,
				ready: false,
				detail: "Found, but not signed in.",
				remedy: { label: "Sign in", command: "kimi login" },
			}
		}

		return {
			...base,
			installed: true,
			authenticated: true,
			ready: true,
			detail: `Found and signed in (${version.trim()}). Caret hasn't been tested against a live Kimi subscription.`,
		}
	}

	async startSession(options: StartSessionOptions): Promise<BackendSession> {
		const { createSession } = await import("@moonshot-ai/kimi-agent-sdk")
		const session = createSession({
			workDir: options.workingDirectory,
			model: options.model,
			sessionId: options.resumeSessionId,
		})
		// Kimi has a thinking *switch*, not a scale, so the scale collapses onto it.
		// Naming that here rather than pretending the five levels survive.
		if (options.effort) session.thinking = options.effort !== "minimal" && options.effort !== "low"
		if (options.mode === "read-only") await session.setPlanMode(true)
		// The SDK's own `Session` type is structurally compatible with what this
		// adapter uses, but its event union is nominal, so it is narrowed to the
		// shape actually read rather than imported wholesale — a version bump that
		// adds an event member must not become a compile error here.
		return new KimiSession(session as unknown as KimiSessionHandle, options)
	}

	/** No native schema mode — always prompt, parse and validate. */
	async structured<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
		const { prompt } = await import("@moonshot-ai/kimi-agent-sdk")
		const { result } = await prompt(
			[
				req.prompt,
				"",
				"Reply with a single JSON object and nothing else — no prose, no code fence.",
				"It must satisfy this JSON Schema exactly, including every `enum`:",
				JSON.stringify(req.schema),
			].join("\n"),
			{ workDir: req.workingDirectory, model: req.model },
		)

		const text = typeof result === "string" ? result : ((result as { content?: string }).content ?? "")
		const start = text.indexOf("{")
		const end = text.lastIndexOf("}")
		if (start === -1 || end <= start) throw new StructuredOutputError("it answered with no JSON at all")

		try {
			return { value: JSON.parse(text.slice(start, end + 1)) as T, emulated: true }
		} catch (err) {
			throw new StructuredOutputError(`its JSON did not parse (${err})`)
		}
	}

	async listSessions(workingDirectory: string): Promise<BackendSessionSummary[]> {
		const { listSessions } = await import("@moonshot-ai/kimi-agent-sdk")
		const sessions = await listSessions(workingDirectory)
		return sessions.map((session) => ({
			id: (session as { sessionId?: string; id?: string }).sessionId ?? (session as { id: string }).id,
			title: (session as { title?: string }).title ?? "Untitled",
			updatedAt: Number((session as { updatedAt?: number }).updatedAt ?? 0),
		}))
	}

	private async isLoggedIn(): Promise<boolean> {
		try {
			const { isLoggedIn } = await import("@moonshot-ai/kimi-agent-sdk")
			return isLoggedIn()
		} catch {
			return false
		}
	}
}

type KimiTurn = {
	[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>, unknown, undefined>
	approve(requestId: string, response: unknown): Promise<void>
	interrupt(): Promise<void>
}

type KimiSessionHandle = {
	sessionId: string
	prompt(content: string): KimiTurn
	close(): Promise<void>
}

class KimiSession implements BackendSession {
	private pending = new Map<string, Deferred<PermissionDecision>>()
	private turn: KimiTurn | null = null

	constructor(
		private readonly session: KimiSessionHandle,
		private readonly options: StartSessionOptions,
	) {}

	get id() {
		return this.session.sessionId
	}

	get mode() {
		return this.options.mode
	}

	async *send(input: SendInput): AsyncIterable<BackendEvent> {
		const turn = this.session.prompt(input.text)
		this.turn = turn

		const queue = new EventQueue<BackendEvent>()
		const pump = (async () => {
			try {
				for await (const event of turn) {
					for (const mapped of this.mapEvent(event, queue)) queue.push(mapped)
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
			// Interrupting a turn that already ended is at best a no-op and at worst
			// an error nobody is listening for — see the Codex adapter.
			if (this.turn === turn) this.turn = null
			for (const wait of this.pending.values()) wait.resolve("deny")
			this.pending.clear()
			await pump.catch(() => {})
		}
	}

	async respondToPermission(requestId: string, decision: PermissionDecision): Promise<void> {
		const wait = this.pending.get(requestId)
		if (!wait) return
		this.pending.delete(requestId)
		wait.resolve(decision)
	}

	async abort(): Promise<void> {
		await this.turn?.interrupt().catch(() => {})
	}

	async close(): Promise<void> {
		await this.abort()
		await this.session.close().catch(() => {})
	}

	private *mapEvent(event: Record<string, unknown>, queue: EventQueue<BackendEvent>): Iterable<BackendEvent> {
		const type = String(event.type ?? "")

		if (type === "content_part" || type === "ContentPart") {
			const text = String((event as { text?: string }).text ?? "")
			if (text) yield { type: "text", text }
			return
		}

		if (type === "tool_call" || type === "ToolCall") {
			const call = event as { id?: string; name?: string; arguments?: Record<string, unknown> }
			const path = pathOf(call.arguments ?? {})
			yield {
				type: "tool-start",
				callId: String(call.id),
				name: String(call.name ?? "tool"),
				summary: path ?? String(call.name ?? "tool"),
			}
			return
		}

		if (type === "tool_result" || type === "ToolResult") {
			const result = event as { id?: string; name?: string; isError?: boolean; arguments?: Record<string, unknown> }
			const path = pathOf(result.arguments ?? {})
			if (path && !result.isError) yield { type: "file-changed", path }
			yield { type: "tool-end", callId: String(result.id), name: String(result.name ?? "tool"), ok: !result.isError }
			return
		}

		if (type === "approval_request" || type === "ApprovalRequest") {
			const approval = event as { requestId?: string; id?: string; title?: string; paths?: string[] }
			const requestId = String(approval.requestId ?? approval.id ?? randomUUID())
			const wait = deferred<PermissionDecision>()
			this.pending.set(requestId, wait)

			// Answering happens off the mapping path so the stream keeps flowing
			// while the user (or Caret) decides.
			void wait.promise.then((decision) =>
				this.turn?.approve(requestId, decision === "deny" ? "reject" : decision === "allow-always" ? "always" : "once"),
			)

			queue.push({
				type: "permission",
				requestId,
				tool: "approval",
				path: approval.paths?.[0],
				summary: approval.title ?? "The agent is asking permission.",
			})
			return
		}

		if (type === "turn_end" || type === "TurnEnd") {
			yield { type: "done", text: "" }
		}
	}
}

function pathOf(input: Record<string, unknown>): string | undefined {
	const candidate = input.file_path ?? input.filePath ?? input.path
	return typeof candidate === "string" ? candidate : undefined
}

/**
 * The Codex adapter, over `@openai/codex-sdk`. **Written to spec, untested.**
 *
 * No subscription has been available to exercise this against, and it says so
 * in its own availability report rather than being presented as equally proven.
 *
 * One structural difference worth knowing before choosing this backend: Codex
 * has **no interactive permission callback**. Its safety model is a sandbox mode
 * plus an approval policy chosen up front, so Caret cannot answer requests one
 * at a time the way it does elsewhere. What Caret does instead:
 *
 * - `read-only` sessions run with `sandboxMode: "read-only"` and
 *   `approvalPolicy: "never"`, so a plan cannot write at all.
 * - `write` sessions run with `sandboxMode: "workspace-write"` scoped to the
 *   project and `approvalPolicy: "never"`, so anything the sandbox refuses is
 *   refused rather than escalated to a prompt nobody can answer.
 *
 * The consequence is honest and worth stating in the UI: on this backend the
 * per-write "ask" toggle does nothing, because the boundary is the sandbox.
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import {
	type AvailabilityReport,
	type BackendEvent,
	type BackendSession,
	type CodingBackend,
	type ModelGroup,
	type SendInput,
	type StartSessionOptions,
	StructuredOutputError,
	type StructuredRequest,
	type StructuredResult,
} from "./backend"
import { runCommand } from "./claude"

const INSTALL_COMMAND = "npm install -g @openai/codex"

/** Only the fields Caret reads. The file carries about thirty more per model. */
interface CodexModelCache {
	models?: Array<{
		slug?: string
		display_name?: string
		/** `list` or `hide`; the CLI keeps its own internal models out of its picker. */
		visibility?: string
		priority?: number
	}>
}

export class CodexBackend implements CodingBackend {
	readonly id = "codex" as const
	readonly providerName = "OpenAI"
	readonly permissionModel = "sandbox" as const
	readonly displayName = "Codex"

	async availability(): Promise<AvailabilityReport> {
		const base = {
			id: this.id,
			displayName: this.displayName,
			permissionModel: this.permissionModel,
			providerName: this.providerName,
			untested: true,
		} as const

		const version = await runCommand("codex", ["--version"])
		if (version === null) {
			return {
				...base,
				installed: false,
				authenticated: false,
				ready: false,
				detail: "The Codex CLI isn't installed.",
				remedy: { label: "Install it", command: INSTALL_COMMAND },
			}
		}

		// Codex has no free auth-status probe, so presence is all Caret can
		// honestly claim. A missing credential surfaces on the first turn.
		return {
			...base,
			installed: true,
			authenticated: true,
			ready: true,
			detail: `Found (${version.trim()}). Caret hasn't been tested against a live Codex subscription.`,
		}
	}

	async startSession(options: StartSessionOptions): Promise<BackendSession> {
		return new CodexSession(options)
	}

	/**
	 * The CLI's own model catalogue, read from its cache.
	 *
	 * Codex exposes no enumeration API — no `models` subcommand, nothing on the
	 * SDK — but it does not need one: the CLI fetches the catalogue from OpenAI
	 * (ETag and all) and writes it to `models_cache.json`, which is where its own
	 * picker reads from. Caret reads the same file.
	 *
	 * The alternative was a hardcoded list, and that is wrong for a reason worth
	 * stating: it would mean shipping a Caret release every time OpenAI ships a
	 * model. This way the list arrives on its own — the day the CLI refreshes its
	 * cache, Caret sees the new model.
	 *
	 * Two honest limits. It is a *cache*, so it is as fresh as the user's last
	 * Codex run rather than live. And it is an internal file, so if it moves this
	 * returns nothing and the UI falls back to a text field — which is the same
	 * place we were before, not a breakage.
	 */
	async listModels(): Promise<ModelGroup[]> {
		const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")

		let cache: CodexModelCache
		try {
			cache = JSON.parse(await fs.readFile(path.join(home, "models_cache.json"), "utf-8"))
		} catch {
			return []
		}

		const models = (cache.models ?? [])
			// `hide` is how the CLI keeps internal entries out of its own picker —
			// `codex-auto-review` is one — and they have no business in ours either.
			.filter((model): model is { slug: string } & typeof model => Boolean(model.slug) && model.visibility !== "hide")
			.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
			.map((model) => ({ id: model.slug, label: model.display_name || model.slug }))

		return models.length > 0 ? [{ providerId: "openai", providerName: this.providerName, models }] : []
	}

	async structured<T>(req: StructuredRequest): Promise<StructuredResult<T>> {
		const { Codex } = await import("@openai/codex-sdk")
		const thread = new Codex().startThread({
			workingDirectory: req.workingDirectory,
			model: req.model,
			...(req.effort ? { modelReasoningEffort: req.effort } : {}),
			sandboxMode: "read-only",
			approvalPolicy: "never",
			skipGitRepoCheck: true,
		})

		const turn = await thread.run(req.prompt, { outputSchema: req.schema })
		try {
			return { value: JSON.parse(turn.finalResponse) as T, emulated: false }
		} catch {
			throw new StructuredOutputError("its answer was not JSON")
		}
	}
}

class CodexSession implements BackendSession {
	private threadId: string | null = null
	private controller: AbortController | null = null

	constructor(private readonly options: StartSessionOptions) {
		this.threadId = options.resumeSessionId ?? null
	}

	get id() {
		return this.threadId ?? "codex-pending"
	}

	get mode() {
		return this.options.mode
	}

	async *send(input: SendInput): AsyncIterable<BackendEvent> {
		const { Codex } = await import("@openai/codex-sdk")
		const codex = new Codex()

		const threadOptions = {
			workingDirectory: this.options.workingDirectory,
			model: this.options.model,
			// Left unset the CLI reports "reasoning effort: none", which is not the
			// same as a sensible default — it is no reasoning at all.
			...(this.options.effort ? { modelReasoningEffort: this.options.effort } : {}),
			sandboxMode: this.options.mode === "read-only" ? ("read-only" as const) : ("workspace-write" as const),
			approvalPolicy: "never" as const,
			skipGitRepoCheck: true,
		}

		const thread = this.threadId ? codex.resumeThread(this.threadId, threadOptions) : codex.startThread(threadOptions)

		const controller = new AbortController()
		this.controller = controller

		try {
			const { events } = await thread.runStreamed(input.text, { signal: controller.signal })

			for await (const event of events) {
				this.threadId ??= thread.id
				for (const mapped of mapCodexEvent(event)) {
					yield mapped
					if (mapped.type === "done") return
				}
			}
			yield { type: "done", text: "" }
		} finally {
			// The signal must not outlive the turn. This SDK wires it straight to the
			// CLI child process, so aborting a *finished* turn — which `close()` does
			// as a matter of course — makes the child emit an unhandled `error` and
			// takes the whole process down with it.
			if (this.controller === controller) this.controller = null
		}
	}

	async respondToPermission(): Promise<void> {
		// Nothing to answer: this backend decides by sandbox, not by prompt.
	}

	async abort(): Promise<void> {
		// Taken and cleared, so a second abort — or a `close()` after the turn ended
		// on its own — is a no-op rather than a signal fired at nothing.
		const controller = this.controller
		this.controller = null
		controller?.abort()
	}

	async close(): Promise<void> {
		await this.abort()
	}
}

function* mapCodexEvent(event: { type: string; [key: string]: unknown }): Iterable<BackendEvent> {
	switch (event.type) {
		case "item.started":
		case "item.updated":
		case "item.completed": {
			const item = event.item as
				| { id?: string; type?: string; text?: string; command?: string; status?: string }
				| undefined
			if (!item) return
			if (item.type === "agent_message" && typeof item.text === "string" && event.type === "item.completed") {
				yield { type: "text", text: item.text }
			} else if (item.type === "reasoning" && typeof item.text === "string" && event.type === "item.completed") {
				yield { type: "thinking", text: item.text }
			} else if (item.type === "command_execution" && item.command) {
				if (event.type === "item.started") {
					yield { type: "tool-start", callId: String(item.id), name: "bash", summary: item.command }
				} else if (event.type === "item.completed") {
					yield { type: "tool-end", callId: String(item.id), name: "bash", ok: item.status !== "failed" }
				}
			} else if (item.type === "file_change" && event.type === "item.completed") {
				for (const change of ((item as { changes?: Array<{ path?: string }> }).changes ?? []).filter((c) => c.path)) {
					yield { type: "file-changed", path: change.path as string }
				}
			}
			return
		}

		case "turn.completed": {
			const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
			yield { type: "usage", inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens }
			yield { type: "done", text: "" }
			return
		}

		case "turn.failed": {
			const error = event.error as { message?: string } | undefined
			yield { type: "error", message: error?.message ?? "the turn failed", recoverable: true }
			yield { type: "done", text: "" }
			return
		}

		case "error":
			yield { type: "error", message: String(event.message ?? "the backend reported an error"), recoverable: false }
			yield { type: "done", text: "" }
	}
}

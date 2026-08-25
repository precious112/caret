/**
 * "It finished" is not "it ran".
 *
 * A backend can accept a prompt and end the turn without the model ever
 * having been invoked — OpenCode's agent loop does exactly that when a queued
 * message doesn't look like work, and the resulting `session.idle` is
 * indistinguishable on the wire from a successful empty turn. `run()` used to
 * report that as `ok: true`, which sent the sync layer down its "the model
 * chose to change nothing, use a stronger model" path for a turn no model saw.
 * These pin the boundary: no assistant activity → not a success — unless the
 * user is the one who stopped it.
 */
import { strict as assert } from "assert"

import type { BackendEvent, CodingBackend, SessionMode } from "../backend"
import { AgentConversation, type ConversationDeps } from "../conversation"

function stubBackend(events: BackendEvent[], onAbort?: () => void): CodingBackend {
	return {
		id: "opencode",
		displayName: "Stub",
		providerName: "Stub",
		async availability() {
			return { ready: true, installed: true, detail: "" }
		},
		async startSession(options: { mode: SessionMode }) {
			return {
				id: "ses_stub",
				mode: options.mode,
				async *send() {
					yield* events
				},
				async respondToPermission() {},
				async abort() {
					onAbort?.()
				},
				async close() {},
			}
		},
		async structured() {
			throw new Error("not used here")
		},
	} as unknown as CodingBackend
}

function deps(backend: CodingBackend): ConversationDeps {
	return {
		projectPath: "/tmp/nowhere",
		resolveBackend: async () => backend,
		model: () => undefined,
		effort: () => undefined,
		appWrites: () => "ask",
		setAppWrites: async () => {},
		systemPrompt: async () => undefined,
		onChange: () => {},
	}
}

const REQUEST = { kind: "chat" as const, title: "Chat", mode: "write" as const, prompt: "hello" }

describe("AgentConversation.run", () => {
	it("fails a turn that ended without any assistant activity", async () => {
		// The exact wire shape of the never-ran apply turn: a real, legitimate
		// done and nothing else.
		const conversation = new AgentConversation(deps(stubBackend([{ type: "done", text: "" }])))

		const outcome = await conversation.run(REQUEST)

		assert.equal(outcome.ok, false, "an empty turn was reported as a success")
	})

	it("fails a turn whose only 'activity' was usage bookkeeping — an empty model step", async () => {
		// Observed on a free alpha model: the loop ran one step, emitted only
		// its token count, and exited. The usage event counted as activity and
		// the user was shown literally nothing.
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "usage", inputTokens: 100, outputTokens: 0 },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(REQUEST)

		assert.equal(outcome.ok, false, "a usage-only turn was reported as a success")
		const error = conversation.getState().transcript.entries.find((entry) => entry.kind === "error")
		assert(error && error.kind === "error" && /empty response/.test(error.message), "the error does not say what happened")
	})

	it("notes a turn that did tool work and then said nothing", async () => {
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "tool-start", callId: "c1", name: "caret_get_screenshot", summary: "home" },
					{ type: "tool-end", callId: "c1", name: "caret_get_screenshot", ok: true },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(REQUEST)

		assert.equal(outcome.ok, true, "a tool-only turn is still a completed turn")
		const note = conversation.getState().transcript.entries.find((entry) => entry.kind === "note")
		assert(note && note.kind === "note" && /without a reply/.test(note.text), "the silence went unremarked")
	})

	it("keeps a turn with assistant activity a success", async () => {
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "text", text: "done deal" },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(REQUEST)

		assert.equal(outcome.ok, true)
		assert.equal(outcome.text, "done deal")
	})

	it("does not blame the backend when the user stopped the turn first", async () => {
		// A Stop pressed before the first token also ends the stream with nothing
		// in it; that is the user's call, not a backend fault.
		let conversation: AgentConversation | null = null
		const backend = stubBackend([{ type: "done", text: "" }])
		const original = backend.startSession.bind(backend)
		backend.startSession = async (options) => {
			const session = await original(options)
			// The user hits Stop the moment the turn opens.
			void conversation?.abort()
			return session
		}
		conversation = new AgentConversation(deps(backend))

		const outcome = await conversation.run(REQUEST)

		assert.equal(outcome.ok, true, "a user-stopped empty turn was reported as a backend fault")
	})

	it("denies promptable permissions on an unattended turn instead of waiting forever", async () => {
		// The variant-take deadlock: the model asks to run `git status`, the
		// ruling is "ask the user", and the surface that would show the prompt is
		// covered by the compare overlay. Unattended turns must answer NO
		// themselves — a question no one can see holds the take open forever.
		const decisions: Array<{ id: string; decision: string }> = []
		const backend = stubBackend([
			{ type: "permission", requestId: "per_1", tool: "bash", path: "git status --short", summary: "Run git status?" },
			{ type: "text", text: "worked around it" },
			{ type: "done", text: "" },
		])
		const original = backend.startSession.bind(backend)
		backend.startSession = async (options) => {
			const session = await original(options)
			session.respondToPermission = async (id: string, decision: string) => {
				decisions.push({ id, decision })
			}
			return session
		}
		const conversation = new AgentConversation(deps(backend))

		const outcome = await conversation.run({ ...REQUEST, kind: "edit", title: "Edit", unattended: true })

		// decide() runs unawaited off the stream; give it a beat to land.
		await new Promise((resolve) => setTimeout(resolve, 50))
		assert.equal(outcome.ok, true)
		assert.deepEqual(decisions, [{ id: "per_1", decision: "deny" }], "the unattended turn did not auto-deny the ask")
	})

	it("leaves the same promptable permission pending on an attended turn", async () => {
		const decisions: string[] = []
		const backend = stubBackend([
			{ type: "permission", requestId: "per_2", tool: "bash", path: "git status", summary: "Run git status?" },
			{ type: "text", text: "waiting politely" },
			{ type: "done", text: "" },
		])
		const original = backend.startSession.bind(backend)
		backend.startSession = async (options) => {
			const session = await original(options)
			session.respondToPermission = async (_id: string, decision: string) => {
				decisions.push(decision)
			}
			return session
		}
		const conversation = new AgentConversation(deps(backend))

		await conversation.run({ ...REQUEST, kind: "edit", title: "Edit" })
		await new Promise((resolve) => setTimeout(resolve, 50))

		assert.deepEqual(decisions, [], "an attended ask was answered without the user")
	})
})

/**
 * The plan-mode contract: the reply IS the deliverable.
 *
 * A read-only turn that read, and possibly thought, and never wrote the plan
 * is a FAILURE — the observed field bug was an Apply gate shipping with
 * literally nothing behind it, because "tools ran, then silence" counted as
 * ok. And only a completed plan-mode turn with a real reply may settle a plan
 * for the Plan→Act flip to execute.
 */
describe("AgentConversation plan mode", () => {
	const PLAN_REQUEST = { kind: "sync-plan" as const, title: "Sync design → app", mode: "read-only" as const, prompt: "plan it" }

	it("fails a read-only turn that did tool work and never wrote the plan", async () => {
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "tool-start", callId: "c1", name: "glob", summary: "src/**" },
					{ type: "tool-end", callId: "c1", name: "glob", ok: true },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(PLAN_REQUEST)

		assert.equal(outcome.ok, false, "a plan turn with no plan was reported as a success")
		const error = conversation.getState().transcript.entries.find((entry) => entry.kind === "error")
		assert(
			error && error.kind === "error" && /without writing a plan/.test(error.message),
			"the error does not name the failure",
		)
		assert.equal(conversation.getState().plan, null, "an empty plan settled anyway")
	})

	it("fails a read-only turn whose only output was reasoning", async () => {
		// The collapsed-Thinking edge: a reasoning model can put the whole plan
		// in thoughts and reply with nothing. Thinking is visible activity, so
		// the generic empty-response check passes — this rule has to catch it.
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "thinking", text: "five paragraphs of internal planning" },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(PLAN_REQUEST)

		assert.equal(outcome.ok, false, "a reasoning-only plan turn was reported as a success")
		assert.equal(conversation.getState().plan, null)
	})

	it("settles a plan off a completed read-only turn and marks its entry", async () => {
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "text", text: "1. Change checkout-view.tsx" },
					{ type: "done", text: "" },
				]),
			),
		)

		const outcome = await conversation.run(PLAN_REQUEST)

		assert.equal(outcome.ok, true)
		const state = conversation.getState()
		assert(state.plan, "no plan settled")
		assert.equal(state.plan?.kind, "sync-plan")
		const entry = state.transcript.entries.find((e) => e.id === state.plan?.entryId)
		assert(entry && entry.kind === "assistant" && entry.plan === true, "the plan entry is not marked")
		assert.equal(conversation.settledPlan()?.sessionId, "ses_stub")
	})

	it("sendMessage runs in the conversation's mode, not the last activity's", async () => {
		const modes: SessionMode[] = []
		const backend = stubBackend([
			{ type: "text", text: "a plan" },
			{ type: "done", text: "" },
		])
		const original = backend.startSession.bind(backend)
		backend.startSession = async (options) => {
			modes.push(options.mode)
			return original(options)
		}
		const conversation = new AgentConversation(deps(backend))

		await conversation.run(PLAN_REQUEST)
		// The user flips to Act, then types — the send must run write, even
		// though the current activity was the read-only plan turn.
		conversation.setMode("write")
		await conversation.sendMessage("actually, go ahead differently")

		assert.deepEqual(modes, ["read-only", "write"], "the send inherited the activity's mode instead of the toggle's")
	})

	it("a write-mode turn consumes the settled plan", async () => {
		const conversation = new AgentConversation(
			deps(
				stubBackend([
					{ type: "text", text: "content" },
					{ type: "done", text: "" },
				]),
			),
		)

		await conversation.run(PLAN_REQUEST)
		assert(conversation.settledPlan(), "no plan to consume")
		await conversation.run({ kind: "sync-apply", title: "Sync design → app", mode: "write", prompt: "apply" })

		assert.equal(conversation.settledPlan(), null, "execution left the plan armed")
	})

	it("a failed revision un-arms the plan", async () => {
		// First turn settles a plan; the revision turn ends empty. The safe
		// reading of a broken revision is "there is no approved intent", never
		// "execute the previous version".
		const events: BackendEvent[][] = [
			[
				{ type: "text", text: "the first plan" },
				{ type: "done", text: "" },
			],
			[{ type: "done", text: "" }],
		]
		const backend = stubBackend([])
		backend.startSession = async (options: { mode: SessionMode }) => ({
			id: "ses_stub",
			mode: options.mode,
			async *send() {
				yield* events.shift() ?? []
			},
			async respondToPermission() {},
			async abort() {},
			async close() {},
		})
		const conversation = new AgentConversation(deps(backend))

		await conversation.run(PLAN_REQUEST)
		assert(conversation.settledPlan(), "the first plan did not settle")
		await conversation.run({ ...PLAN_REQUEST, prompt: "revise it" })

		assert.equal(conversation.settledPlan(), null, "a failed revision left the stale plan armed")
	})

	it("settledPlan() is null while a turn streams", async () => {
		// A plan is settled, then a REVISION turn is streaming when the flip
		// lands. The stale plan is still in memory — and must be unreachable,
		// or the flip executes a version the user is mid-way through changing.
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let turn = 0
		const backend = stubBackend([])
		backend.startSession = async (options: { mode: SessionMode }) => ({
			id: "ses_stub",
			mode: options.mode,
			async *send(): AsyncGenerator<BackendEvent> {
				turn += 1
				if (turn === 1) {
					yield { type: "text", text: "the first plan" }
					yield { type: "done", text: "" }
					return
				}
				yield { type: "text", text: "revising…" }
				await gate
				yield { type: "done", text: "" }
			},
			async respondToPermission() {},
			async abort() {},
			async close() {},
		})
		const conversation = new AgentConversation(deps(backend))

		await conversation.run(PLAN_REQUEST)
		assert(conversation.settledPlan(), "the first plan did not settle")

		const revision = conversation.run({ ...PLAN_REQUEST, prompt: "revise it" })
		await new Promise((resolve) => setTimeout(resolve, 20))
		assert.equal(conversation.settledPlan(), null, "a flip racing the stream could have executed the stale plan")
		release()
		await revision

		assert(conversation.settledPlan(), "the revision did not settle once the stream ended")
	})
})

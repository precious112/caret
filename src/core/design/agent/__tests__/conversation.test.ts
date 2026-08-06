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
		permissionModel: "ask",
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
})

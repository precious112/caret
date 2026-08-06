/**
 * The mapper's one hard job: telling the assistant's parts from the echo of
 * the user's own prompt, without knowing anyone's id scheme.
 *
 * The previous design recognised the user's message by a Caret-assigned id
 * (`msg_caret_<uuid>`), and that id is what broke resumed sessions: the
 * server's agent loop orders its queue by message id, its own ids are
 * ascending, and a foreign id sorting before the previous turn's assistant
 * messages reads as already-processed history — the loop exits at step 0
 * without running the model. Sorting after them is the mirror failure: the
 * same prompt is re-run forever (observed, 107 times). So the mapper must
 * work from what the bus announces — `message.updated` carries the role,
 * always before that message's parts — and anything not announced as the
 * assistant's stays off-screen.
 */
import { strict as assert } from "assert"

import type { BackendEvent } from "../../backend"
import { EventMapper } from "../index"
import type { OpencodeEvent } from "../protocol"

const SESSION = "ses_test"

function collect(mapper: EventMapper, events: OpencodeEvent[]): BackendEvent[] {
	return events.flatMap((event) => [...mapper.map(event)])
}

function announced(messageId: string, role: string, sessionID = SESSION): OpencodeEvent {
	return { type: "message.updated", properties: { sessionID, info: { id: messageId, role } } }
}

function textPart(messageId: string, text: string, partId = `prt_${messageId}`): OpencodeEvent {
	return {
		type: "message.part.updated",
		properties: { sessionID: SESSION, part: { type: "text", id: partId, messageID: messageId, text } },
	} as OpencodeEvent
}

describe("EventMapper", () => {
	it("replays nothing of a message never announced as the assistant's", () => {
		// The user's own prompt coming back over the bus, exactly as the server
		// sends it: the message exists, its role was announced as `user`, its
		// text part follows.
		const mapper = new EventMapper(SESSION)
		const events = collect(mapper, [announced("msg_user", "user"), textPart("msg_user", "make the header blue")])
		assert.deepEqual(events, [])
	})

	it("maps the assistant's text once the bus has announced the message", () => {
		const mapper = new EventMapper(SESSION)
		const events = collect(mapper, [
			announced("msg_assistant", "assistant"),
			textPart("msg_assistant", "Changing the header now."),
		])
		assert.deepEqual(events, [{ type: "text", text: "Changing the header now." }])
	})

	it("drops parts whose message was announced by a different session", () => {
		// Two sessions share one per-directory bus. An announcement from another
		// session must not put its messages on this turn's allowlist.
		const mapper = new EventMapper(SESSION)
		const events = collect(mapper, [
			announced("msg_other", "assistant", "ses_other"),
			textPart("msg_other", "spoken elsewhere"),
		])
		assert.deepEqual(events, [])
	})

	it("emits only the suffix when the same part is re-sent longer", () => {
		const mapper = new EventMapper(SESSION)
		const events = collect(mapper, [
			announced("msg_a", "assistant"),
			textPart("msg_a", "Hello"),
			textPart("msg_a", "Hello, world"),
		])
		assert.deepEqual(events, [
			{ type: "text", text: "Hello" },
			{ type: "text", text: ", world" },
		])
	})

	it("maps session.idle for this session to done, and ignores other sessions'", () => {
		const mapper = new EventMapper(SESSION)
		const foreign = collect(mapper, [{ type: "session.idle", properties: { sessionID: "ses_other" } }])
		assert.deepEqual(foreign, [])

		const own = collect(mapper, [{ type: "session.idle", properties: { sessionID: SESSION } }])
		assert.deepEqual(own, [{ type: "done", text: "" }])
	})
})

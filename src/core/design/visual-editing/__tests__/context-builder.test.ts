/**
 * What the agent is told when someone paints a region.
 *
 * Both facts here come from one failed edit in a real project. Asked to
 * retexture a notecard, the model was handed an accurate crop of that notecard
 * and the page source, searched for the *image* rather than the words in the
 * picture, found the same file used by two components, and edited the one
 * several screens above the region on screen. The crop was never the problem;
 * the prompt gave it no method for finding what it was looking at.
 *
 * The second fact is smaller and was costing every turn: the prompt closed by
 * naming `write_to_file`, which neither backend has.
 */
import { strict as assert } from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { AiEditRequestPayload } from "../../rendering-shell/messages"
import { buildVisualEditPrompt } from "../context-builder"

/** An overlay edit is the one with no element behind it: no line, no caret-id. */
function overlayPayload(overrides: Partial<AiEditRequestPayload> = {}): AiEditRequestPayload {
	return {
		instruction: "make this look like brown paper",
		filePath: "",
		lineNumber: 0,
		columnNumber: 0,
		componentName: "",
		caretId: "",
		componentStack: "",
		...overrides,
	} as AiEditRequestPayload
}

describe("buildVisualEditPrompt", () => {
	let workspace: string

	beforeEach(async () => {
		workspace = await fs.mkdtemp(path.join(os.tmpdir(), "caret-prompt-"))
	})

	afterEach(async () => {
		await fs.rm(workspace, { force: true, recursive: true })
	})

	it("tells an overlay edit to find the region by the text in the crop", async () => {
		const prompt = await buildVisualEditPrompt(overlayPayload(), workspace)

		assert.match(prompt, /text visible in the crop/i, "no instruction to read the words in the picture")
		assert.match(prompt, /search for those exact words/i, "did not say to search for them")
		assert.match(
			prompt,
			/Do not identify it by the graphic or by an image filename/i,
			"did not rule out the match that picked the wrong component",
		)
	})

	it("tells an overlay edit to follow the page's imports", async () => {
		// The section the user painted usually is not in the page at all — the page
		// composes it. Without this the agent edits the page or gives up.
		const prompt = await buildVisualEditPrompt(overlayPayload(), workspace)
		assert.match(prompt, /components it imports/i)
	})

	it("leaves a selected-element edit pinned to that element", async () => {
		// The inline path was never the broken one, and its narrowness is the point:
		// the user clicked a specific thing.
		const prompt = await buildVisualEditPrompt(overlayPayload({ caretId: "a-5", lineNumber: 36 }), workspace)

		assert.match(prompt, /selected a SPECIFIC element/i)
		assert.doesNotMatch(prompt, /text visible in the crop/i, "the overlay's search method leaked into the click path")
	})

	it("never names a tool the backends do not have", async () => {
		// OpenCode offers read/apply_patch/bash/grep/glob/edit/write/todowrite, and
		// the Claude backend has Write, not write_to_file. Naming one cost real
		// turns: the model hunted for it before improvising.
		for (const payload of [overlayPayload(), overlayPayload({ caretId: "a-5", lineNumber: 36 })]) {
			const prompt = await buildVisualEditPrompt(payload, workspace)
			assert.doesNotMatch(prompt, /write_to_file/, "the prompt still names a tool that does not exist")
			assert.match(prompt, /editing the file/i, "the prompt no longer says to apply the change")
		}
	})
})

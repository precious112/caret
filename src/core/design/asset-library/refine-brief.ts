/**
 * The rebuild stage: an amateur's request becomes a craft-quality brief.
 *
 * The clarify step asks what was left out; this is what happens to the answers.
 * The old shape glued the raw text and the raw answers together and hoped —
 * which protected a pro's words but handed an amateur's words to the generator
 * exactly as typed, and "a logo of an ember" typed by someone who is not a
 * designer generates like it was written by someone who is not a designer.
 *
 * So a model rewrites the request into a polished brief, under two hard rules:
 *
 * 1. **Every decision the user made survives verbatim in meaning** — subject,
 *    named colours, named composition, anything they chose. Craft is added only
 *    where they were silent. This is the same precedence law the composer
 *    already applies, moved up to writing time.
 * 2. **The rebuilt brief is shown to the user, editable, before anything is
 *    generated.** Nothing is rewritten behind anyone's back — it is rewritten
 *    in front of them, in the prompt box they already own. A pro reads it and
 *    sees their direction intact; a beginner reads it and learns what a real
 *    brief looks like.
 *
 * The playbook differs per kind because the craft differs per kind: a logo
 * brief is geometry, a photograph brief is light, a 3D brief is one clean
 * object. Constraints are stated POSITIVELY throughout — the image model has
 * no negative-prompt channel and "do not" lists measurably lose to positive
 * description (Google's own prompting guidance, confirmed in the field when
 * a banned glow shipped anyway).
 *
 * **A failure here is a skipped step, never a blocked user.** No backend, a
 * timeout, malformed output — all of them mean generate with the words we
 * have. Same honesty rule as the clarifier.
 */
import type { CodingBackend } from "../agent/backend"
import type { FoundationTokens } from "../types"
import type { AssetRequest } from "./request"

/** What the rebuild returns: the brief, ready for the editable prompt box. */
export interface RefinedBrief {
	prompt: string
}

const REFINE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["prompt"],
	properties: {
		prompt: {
			type: "string",
			description: "The rebuilt brief, ready to be used as the generation prompt. Plain prose, no headings.",
		},
	},
} as const

/**
 * The craft each kind's brief is rebuilt with.
 *
 * These are the practices that survived measurement — the probe runs in
 * caret-learning/mark-probe and the published prompting guidance they agree
 * with — not taste assertions.
 */
const PLAYBOOKS: Record<AssetRequest["kind"], string> = {
	mark: [
		"This brief is for a LOGO MARK. The generator downstream already fixes the colours, the background and the flat-vector",
		"treatment from the project's design system — so the brief you write is ONLY the construction of the symbol itself.",
		"Rules of the craft:",
		"- Reduce the idea to a symbol. Never describe the object; describe the finished trademark. 'A coal with a crack' draws",
		"  a coal; 'a solid circle split by one jagged fissure into two offset halves' draws a mark.",
		"- Geometry first: name the exact shapes and how they meet — circles, arcs, bars, wedges, cuts, counters. 'Two",
		"  overlapping circles', never 'an abstract shape'.",
		"- One idea, executed once. A mark with two ideas is two bad marks.",
		"- The silhouette alone must carry it, and every element must survive at 20 pixels: no fine detail, no thin lines.",
		"- Say where negative space works FOR the mark if it does.",
	].join("\n"),
	image: [
		"This brief is for a PHOTOGRAPH. The generator downstream already supplies the project's palette and key as defaults —",
		"the brief you write is the shot itself. Rules of the craft:",
		"- One subject, and say exactly what is in the frame — then say what fills the rest of the frame in positive words",
		"  ('behind it only darkness', 'a vast empty white wall'), never as a list of things to exclude.",
		"- Give it a light: one named source, its direction and temperature, and what happens where it does not reach.",
		"- Give it a camera when it helps: lens feel (macro, 85mm portrait, wide), distance, angle.",
		"- Name the surfaces and materials that matter — they are what makes a picture feel expensive.",
		"- Keep the user's mood words; sharpen vague ones into physical ones ('cozy' → 'one warm low light, deep soft shadows').",
	].join("\n"),
	texture: [
		"This brief is for a repeating TEXTURE. Keep it about the material and the scale of its detail, evenly distributed,",
		"with no focal point and no single object — it must read as a surface, not a picture.",
	].join("\n"),
	object3d: [
		"This brief is for the SOURCE IMAGE of a 3D MODEL — a photograph of one object that reconstruction will turn into a",
		"mesh. Rules of the craft:",
		"- One complete object, nothing else. Describe its exact form the way an industrial designer would: primary volumes,",
		"  profile, proportions, how parts meet.",
		"- Name the materials and finishes (matte black aluminium, brushed steel) — the texture comes from them.",
		"- The object carries NO text, no labels, no fine printed detail: reconstruction smears print. If the user asked for",
		"  branding, keep it as simple geometry (an embossed shape), never lettering.",
		"- Solid, self-supporting, sculptural. Thin wires, glass and fur reconstruct badly; steer the form toward what a mesh",
		"  can hold without changing what the user asked for.",
	].join("\n"),
	shader: [
		"This brief is for an ANIMATED BACKGROUND SHADER, written as what a viewer sees. Rules of the craft:",
		"- Describe the motion's speed and restraint explicitly — the best background motion is noticed on the second look.",
		"- Name what moves and what stays still; one kind of motion, not three.",
		"- If text will sit on it, say so and say where it must stay quiet enough to read over.",
	].join("\n"),
}

/**
 * Rebuilds the request into a brief a professional would have written.
 *
 * Returns null on ANY failure — the caller generates with the raw text, and
 * nobody waits on a step that only exists to improve things.
 */
export async function refineBrief(input: {
	backend: Pick<CodingBackend, "structured">
	workingDirectory: string
	request: AssetRequest
	tokens: FoundationTokens | null
	model?: string
}): Promise<RefinedBrief | null> {
	const { request } = input
	const answers = Object.values(request.answers ?? {})
		.map((answer) => answer.trim())
		.filter(Boolean)

	const vibe = input.tokens?.vibe.tags?.join(", ") || "not yet decided"
	const prompt = [
		"You are a senior art director rewriting a request into the brief a professional would have written.",
		"",
		`The request: "${request.text.trim()}"`,
		...(answers.length > 0 ? ["They were asked what was missing, and answered:", ...answers.map((a) => `- ${a}`)] : []),
		`The project's character: ${vibe}.`,
		"",
		PLAYBOOKS[request.kind],
		"",
		"Hard rules, above everything in the playbook:",
		"- Every decision the user actually made survives with its meaning intact: their subject, any colour, style,",
		"  composition or reference they named. You add craft ONLY where they were silent. If the request is already a",
		"  professional brief, change as little as possible.",
		"- Never swap the subject for a different one, and never add a second subject.",
		"- State everything positively — describe what IS in the result, never lists of what to avoid.",
		"- Write one compact paragraph of plain prose, at most 90 words. The user will read and edit it, so no headings,",
		"  no bullet points, no meta-talk about prompts.",
	].join("\n")

	try {
		const result = await input.backend.structured<RefinedBrief>({
			workingDirectory: input.workingDirectory,
			prompt,
			schema: REFINE_SCHEMA as unknown as Record<string, unknown>,
			model: input.model,
		})
		const rebuilt = result.value?.prompt?.trim()
		if (!rebuilt) return null
		return { prompt: rebuilt }
	} catch {
		return null
	}
}

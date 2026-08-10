/**
 * The three tools that let an agent run the foundation interview.
 *
 * The division of labour matters. The agent supplies **judgment** — which
 * questions are worth asking given what it already knows, and which few
 * candidates to show. Caret supplies the **space** those choices are made
 * within, and every option in it is one somebody approved.
 *
 * So `present_options` does not accept arbitrary candidates. It takes ids from
 * the curated library, and anything else is refused. An agent that could pass
 * its own hex codes and font names would be right back to averaging its training
 * data, which is the failure this whole phase exists to prevent.
 */
import { z } from "zod"

import {
	candidateFontUrl,
	countRecognisedTags,
	INTERVIEW_QUESTIONS,
	LIBRARY_TAGS,
	narrowCandidates,
	resolveCandidate,
	writeFoundationTokens,
} from "../../../src/core/design"
import { recordEdit } from "../../../src/core/design/provenance"
import { Logger } from "../../../src/shared/services/Logger"
import { askUser, type InterviewPrompt, type PresentedCandidate } from "../interview"
import { regenerateRulesFiles } from "../rules/generate"
import type { ToolContext, ToolDefinition, ToolResult } from "./tools"

/** How the interview reaches the window. Injected so tests can drive it headless. */
export interface InterviewTransport {
	send(prompt: InterviewPrompt): void
}

function ok(payload: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }
}

function fail(message: string): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true }
}

export function buildInterviewTools(transport: InterviewTransport): ToolDefinition[] {
	const send = (prompt: InterviewPrompt) => transport.send(prompt)

	return [
		{
			name: "present_question",
			title: "Ask the user a question",
			description:
				"Shows the user a plain-language question with a few choices and waits for them to pick. Use this to run the foundation interview. Ask about the product and how it should feel — never about design terms like type scale, radius or saturation, which the user has no way to answer. Caret's suggested questions are in the caret://interview prompt.",
			inputSchema: {
				question: z.string().describe("Plain language, no design jargon"),
				choices: z.array(z.string()).min(2).max(5).describe("Two to five concrete answers"),
				hint: z.string().optional().describe("One line of reassurance or clarification"),
				step: z.number().optional(),
				total: z.number().optional(),
			},
			async handler(_ctx, args: { question: string; choices: string[]; hint?: string; step?: number; total?: number }) {
				const answer = await askUser(send, {
					kind: "question",
					question: args.question,
					hint: args.hint,
					choices: args.choices,
					step: args.step,
					total: args.total,
				})
				return answer === null
					? ok({ answered: false, note: "The user skipped this question or closed the interview." })
					: ok({ answered: true, answer })
			},
		},

		{
			name: "present_options",
			title: "Show the user foundations to pick from",
			description: `Renders complete foundations as live specimens — real typefaces, palettes applied to sample components — and waits for the user to point at one. Pass the vibe tags you inferred from their answers and Caret narrows its curated library; you cannot pass your own colours or font names, by design. Returns the chosen candidate id for commit_foundation.\n\nTags are matched exactly against a fixed vocabulary, so use words FROM THIS LIST ONLY:\n${LIBRARY_TAGS.join(", ")}\n\nPick the 3-6 that best fit what the user told you. Tags outside this list are rejected rather than silently ignored.`,
			inputSchema: {
				tags: z
					.array(z.string())
					.describe(`Vibe tags from the library vocabulary. Allowed values: ${LIBRARY_TAGS.join(", ")}`),
				count: z.number().min(2).max(4).default(3).describe("How many candidates to show"),
				title: z.string().default("Pick the one you like").describe("Heading above the options"),
				subtitle: z.string().optional(),
			},
			async handler(_ctx, args: { tags: string[]; count?: number; title?: string; subtitle?: string }) {
				const tags = args.tags ?? []

				// Refuse a query that overlaps the vocabulary nowhere. Ranking by a
				// score every candidate ties on is not a narrowing — it silently
				// returns the first few in declaration order, which looks exactly
				// like a real result and is not one.
				if (tags.length > 0 && countRecognisedTags(tags) === 0) {
					return fail(
						`None of [${tags.join(", ")}] are tags this library knows, so nothing can be narrowed. ` +
							`Re-tag using these words only: ${LIBRARY_TAGS.join(", ")}`,
					)
				}

				const candidates = narrowCandidates(tags, args.count ?? 3)
				if (candidates.length === 0) {
					return fail("No candidates matched — pass fewer or broader tags.")
				}

				const chosen = await askUser(send, {
					kind: "options",
					title: args.title ?? "Pick the one you like",
					subtitle: args.subtitle,
					candidates: candidates.map(present),
				})

				if (chosen === null) {
					return ok({ chosen: false, note: "The user closed the interview without picking." })
				}
				return ok({
					chosen: true,
					candidateId: chosen,
					next: "Call commit_foundation with this candidateId to write it.",
				})
			},
		},

		{
			name: "commit_foundation",
			title: "Save the chosen foundation",
			description:
				"Writes the foundation the user picked and regenerates the rules files every agent session reads. Call this immediately after present_options returns a candidateId — an interview that is never committed leaves the project with no foundations at all.",
			inputSchema: {
				candidateId: z.string().describe("The candidateId returned by present_options"),
				tags: z.array(z.string()).default([]).describe("The vibe tags, recorded with the foundation"),
				seed: z
					.string()
					.optional()
					.describe("Overrides the palette's brand colour, if the user asked for a specific one"),
			},
			async handler(ctx: ToolContext, args: { candidateId: string; tags?: string[]; seed?: string }) {
				const candidate = resolveCandidate(args.candidateId, args.tags ?? [])
				if (!candidate) {
					return fail(`"${args.candidateId}" is not a candidate from present_options.`)
				}

				const tokens = args.seed
					? {
							...candidate.tokens,
							color: { ...candidate.tokens.color, brand: { ...candidate.tokens.color.brand, seed: args.seed } },
						}
					: candidate.tokens

				try {
					await writeFoundationTokens(ctx.projectPath, tokens)
					await regenerateRulesFiles(ctx.projectPath)
					await recordEdit(ctx.projectPath, {
						actor: "agent",
						action: "write",
						file: "tokens/foundation.json",
						note: `foundation interview → ${candidate.name}`,
					})
				} catch (err) {
					Logger.error("[interview] commit_foundation failed:", err)
					return fail(err instanceof Error ? err.message : String(err))
				}

				return ok({
					ok: true,
					name: candidate.name,
					typeface: candidate.typeface.name,
					palette: candidate.palette.name,
					// The restraint rule is the part that has to survive into every
					// later page, so it is handed straight back to the agent too.
					rule: candidate.palette.rule,
				})
			},
		},
	]
}

function present(candidate: ReturnType<typeof narrowCandidates>[number]): PresentedCandidate {
	return {
		id: candidate.id,
		name: candidate.name,
		summary: candidate.summary,
		fontUrl: candidateFontUrl(candidate),
		displayFamily: candidate.typeface.display.family,
		displayFallback: candidate.typeface.display.fallback,
		bodyFamily: candidate.typeface.body.family,
		bodyFallback: candidate.typeface.body.fallback,
		surface: candidate.palette.surface,
		brandColor: candidate.tokens.color.brand.seed,
		neutralCharacter: candidate.palette.neutral,
		radius: candidate.shape.radius.scale,
		baseSize: candidate.shape.baseSize,
	}
}

/**
 * The interview script, shipped as an MCP prompt.
 *
 * Written as instructions to the agent rather than as a fixed sequence, because
 * an agent that already knows the product from context should skip questions
 * rather than ask them again — being asked what you are building by something
 * that just read your repo is worse than not being asked at all.
 */
export const INTERVIEW_PROMPT = `You are setting up the visual foundations for this project with the user.

Run a short interview — five questions at most, fewer if you can already answer some
of them from the repository. Ask in plain language about the product and how it should
feel. Never ask about type scales, radius values, saturation or spacing units: the user
is a developer who is not a designer, and those questions get a guess rather than an
answer.

Use \`present_question\` for each question. Suggested questions, which you should adapt
or skip as appropriate:

${INTERVIEW_QUESTIONS.map((q, i) => `${i + 1}. ${q.question}\n   ${q.choices.map((c) => `- ${c.label}`).join("\n   ")}`).join("\n")}

From the answers, infer a set of vibe tags and call \`present_options\` with them. Caret
narrows its curated library and renders complete foundations as live specimens for the
user to point at. You cannot pass your own colours or font names — that is deliberate,
and it is what keeps the floor high.

When the user picks one, call \`commit_foundation\` immediately with the returned
candidateId. Then tell them, in one or two sentences, what they chose and the one
restraint rule that comes with it, so they know what it means for everything you build
next.`

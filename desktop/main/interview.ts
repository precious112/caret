/**
 * The foundation interview's request/response plumbing.
 *
 * An agent calls `present_question` or `present_options` and waits; the chrome
 * renders it, the user points at something, and the answer travels back to the
 * still-open tool call. That is unusual for MCP — most tools return immediately
 * — but it is the right shape here: the agent is running a conversation whose
 * other participant is a human looking at rendered specimens, not text.
 *
 * A pending prompt is deliberately *not* given a short timeout. Someone
 * comparing typefaces may take minutes, and timing out would hand the agent an
 * error it would most likely respond to by inventing an answer — which is the
 * one thing the curated library exists to prevent.
 */
import { randomUUID } from "crypto"

import { Logger } from "../../src/shared/services/Logger"

export interface InterviewPromptBase {
	id: string
	/** Progress, so the user can see how much is left. */
	step?: number
	total?: number
}

export interface QuestionPrompt extends InterviewPromptBase {
	kind: "question"
	question: string
	hint?: string
	choices: string[]
}

export interface OptionsPrompt extends InterviewPromptBase {
	kind: "options"
	title: string
	subtitle?: string
	candidates: PresentedCandidate[]
}

/** A candidate rendered as something to look at, never as a list of values. */
export interface PresentedCandidate {
	id: string
	name: string
	summary: string
	/** Google Fonts CSS URL, so the specimen renders in the real typeface. */
	fontUrl: string
	displayFamily: string
	bodyFamily: string
	brandColor: string
	neutralCharacter: string
	radius: number[]
	baseSize: number
}

export type InterviewPrompt = QuestionPrompt | OptionsPrompt

interface Pending {
	prompt: InterviewPrompt
	resolve(answer: string | null): void
}

const pending = new Map<string, Pending>()

/** Sends a prompt to the chrome and resolves with whatever the user picks. */
export function askUser(
	send: (prompt: InterviewPrompt) => void,
	prompt: Omit<QuestionPrompt, "id"> | Omit<OptionsPrompt, "id">,
): Promise<string | null> {
	const id = randomUUID()
	const full = { ...prompt, id } as InterviewPrompt

	return new Promise<string | null>((resolve) => {
		pending.set(id, { prompt: full, resolve })
		send(full)
	})
}

/** Delivers the user's answer. Called from the IPC layer. */
export function answerInterviewPrompt(id: string, answer: string | null): boolean {
	const entry = pending.get(id)
	if (!entry) return false
	pending.delete(id)
	entry.resolve(answer)
	return true
}

/**
 * Cancels every waiting prompt, resolving them null.
 *
 * Called when the project closes. Without this, an agent's tool call would hang
 * forever against a window that no longer exists.
 */
export function cancelInterviewPrompts(): void {
	for (const [id, entry] of pending) {
		pending.delete(id)
		entry.resolve(null)
	}
	Logger.info("[interview] cancelled all pending prompts")
}

export function hasPendingPrompt(): boolean {
	return pending.size > 0
}

/**
 * A half-finished interview, on disk.
 *
 * The interview asks a model to rank each step, which takes seconds and costs
 * the user's own quota. Losing four of those to a crash, a closed window, or a
 * backend that went away at step three is not a small annoyance — it is the
 * whole reason someone abandons the flow and ships without foundations.
 *
 * So every answer is written as it is given, and reopening resumes at the step
 * that was in progress. Gitignored, because a half-finished interview is not a
 * design decision anyone should review; deleted on commit, because the moment
 * `foundation.json` exists the scratch is a stale copy of a real file.
 */
import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import type { Decisions } from "./steps"

export interface InterviewScratch {
	/** What the user typed at the entry screen — the only typing in the flow. */
	description: string
	decisions: Decisions
	/** Index into `INTERVIEW_STEPS`; equal to the length when the interview is at the summary. */
	stepIndex: number
	updatedAt: number
}

function scratchPath(projectPath: string): string {
	return path.join(projectPath, ".caret", ".interview.json")
}

export async function readScratch(projectPath: string): Promise<InterviewScratch | null> {
	try {
		const raw = await fs.readFile(scratchPath(projectPath), "utf8")
		const parsed = JSON.parse(raw) as Partial<InterviewScratch>
		// A description is what every later step is grounded in; without one there
		// is nothing to resume, and offering to resume an empty interview is worse
		// than starting cleanly.
		if (typeof parsed.description !== "string" || !parsed.description.trim()) return null
		return {
			description: parsed.description,
			decisions: parsed.decisions ?? {},
			stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
			updatedAt: parsed.updatedAt ?? 0,
		}
	} catch {
		// Absent or unparseable are the same thing to a caller: nothing to resume.
		return null
	}
}

export async function writeScratch(projectPath: string, scratch: Omit<InterviewScratch, "updatedAt">): Promise<void> {
	try {
		const file = scratchPath(projectPath)
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, `${JSON.stringify({ ...scratch, updatedAt: Date.now() }, null, 2)}\n`)
	} catch (err) {
		// Scratch is a convenience, never a precondition. An unwritable project
		// should cost the user their resume point, not their interview.
		Logger.warn(`[interview] could not save progress: ${err}`)
	}
}

export async function clearScratch(projectPath: string): Promise<void> {
	await fs.rm(scratchPath(projectPath), { force: true }).catch(() => {})
}

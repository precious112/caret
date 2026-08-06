/**
 * The in-app foundation interview.
 *
 * Caret owns the state machine; the model supplies judgment inside a space the
 * library already bounded. See `steps.ts` for the sequence, `run.ts` for how a
 * step is ranked (and how it degrades), `scratch.ts` for resuming, and
 * `commit.ts` for the file Caret writes itself.
 */
export { buildFoundation, type CommittedFoundation, IncompleteInterviewError } from "./commit"
export { RANKED_COUNT, type RankedOption, type RankStepInput, rankStep, type StepRanking } from "./run"
export { clearScratch, type InterviewScratch, readScratch, writeScratch } from "./scratch"
export {
	type Decisions,
	INTERVIEW_STEPS,
	type InterviewStep,
	type StepId,
	type StepOption,
	stepAt,
	tagsFromDescription,
} from "./steps"

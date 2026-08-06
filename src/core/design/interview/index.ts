/**
 * The foundation interview, both doors.
 *
 * **The wizard** is the feature: the model runs the interview, composing every
 * question from the widget vocabulary (`widgets.ts`), one validated turn at a
 * time (`conductor.ts`), finishing in a parameter proposal that Caret alone
 * turns into `foundation.json` (`finalize.ts`). Progress survives a crash
 * (`scratch.ts`).
 *
 * **The presets flow** (`steps.ts` + `commit.ts`) is the deterministic
 * secondary tab: fixed curated steps, no model anywhere, for someone who wants
 * full control.
 */
export { buildFoundation, type CommittedFoundation, IncompleteInterviewError } from "./commit"
export { type ConductorInput, nextWizardTurn, QUESTION_CAP, validateQuestion, WizardTurnError } from "./conductor"
export { type FinalizedFoundation, finalizeProposal, ProposalError } from "./finalize"
export { clearWizardScratch, readWizardScratch, type WizardScratch, writeWizardScratch } from "./scratch"
export {
	type Decisions,
	deterministicOptions,
	INTERVIEW_STEPS,
	type InterviewStep,
	type StepId,
	type StepOption,
	stepAt,
	tagsFromDescription,
} from "./steps"
export {
	type FoundationProposal,
	normalizeHex,
	type ScaleStep,
	type SpecimenParams,
	type StoredQA,
	WIZARD_TURN_SCHEMA,
	type WidgetKind,
	type WizardAnswer,
	type WizardOption,
	type WizardQuestion,
	type WizardTurn,
} from "./widgets"

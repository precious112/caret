/**
 * The Presets tab — host half.
 *
 * The deterministic secondary path: fixed curated steps, options ordered by
 * the description's tags, no model anywhere. It exists for someone who wants
 * full control and identical screens on every machine; the AI-run wizard
 * (`token-wizard.ts`) is the default door.
 *
 * Sessions are in-memory only. Four clicks is nothing to lose, and persisting
 * them would make "resume" ambiguous between this flow and the wizard's.
 */
import {
	buildFoundation,
	type Decisions,
	deterministicOptions,
	findPairing,
	findPreset,
	findRecipe,
	googleFontsUrl,
	INTERVIEW_STEPS,
	PALETTE_RECIPES,
	SHAPE_PRESETS,
	type StepId,
	type StepOption,
	TYPEFACE_PAIRINGS,
	tagsFromDescription,
	writeFoundationTokens,
} from "../../src/core/design"
import { recordEdit } from "../../src/core/design/provenance"
import type { InterviewStateWire, InterviewStepWire, RankedOptionWire, SpecimenWire } from "../shared/ipc"
import { regenerateRulesFiles } from "./rules/generate"

interface Session {
	description: string
	decisions: Decisions
	stepIndex: number
}

const sessions = new Map<string, Session>()

/** The library's first of everything — only reachable if a stored id vanished. */
const FALLBACK = {
	typeface: TYPEFACE_PAIRINGS[0],
	palette: PALETTE_RECIPES[0],
	shape: SHAPE_PRESETS[0],
}

/**
 * A decision set rendered as one specimen.
 *
 * Partial by design: at the typeface step there is no palette yet, so the
 * specimen borrows the first palette the pairing is declared to work with. The
 * alternative — grey placeholders until the colour step — would ask the user to
 * judge a typeface in a context it will never appear in.
 */
function specimenFor(decisions: Decisions): SpecimenWire {
	const typeface = (decisions.typeface ? findPairing(decisions.typeface) : undefined) ?? FALLBACK.typeface
	const palette =
		(decisions.palette ? findRecipe(decisions.palette) : undefined) ??
		findRecipe(typeface.pairsWith.palettes[0]) ??
		FALLBACK.palette
	const shape =
		(decisions.shape ? findPreset(decisions.shape) : undefined) ?? findPreset(typeface.pairsWith.shapes[0]) ?? FALLBACK.shape

	return {
		fontUrl: googleFontsUrl(typeface),
		displayFamily: typeface.display.family,
		displayFallback: typeface.display.fallback,
		bodyFamily: typeface.body.family,
		bodyFallback: typeface.body.fallback,
		surface: palette.surface,
		brandColor: decisions.brand ?? palette.seed,
		neutralCharacter: palette.neutral,
		radius: shape.radius.scale,
		spacingUnit: shape.spacing.baseUnit,
		baseSize: shape.baseSize,
	}
}

/** One option as something to look at — this option applied over the decisions so far. */
function optionWire(stepId: StepId, option: StepOption, decisions: Decisions): RankedOptionWire {
	return {
		id: option.id,
		name: option.name,
		summary: option.summary,
		specimen: specimenFor({ ...decisions, [stepId]: option.id }),
	}
}

function stateFor(session: Session): InterviewStateWire {
	const step = INTERVIEW_STEPS[session.stepIndex]

	if (!step) {
		const decisions = session.decisions as Record<string, string>
		const typeface = session.decisions.typeface ? findPairing(session.decisions.typeface) : undefined
		const palette = session.decisions.palette ? findRecipe(session.decisions.palette) : undefined
		return {
			phase: "summary",
			description: session.description,
			decisions,
			preview: specimenFor(session.decisions),
			name: typeface && palette ? `${typeface.name} · ${palette.name}` : "Your foundation",
		}
	}

	const tags = tagsFromDescription(session.description)
	const current: InterviewStepWire = {
		stepId: step.id,
		title: step.title,
		subtitle: step.subtitle,
		step: session.stepIndex + 1,
		total: INTERVIEW_STEPS.length,
		options: deterministicOptions(step, session.decisions, tags).map((option) =>
			optionWire(step.id, option, session.decisions),
		),
		decisions: session.decisions as Record<string, string>,
	}
	return { phase: "step", description: session.description, current }
}

/** The in-memory session, or null — this flow deliberately does not persist. */
export function resumeInterview(projectPath: string): InterviewStateWire | null {
	const session = sessions.get(projectPath)
	return session ? stateFor(session) : null
}

export function startInterview(projectPath: string, description: string): InterviewStateWire {
	const session: Session = { description: description.trim(), decisions: {}, stepIndex: 0 }
	sessions.set(projectPath, session)
	return stateFor(session)
}

export function answerStep(projectPath: string, stepId: string, optionId: string): InterviewStateWire {
	const session = sessions.get(projectPath)
	if (!session) throw new Error("There is no interview in progress.")

	// Keyed by the step's own id rather than by position, so an answer that
	// arrives after Back lands on the step it belongs to.
	session.decisions = { ...session.decisions, [stepId as StepId]: optionId }
	const answeredIndex = INTERVIEW_STEPS.findIndex((step) => step.id === stepId)
	session.stepIndex = Math.min(answeredIndex + 1, INTERVIEW_STEPS.length)
	return stateFor(session)
}

export function stepBack(projectPath: string): InterviewStateWire {
	const session = sessions.get(projectPath)
	if (!session) throw new Error("There is no interview in progress.")

	session.stepIndex = Math.max(0, session.stepIndex - 1)
	// The decision being revisited is cleared, so the steps it gates re-derive
	// against what the user actually chooses rather than a stale answer.
	const step = INTERVIEW_STEPS[session.stepIndex]
	if (step) delete session.decisions[step.id]
	return stateFor(session)
}

/** Writes the foundation — in Caret's own code, from curated pieces. */
export async function commitInterview(projectPath: string): Promise<{ name: string; rule: string }> {
	const session = sessions.get(projectPath)
	if (!session) throw new Error("There is no interview in progress.")

	const foundation = buildFoundation(session.description, session.decisions)
	await writeFoundationTokens(projectPath, foundation.tokens)
	await regenerateRulesFiles(projectPath)
	await recordEdit(projectPath, {
		actor: "caret",
		action: "write",
		file: "tokens/foundation.json",
		note: `foundation presets → ${foundation.name}`,
	})

	sessions.delete(projectPath)
	return { name: foundation.name, rule: foundation.rule }
}

export function abandonInterview(projectPath: string): void {
	sessions.delete(projectPath)
}

/**
 * The in-app foundation interview — host half.
 *
 * The design core owns the sequence and the ranking; this is where it meets a
 * project: which backend to use, where scratch lives, and turning library
 * objects into the specimen fields the renderer draws with.
 *
 * **One interview per project, held in memory, backed by scratch on disk.** The
 * in-memory copy is what makes Back instant and keeps a re-render from spending
 * a model call; the disk copy is what survives the window closing. The two are
 * written together and the disk one always wins on load.
 */
import {
	buildFoundation,
	type CodingBackend,
	clearScratch,
	type Decisions,
	findPairing,
	findPreset,
	findRecipe,
	getBackend,
	googleFontsUrl,
	INTERVIEW_STEPS,
	PALETTE_RECIPES,
	rankStep,
	readScratch,
	SHAPE_PRESETS,
	type StepId,
	TYPEFACE_PAIRINGS,
	writeFoundationTokens,
	writeScratch,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import type { InterviewStateWire, InterviewStepWire, RankedOptionWire, SpecimenWire } from "../shared/ipc"
import { getPrefs } from "./prefs"
import { recordEdit } from "./provenance"
import { regenerateRulesFiles } from "./rules/generate"

interface Session {
	description: string
	decisions: Decisions
	stepIndex: number
}

const sessions = new Map<string, Session>()

/** The configured backend, but only if it is ready — a signed-out CLI is not one. */
async function resolveBackend(): Promise<CodingBackend | null> {
	const id = getPrefs().backendId
	if (!id) return null
	try {
		const backend = getBackend(id)
		return (await backend.availability()).ready ? backend : null
	} catch (err) {
		Logger.warn(`[foundation] backend check failed, running deterministically: ${err}`)
		return null
	}
}

/**
 * A decision set rendered as one specimen.
 *
 * Partial by design: at the typeface step there is no palette yet, so the
 * specimen borrows the first palette the pairing is declared to work with. The
 * alternative — grey placeholder specimens until the colour step — would ask
 * the user to judge a typeface in a context it will never appear in.
 */
function specimenFor(decisions: Decisions): SpecimenWire {
	const typeface = (decisions.typeface ? findPairing(decisions.typeface) : undefined) ?? INTERVIEW_FALLBACK.typeface
	const palette =
		(decisions.palette ? findRecipe(decisions.palette) : undefined) ??
		findRecipe(typeface.pairsWith.palettes[0]) ??
		INTERVIEW_FALLBACK.palette
	const shape =
		(decisions.shape ? findPreset(decisions.shape) : undefined) ??
		findPreset(typeface.pairsWith.shapes[0]) ??
		INTERVIEW_FALLBACK.shape

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

/** The library's first of everything — only reachable if a stored id vanished. */
const INTERVIEW_FALLBACK = {
	typeface: TYPEFACE_PAIRINGS[0],
	palette: PALETTE_RECIPES[0],
	shape: SHAPE_PRESETS[0],
}

/**
 * One option, as something to look at.
 *
 * The specimen is computed with *this option applied* on top of the decisions so
 * far, which is what makes the screen a comparison rather than a list: three
 * cards differing in exactly the thing being asked about.
 */
function optionWire(
	stepId: StepId,
	option: { id: string; name: string; summary: string; reason?: string },
	decisions: Decisions,
): RankedOptionWire {
	return {
		id: option.id,
		name: option.name,
		summary: option.summary,
		reason: option.reason,
		specimen: specimenFor({ ...decisions, [stepId]: option.id }),
	}
}

async function persist(projectPath: string, session: Session): Promise<void> {
	sessions.set(projectPath, session)
	await writeScratch(projectPath, {
		description: session.description,
		decisions: session.decisions,
		stepIndex: session.stepIndex,
	})
}

/** Ranks whatever step the session is on, or reports the summary. */
async function stateFor(projectPath: string, session: Session): Promise<InterviewStateWire> {
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

	const ranking = await rankStep({
		step,
		description: session.description,
		decisions: session.decisions,
		workingDirectory: projectPath,
		backend: await resolveBackend(),
		model: getPrefs().backendModel || undefined,
	})

	const current: InterviewStepWire = {
		stepId: step.id,
		title: step.title,
		subtitle: step.subtitle,
		step: session.stepIndex + 1,
		total: INTERVIEW_STEPS.length,
		options: ranking.options.map((option) => optionWire(step.id, option, session.decisions)),
		reasoned: ranking.reasoned,
		degradedBecause: ranking.degradedBecause,
		decisions: session.decisions as Record<string, string>,
	}
	return { phase: "step", description: session.description, current }
}

/** An interview left half-finished, or null. */
export async function resumeInterview(projectPath: string): Promise<InterviewStateWire | null> {
	const scratch = await readScratch(projectPath)
	if (!scratch) return null

	const session: Session = {
		description: scratch.description,
		decisions: scratch.decisions,
		stepIndex: Math.min(scratch.stepIndex, INTERVIEW_STEPS.length),
	}
	sessions.set(projectPath, session)
	return stateFor(projectPath, session)
}

export async function startInterview(projectPath: string, description: string): Promise<InterviewStateWire> {
	const session: Session = { description: description.trim(), decisions: {}, stepIndex: 0 }
	await persist(projectPath, session)
	return stateFor(projectPath, session)
}

export async function answerStep(projectPath: string, stepId: string, optionId: string): Promise<InterviewStateWire> {
	const session = sessions.get(projectPath)
	if (!session) throw new Error("There is no interview in progress.")

	// Keyed by the step's own id rather than by position, so an answer that
	// arrives after the user pressed Back lands on the step it belongs to instead
	// of overwriting a different decision.
	session.decisions = { ...session.decisions, [stepId as StepId]: optionId }
	const answeredIndex = INTERVIEW_STEPS.findIndex((step) => step.id === stepId)
	session.stepIndex = Math.min(answeredIndex + 1, INTERVIEW_STEPS.length)

	await persist(projectPath, session)
	return stateFor(projectPath, session)
}

export async function stepBack(projectPath: string): Promise<InterviewStateWire> {
	const session = sessions.get(projectPath)
	if (!session) throw new Error("There is no interview in progress.")

	session.stepIndex = Math.max(0, session.stepIndex - 1)
	// The decision being revisited is cleared, so the step it gated is re-ranked
	// against what the user actually chose rather than against a stale answer.
	const step = INTERVIEW_STEPS[session.stepIndex]
	if (step) delete session.decisions[step.id]

	await persist(projectPath, session)
	return stateFor(projectPath, session)
}

/**
 * Writes the foundation — in Caret's own code, from curated pieces.
 *
 * The model never gets near this. What it ranked is already spent; what lands on
 * disk is assembled from library ids the user pointed at.
 */
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
		note: `foundation interview → ${foundation.name}`,
	})

	// Scratch is a resume point for an unfinished interview. Once the real file
	// exists it is a stale copy, and offering to "resume" into it would silently
	// re-propose decisions the user already committed.
	await clearScratch(projectPath)
	sessions.delete(projectPath)

	return { name: foundation.name, rule: foundation.rule }
}

export async function abandonInterview(projectPath: string): Promise<void> {
	sessions.delete(projectPath)
	await clearScratch(projectPath)
}

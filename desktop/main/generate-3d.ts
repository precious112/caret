/**
 * Image → 3D, with an LLM deciding how hard to optimize.
 *
 * The pipeline: pick an image asset (uploaded or generated — both are assets by
 * the time this runs, which is why one picker covers both), Tripo builds a
 * draft model from it, the chosen LLM reads the draft's stats and the intended
 * use and decides convert parameters inside a bounded schema, Tripo applies
 * them, and the result lands through the same §4.6 pipeline as everything else.
 *
 * **A paid draft is never thrown away.** The image→model step spends the user's
 * credits; if the optimization step then fails — no backend, a structured-output
 * error, a convert failure — the draft is kept and offered as-is, with the skip
 * recorded. Failing the whole run because the *cheap* step broke would bill the
 * user for nothing, which is the one outcome worse than an unoptimized model.
 */
import * as fs from "fs/promises"
import * as path from "path"

import {
	addGeneratedAsset,
	assetsDirectory,
	decideOptimization,
	findAsset,
	getBackend,
	NO_TRIPO_REASON,
	type OptimizationDecision,
	readAssetIndex,
	resolveTripoConfig,
	TripoClient,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { getPrefs } from "./prefs"
import { getSecret } from "./secrets"
import { canSeeImages } from "./vision-cache"

export interface Model3dProgress {
	stage: string
	detail?: string
}

export interface Model3dOutcome {
	ok: boolean
	draftBytes?: number
	optimizedBytes?: number
	optimization?: OptimizationDecision
	model?: string
	reason?: string
	needsAnotherModel?: boolean
	/** The source failed verification — the fix is a different image, not a retry. */
	badSource?: boolean
}

interface PendingModel {
	bytes: Buffer
	sourceTag: string
	draftBytes: number
	optimization: OptimizationDecision | null
	optimizerModel: string
	taskIds: { draft: string; converted?: string }
	at: number
}

/** One held result per project — the flow is one object at a time by design. */
const pending = new Map<string, PendingModel>()

function tripoClient(): TripoClient | null {
	const config = resolveTripoConfig({ apiKey: getSecret("tripoApiKey") })
	return config ? new TripoClient(config) : null
}

export function tripoAvailable(): boolean {
	return tripoClient() !== null
}

export async function generateModel3d(
	projectPath: string,
	sourceTag: string,
	onProgress: (update: Model3dProgress) => void,
): Promise<Model3dOutcome> {
	const client = tripoClient()
	if (!client) return { ok: false, reason: NO_TRIPO_REASON }

	const index = await readAssetIndex(projectPath)
	const source = findAsset(index, sourceTag)
	if (!source) return { ok: false, reason: `No asset tagged "${sourceTag}".` }
	if (source.kind !== "image") {
		return { ok: false, reason: `@${sourceTag} is a ${source.kind} — Tripo takes a raster image as its source.` }
	}

	let bytes: Buffer
	try {
		bytes = await fs.readFile(path.join(assetsDirectory(projectPath), source.file))
	} catch (err) {
		return { ok: false, reason: `Could not read @${sourceTag}: ${err instanceof Error ? err.message : String(err)}` }
	}

	// The verification layer: is this actually one object? Image-to-3D fuses a
	// scene into a single lump, so a workbench full of tools produces a model of
	// nothing — and the check costs one cheap vision turn against the credits the
	// draft would have spent. Skipped honestly when no vision-capable backend is
	// available, because a guard that cannot look should say so, not pretend.
	onProgress({ stage: "Checking the source is a single object" })
	const verdict = await verifySingleObject(projectPath, bytes, source.mime)
	if (verdict.checked && !verdict.singleObject) {
		return {
			ok: false,
			badSource: true,
			reason:
				`@${sourceTag} doesn't look like a single object — the model saw: ${verdict.sees}. ` +
				`3D generation works from one object on a plain background; generate a purpose-made source below, or pick a different image.`,
		}
	}
	if (!verdict.checked) {
		Logger.warn(`[3d] source verification skipped: ${verdict.why}`)
		onProgress({ stage: "Source check skipped", detail: verdict.why })
	}

	onProgress({ stage: "Uploading the source image to Tripo" })
	const uploaded = await client.uploadImage(bytes, source.mime)
	if (!uploaded.ok) return { ok: false, reason: uploaded.reason }

	onProgress({ stage: "Tripo is building the model", detail: "This is the slow step — a few minutes." })
	const draft = await client.imageToModel(uploaded.value, source.mime, (update) =>
		onProgress({ stage: update.stage, detail: update.percent !== undefined ? `${update.percent}%` : undefined }),
	)
	if (!draft.ok) return { ok: false, reason: draft.reason }

	const draftBytes = draft.value.bytes.length
	Logger.info(`[3d] draft for @${sourceTag}: ${Math.round(draftBytes / 1024)}KB`)

	// The optimization pass. Every failure from here keeps the draft.
	const prefs = getPrefs()
	const optimizerModel = prefs.laneModels.model3d?.trim() || prefs.backendModel || ""
	let decision: OptimizationDecision | null = null
	let converted: { bytes: Buffer; taskId: string } | null = null
	let skipNote = ""

	if (!prefs.backendId) {
		skipNote = "No coding backend is configured, so the model was kept as Tripo produced it."
	} else {
		const backend = await getBackend(prefs.backendId)
		if (!backend) {
			skipNote = `The "${prefs.backendId}" backend is unavailable, so the model was kept as Tripo produced it.`
		} else {
			try {
				onProgress({ stage: "Asking the model how far to optimize", detail: optimizerModel || "session model" })
				decision = await decideOptimization({
					backend,
					workingDirectory: projectPath,
					model: optimizerModel,
					draftBytes,
					intendedUse: "a decorative 3D object embedded in a product web page",
					sourceDescription: source.description || undefined,
				})

				onProgress({
					stage: "Tripo is applying the optimization",
					detail: `${decision.faceLimit.toLocaleString()} faces, ${decision.textureSize}px textures`,
				})
				const result = await client.convertModel(
					draft.value.taskId,
					{ faceLimit: decision.faceLimit, textureSize: decision.textureSize },
					(update) =>
						onProgress({
							stage: update.stage,
							detail: update.percent !== undefined ? `${update.percent}%` : undefined,
						}),
				)
				if (result.ok) {
					converted = result.value
				} else {
					skipNote = `The optimization pass failed (${result.reason}), so the draft was kept.`
				}
			} catch (err) {
				skipNote = `The optimizer could not decide (${err instanceof Error ? err.message : String(err)}), so the draft was kept.`
			}
		}
	}

	// A "converted" model that grew is an optimization that did not optimize.
	// Keep whichever is smaller and say so.
	const chosen = converted && converted.bytes.length < draftBytes ? converted : null
	if (converted && !chosen) {
		skipNote = `The optimized version came back larger (${Math.round(converted.bytes.length / 1024)}KB), so the draft was kept.`
	}

	pending.set(projectPath, {
		bytes: chosen?.bytes ?? draft.value.bytes,
		sourceTag,
		draftBytes,
		optimization: chosen ? decision : null,
		optimizerModel: optimizerModel || "(session model)",
		taskIds: { draft: draft.value.taskId, ...(chosen ? { converted: chosen.taskId } : {}) },
		at: Date.now(),
	})

	if (skipNote) Logger.warn(`[3d] ${skipNote}`)
	return {
		ok: true,
		draftBytes,
		optimizedBytes: (chosen?.bytes ?? draft.value.bytes).length,
		optimization: chosen ? (decision ?? undefined) : undefined,
		model: optimizerModel || "(session model)",
		...(skipNote ? { reason: skipNote } : {}),
	}
}

/** Commits the held model. The glb never round-trips through the renderer. */
export async function acceptModel3d(projectPath: string, tag: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
	const held = pending.get(projectPath)
	if (!held) return { ok: false, error: "No generated model is waiting. Generate one first." }

	const description = held.optimization
		? `3D model generated from @${held.sourceTag}, optimized to ${held.optimization.faceLimit.toLocaleString()} faces / ${held.optimization.textureSize}px textures. ${held.optimization.reason}`
		: `3D model generated from @${held.sourceTag}, unoptimized.`

	const result = await addGeneratedAsset({
		projectPath,
		tag: tag.trim() || `${held.sourceTag}-3d`,
		extension: ".glb",
		bytes: held.bytes,
		description,
		alt: "",
		origin: {
			type: "generated",
			lane: "model3d",
			producer: "tripo",
			answers: { source: held.sourceTag },
			resolved: JSON.stringify({
				taskIds: held.taskIds,
				draftBytes: held.draftBytes,
				finalBytes: held.bytes.length,
				optimization: held.optimization,
				optimizerModel: held.optimizerModel,
			}),
		},
	})

	if (result.ok) pending.delete(projectPath)
	return result.ok ? { ok: true, tag: result.entry.tag } : { ok: false, error: result.reason }
}

export function discardModel3d(projectPath: string): void {
	pending.delete(projectPath)
}

type SourceVerdict = { checked: true; singleObject: boolean; sees: string } | { checked: false; why: string }

/**
 * Asks the session's vision to look at the source before Tripo spends on it.
 *
 * The same probe pattern as the vision check, and for the same reason: parsing
 * a constrained first word out of a real look at the pixels. `structured()`
 * cannot carry an image, so this is a session turn, not a schema call.
 */
async function verifySingleObject(projectPath: string, image: Buffer, mime: string): Promise<SourceVerdict> {
	const prefs = getPrefs()
	if (!prefs.backendId) return { checked: false, why: "no coding backend is configured" }

	const model = prefs.laneModels.model3d?.trim() || prefs.backendModel || ""
	const vision = await canSeeImages(prefs.backendId, model, projectPath)
	if (!vision.sees) return { checked: false, why: "the selected model cannot be shown images" }

	const backend = await getBackend(prefs.backendId)
	if (!backend) return { checked: false, why: `the "${prefs.backendId}" backend is unavailable` }

	let session: Awaited<ReturnType<typeof backend.startSession>> | null = null
	let answer = ""
	try {
		session = await backend.startSession({
			workingDirectory: projectPath,
			mode: "read-only",
			model: model || undefined,
			title: "caret source check",
		})
		for await (const event of session.send({
			text:
				"This image is a candidate source for image-to-3D reconstruction, which needs ONE main object on a simple background. " +
				"First word of your reply, exactly: SINGLE if it shows one main object, MULTIPLE if several distinct objects, SCENE if it is a scene, landscape, texture or background. " +
				"Then, after a dash, one short sentence describing what you see.",
			images: [`data:${mime};base64,${image.toString("base64")}`],
		})) {
			if (event.type === "text" || event.type === "done") answer += event.text
		}
	} catch (err) {
		return { checked: false, why: err instanceof Error ? err.message : String(err) }
	} finally {
		await session?.close().catch(() => {})
	}

	const first =
		answer
			.trim()
			.split(/[\s—-]+/)[0]
			?.toUpperCase() ?? ""
	const sees =
		answer
			.trim()
			.replace(/^\w+\s*[—-]?\s*/, "")
			.slice(0, 200) || answer.trim().slice(0, 200)
	if (first === "SINGLE") return { checked: true, singleObject: true, sees }
	if (first === "MULTIPLE" || first === "SCENE") return { checked: true, singleObject: false, sees }
	// An answer outside the vocabulary is a check that did not happen, not a
	// verdict — refusing the user's image on a garbled reply would be guessing.
	return { checked: false, why: `the model answered outside the expected vocabulary: "${answer.trim().slice(0, 80)}"` }
}

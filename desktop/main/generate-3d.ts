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

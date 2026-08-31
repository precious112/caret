/**
 * Running the cutout model on a bitmap.
 *
 * The download half lives in `matte.ts`; this is the inference half — the part
 * that was missing while every "cutout" went through a white threshold instead
 * (the shadow-puddle era: nano banana paints a soft shadow no prompt talks it
 * out of, the shadow sits just under any white cutoff, and a dark page wears
 * the result as a dirty smear under every object).
 *
 * One session per process, created lazily: opening a 224MB network costs real
 * seconds and the session is immutable afterwards. Creation is also the one
 * true test of the file — `looksComplete` only proves the size — so a file the
 * runtime cannot open is deleted and re-fetched rather than tripping every
 * cutout forever ("exists" is not "works", fourth instance).
 */
import * as fs from "fs/promises"
import { createRequire } from "module"

import type { KeyableImage, KeyOutResult } from "../../src/core/design"
import { applyMatte, MATTE_MODEL, matteInputTensor, progressOf } from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { ensureMatteModel, matteState, modelPath } from "./matte"

// The main bundle is ESM ("type": "module"), where no `require` exists — a
// bare one compiled fine and threw at runtime on the first real cutout.
// createRequire is the ESM road to a native module.
const requireNative = createRequire(import.meta.url)

// Typed loosely on purpose: onnxruntime-node is a native module loaded at
// first use, not import time — pulling its types in would also pull the
// binding into every bundle that imports this file.
type OrtSession = {
	inputNames: string[]
	outputNames: string[]
	run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>
}

let session: Promise<OrtSession> | null = null

async function openSession(): Promise<OrtSession> {
	const ort = requireNative("onnxruntime-node")
	const path = modelPath()
	try {
		// "basic", measured, not a default: this export carries external-tensor
		// metadata that "all" and "disabled" both trip over during shape
		// inference ("Cannot parse data from external tensors") while "basic"
		// opens it in ~3s. The same bytes run fine in Python ORT — the md5
		// matches rembg's known-good copy — so it is the optimizer path, not
		// the file.
		return await ort.InferenceSession.create(path, { graphOptimizationLevel: "basic" })
	} catch (error) {
		// The size matched and the runtime still refused it: the bytes are wrong,
		// not incomplete. Delete so the next boot's ensureMatteModel re-fetches.
		await fs.rm(path, { force: true }).catch(() => {})
		throw error
	}
}

/**
 * Cuts the subject out of a bitmap in place, or says exactly why it cannot.
 *
 * "Not ready" is a sentence with the download's own numbers in it rather than
 * a silent fall-through to a worse algorithm — a threshold cutout shipped
 * quietly is how the shadow puddles got into a user's git history last time.
 */
export async function matteCutout(image: KeyableImage): Promise<KeyOutResult> {
	if (matteState().status !== "ready") {
		// A complete file that merely has not been stat-ed yet resolves in
		// milliseconds; a genuine download should not block this cutout for
		// minutes — it refuses with its own progress numbers instead.
		await Promise.race([ensureMatteModel(), new Promise((resolve) => setTimeout(resolve, 3000))])
		const current = matteState()
		if (current.status === "downloading") {
			return {
				ok: false,
				reason: `The cutout model is still downloading — ${progressOf(current.received, current.total).label}. Try again in a moment.`,
			}
		}
		if (current.status === "failed") {
			return {
				ok: false,
				reason: `The cutout model could not be fetched (${current.reason}) — it retries on the next launch.`,
			}
		}
		if (current.status !== "ready") {
			return {
				ok: false,
				reason: "The cutout model is not on this machine yet — it downloads in the background at project open.",
			}
		}
	}

	if (!session) {
		session = openSession().catch((error) => {
			session = null
			throw error
		})
	}

	let net: OrtSession
	try {
		net = await session
	} catch (error) {
		const why = error instanceof Error ? error.message : String(error)
		Logger.warn(`[matte] the runtime could not open the cutout model: ${why}`)
		return {
			ok: false,
			reason: `The cutout model on disk could not be opened (${why}) — it re-downloads on the next launch.`,
		}
	}

	const started = Date.now()
	const side = MATTE_MODEL.input
	const tensor = matteInputTensor(image, side)
	const ort = requireNative("onnxruntime-node")
	const feeds = { [net.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, side, side]) }

	let mask: Float32Array
	try {
		const results = await net.run(feeds)
		mask = results[net.outputNames[0]].data
	} catch (error) {
		const why = error instanceof Error ? error.message : String(error)
		Logger.warn(`[matte] inference failed: ${why}`)
		return { ok: false, reason: `The cutout model failed on this image: ${why}` }
	}

	const result = applyMatte(image, mask, side)
	Logger.info(
		`[matte] ${image.width}×${image.height} in ${((Date.now() - started) / 1000).toFixed(1)}s — ${
			result.ok ? `cut ${(result.cut * 100).toFixed(1)}%` : `refused: ${result.reason}`
		}`,
	)
	return result
}

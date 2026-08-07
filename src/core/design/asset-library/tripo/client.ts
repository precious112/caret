/**
 * The 3D lane's transport: Tripo's OpenAPI platform.
 *
 * Image → model, then a convert pass that applies the optimization parameters
 * an LLM chose. Tripo is a task queue, not a request/response API: create a
 * task, poll it, download what it produced. Minutes, not seconds — every caller
 * gets a progress callback, because a silent three-minute await reads as a hang.
 *
 * **Nothing here decides anything.** Which image, which face limit, which
 * texture size — those arrive decided. This file uploads, polls, downloads and
 * reports failures in the provider's own words, exactly like the Gemini
 * adapter, and for the same reason: "task failed" with the provider's sentence
 * attached names the fix; a paraphrase loses it.
 *
 * Field names follow the published OpenAPI spec. Where the spec and the live
 * service disagree, the live service wins — errors carry the raw response so a
 * mismatch is diagnosable from the message alone, not from a debugger.
 */
import { fetch } from "@/shared/net"

const BASE = "https://api.tripo3d.ai/v2/openapi"

/** How long each task type is allowed to take before Caret gives up on it. */
const TASK_TIMEOUT_MS: Record<string, number> = {
	image_to_model: 10 * 60 * 1000,
	convert_model: 6 * 60 * 1000,
}

export interface TripoConfig {
	apiKey: string
}

export interface TripoProgress {
	stage: string
	/** Tripo's own 0–100, when it reports one. */
	percent?: number
}

export type TripoResult<T> = { ok: true; value: T } | { ok: false; reason: string; retryable: boolean }

export interface TripoModelOutput {
	/** The glb, downloaded — Tripo's output URLs are temporary and expire. */
	bytes: Buffer
	taskId: string
}

export class TripoClient {
	constructor(private readonly config: TripoConfig) {}

	/** Uploads an image and returns the token a task references it by. */
	async uploadImage(bytes: Buffer, mime: string): Promise<TripoResult<string>> {
		const form = new FormData()
		const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg"
		form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `source.${extension}`)

		const response = await this.call("/upload/sts", { method: "POST", body: form })
		if (!response.ok) return response

		const token =
			(response.value as { image_token?: string; token?: string }).image_token ??
			(response.value as { token?: string }).token
		if (!token)
			return { ok: false, reason: `The upload returned no token: ${JSON.stringify(response.value)}`, retryable: false }
		return { ok: true, value: token }
	}

	/**
	 * Image → draft model. The heavy step, and the one that spends credits.
	 */
	async imageToModel(
		fileToken: string,
		mime: string,
		onProgress: (update: TripoProgress) => void,
	): Promise<TripoResult<TripoModelOutput>> {
		const type = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg"
		const created = await this.call("/task", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "image_to_model", file: { type, file_token: fileToken } }),
		})
		if (!created.ok) return created

		const taskId = (created.value as { task_id?: string }).task_id
		if (!taskId) return { ok: false, reason: `No task id in ${JSON.stringify(created.value)}`, retryable: false }

		return this.awaitModel(taskId, "image_to_model", onProgress)
	}

	/**
	 * Applies the optimization parameters to an existing model task.
	 *
	 * The parameters were decided by an LLM from the draft's stats and the
	 * intended use — this call is where that decision becomes bytes.
	 */
	async convertModel(
		originalTaskId: string,
		options: { faceLimit: number; textureSize: number },
		onProgress: (update: TripoProgress) => void,
	): Promise<TripoResult<TripoModelOutput>> {
		const created = await this.call("/task", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				type: "convert_model",
				format: "GLB",
				original_model_task_id: originalTaskId,
				face_limit: options.faceLimit,
				texture_size: options.textureSize,
			}),
		})
		if (!created.ok) return created

		const taskId = (created.value as { task_id?: string }).task_id
		if (!taskId) return { ok: false, reason: `No task id in ${JSON.stringify(created.value)}`, retryable: false }

		return this.awaitModel(taskId, "convert_model", onProgress)
	}

	/** Polls a task to completion and downloads the model it produced. */
	private async awaitModel(
		taskId: string,
		kind: string,
		onProgress: (update: TripoProgress) => void,
	): Promise<TripoResult<TripoModelOutput>> {
		const deadline = Date.now() + (TASK_TIMEOUT_MS[kind] ?? 5 * 60 * 1000)

		while (Date.now() < deadline) {
			const polled = await this.call(`/task/${taskId}`, { method: "GET" })
			if (!polled.ok) return polled

			const task = polled.value as {
				status?: string
				progress?: number
				output?: { pbr_model?: string; model?: string; base_model?: string }
			}

			if (task.status === "success") {
				// Preference order matters: pbr_model is the textured one.
				const url = task.output?.pbr_model ?? task.output?.model ?? task.output?.base_model
				if (!url) {
					return {
						ok: false,
						reason: `The task succeeded but returned no model URL: ${JSON.stringify(task.output)}`,
						retryable: false,
					}
				}
				onProgress({ stage: "Downloading the model" })
				return this.download(url, taskId)
			}

			if (task.status === "failed" || task.status === "cancelled" || task.status === "banned") {
				return { ok: false, reason: `Tripo reported the task ${task.status}.`, retryable: false }
			}

			onProgress({
				stage: task.status === "queued" ? "Waiting in Tripo's queue" : "Tripo is building the model",
				percent: typeof task.progress === "number" ? task.progress : undefined,
			})
			await new Promise((resolve) => setTimeout(resolve, 3000))
		}

		return { ok: false, reason: `The ${kind} task did not finish within its time limit.`, retryable: true }
	}

	private async download(url: string, taskId: string): Promise<TripoResult<TripoModelOutput>> {
		try {
			const response = await fetch(url)
			if (!response.ok)
				return { ok: false, reason: `Downloading the model failed with ${response.status}.`, retryable: true }
			const bytes = Buffer.from(await response.arrayBuffer())
			if (bytes.length === 0) return { ok: false, reason: "The downloaded model was empty.", retryable: true }
			return { ok: true, value: { bytes, taskId } }
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err), retryable: true }
		}
	}

	/** One call, with Tripo's envelope unwrapped and its errors carried whole. */
	private async call(pathname: string, init: RequestInit): Promise<TripoResult<Record<string, unknown>>> {
		let response: Response
		try {
			response = await fetch(`${BASE}${pathname}`, {
				...init,
				headers: { authorization: `Bearer ${this.config.apiKey}`, ...(init.headers as Record<string, string>) },
			})
		} catch (err) {
			return { ok: false, reason: err instanceof Error ? err.message : String(err), retryable: true }
		}

		const text = await response.text()
		let parsed: { code?: number; data?: Record<string, unknown>; message?: string; suggestion?: string }
		try {
			parsed = JSON.parse(text) as typeof parsed
		} catch {
			return {
				ok: false,
				reason: `${response.status} from Tripo: ${text.slice(0, 300)}`,
				retryable: response.status >= 500,
			}
		}

		if (!response.ok || (parsed.code !== undefined && parsed.code !== 0)) {
			// The provider's own message and its own suggestion, both — Tripo's
			// errors often carry a `suggestion` field that names the fix outright.
			const said = [parsed.message, parsed.suggestion].filter(Boolean).join(" — ")
			return {
				ok: false,
				reason: `${response.status} from Tripo${said ? `: ${said}` : `: ${text.slice(0, 300)}`}`,
				retryable: response.status === 429 || response.status >= 500,
			}
		}

		return { ok: true, value: parsed.data ?? {} }
	}
}

/**
 * Where the 3D lane's credentials come from. Same shape as the raster lane:
 * a stored secret is the shipped path, the environment is the test switch, and
 * null is the normal, non-error state of a machine with neither.
 */
export function resolveTripoConfig(
	sources: { apiKey?: string; env?: Record<string, string | undefined> } = {},
): TripoConfig | null {
	const env = sources.env ?? process.env
	const apiKey = sources.apiKey?.trim() || env.TRIPO_API_KEY?.trim()
	return apiKey ? { apiKey } : null
}

export const NO_TRIPO_REASON =
	"3D generation needs a Tripo API key, which you supply and pay for directly. " + "Everything else here works without one."

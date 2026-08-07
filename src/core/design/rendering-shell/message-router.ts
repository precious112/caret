/**
 * Routes messages arriving from the canvas to the design core.
 *
 * This is the host-free half of what used to be `preview-panel.ts`: the same
 * handlers, with the VS Code webview replaced by the {@link DesignHost} seam.
 * Nothing in here knows whether it is running inside an Electron window, a test
 * harness, or nothing at all.
 */
import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import type { AgentTask } from "../agent/bridge"
import { runExclusive } from "../file-mutation-queue"
import { mutateFlowDefinition } from "../flow-meta"
import { bridgeFor, editLaneFor, hostFor } from "../services"
import { editJSXColor, editJSXImageSrc, editJSXText } from "../visual-editing/ast-editor"
import { buildVisualEditPrompt } from "../visual-editing/context-builder"
import { precomputePage } from "../visual-editing/page-precompute"
import { precomputeAndApply } from "../visual-editing/post-generation-hook"
import type {
	AiEditRequestPayload,
	DesignInboundMessage,
	FlowEdgeCreatePayload,
	FlowEdgeDeletePayload,
	FlowEdgeUpdatePayload,
	InlineEditPayload,
	OverlayEditPayload,
} from "./messages"
import { isValidDesignMessagePayload } from "./messages"

export interface MessageRouterDeps {
	/** Absolute path of the project this canvas belongs to. */
	workspacePath: string
	/** Invoked when the canvas asks for a design→app sync (the toolbar button). */
	onSyncRequested: () => void | Promise<void>
}

export interface MessageRouter {
	handle(message: DesignInboundMessage): Promise<void>
}

export function createMessageRouter(deps: MessageRouterDeps): MessageRouter {
	return { handle: (message) => handleMessage(message, deps) }
}

function sendEditResult(workspacePath: string, payload: { success: boolean; error?: string; suggestAiEdit?: boolean }): void {
	hostFor(workspacePath).sendToCanvas({ source: "caret-host", type: "edit-result", payload })
}

/**
 * Hands a task to the connected agent, turning the no-agent case into a visible
 * edit-result rather than a swallowed rejection. Returns whether it was accepted.
 *
 * Visual edits go to the edit lane when the host wired one: their own
 * conversation, narrated to the canvas pill, never touching the chat. Sync and
 * flow-sync stay on the chat bridge — those are conversations the user follows
 * in the sidebar. Hosts without a lane fall back to the chat bridge, which is
 * the old behaviour.
 */
async function requestAgent(workspacePath: string, task: AgentTask): Promise<boolean> {
	const bridge =
		task.kind === "visual-edit" ? (editLaneFor(workspacePath) ?? bridgeFor(workspacePath)) : bridgeFor(workspacePath)
	try {
		await bridge.request(task)
		return true
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		Logger.warn(`[design] agent request (${task.kind}) refused: ${message}`)
		sendEditResult(workspacePath, { success: false, error: message })
		return false
	}
}

/**
 * Maps a path reported by the canvas onto a real file under `.caret/`.
 *
 * React fiber source paths arrive in several shapes depending on how the element
 * was authored, so each candidate location is probed rather than guessed at.
 */
async function resolveCaretPath(filePath: string, workspacePath: string): Promise<string> {
	if (!filePath) return filePath
	const caretDir = path.join(workspacePath, ".caret")

	if (path.isAbsolute(filePath) && filePath.startsWith(caretDir)) return filePath

	const relative = filePath.startsWith("/") ? filePath.slice(1) : filePath

	// Direct under .caret/ (handles "pages/home/index.tsx", "components/Button.tsx"),
	// then bare page names, then shared components.
	for (const candidate of [
		path.join(caretDir, relative),
		path.join(caretDir, "pages", relative),
		path.join(caretDir, "components", relative),
	]) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {}
	}

	Logger.warn(`[design] Could not resolve caret path: "${filePath}" (tried under .caret/, .caret/pages/, .caret/components/)`)
	return path.join(caretDir, relative)
}

async function handleMessage(message: DesignInboundMessage, deps: MessageRouterDeps): Promise<void> {
	if (!isValidDesignMessagePayload(message.type, message.payload)) {
		Logger.error(`[design] Ignoring malformed ${message.type} payload: ${JSON.stringify(message.payload)}`)
		return
	}

	const { workspacePath } = deps

	switch (message.type) {
		case "log": {
			const { level, message: msg } = message.payload
			if (level === "error") {
				Logger.error(`[design:canvas] ${msg}`)
			} else {
				Logger.info(`[design:canvas] ${msg}`)
			}
			break
		}

		case "element-selected":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			Logger.debug(
				`[design] Element selected: ${message.payload.componentName} at ${message.payload.filePath}:${message.payload.lineNumber}`,
			)
			break

		case "open-file":
			await hostFor(workspacePath).openInEditor(
				await resolveCaretPath(message.payload.filePath, workspacePath),
				message.payload.lineNumber,
			)
			break

		case "inline-edit":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleInlineEdit(message.payload, workspacePath)
			break

		case "ai-edit-request":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleAiEdit(message.payload, workspacePath)
			break

		case "overlay-edit":
			await handleOverlayEdit(message.payload, workspacePath)
			break

		case "page-focused":
			await handlePageFocused(message.payload.filePath, workspacePath)
			break

		case "flow-edge-create":
			await handleFlowEdgeCreate(message.payload, workspacePath)
			break

		case "flow-edge-delete":
			await handleFlowEdgeDelete(message.payload, workspacePath)
			break

		case "flow-edge-update":
			await handleFlowEdgeUpdate(message.payload, workspacePath)
			break

		case "design-sync-now":
			await deps.onSyncRequested()
			break

		case "edit-cancel":
			await editLaneFor(workspacePath)?.cancel()
			break

		case "edit-permission":
			await editLaneFor(workspacePath)?.respondToPermission(message.payload.requestId, message.payload.decision)
			break
	}
}

async function handleAiEdit(payload: AiEditRequestPayload, workspacePath: string): Promise<void> {
	try {
		const prompt = await buildVisualEditPrompt(payload, workspacePath)
		if (
			await requestAgent(workspacePath, {
				kind: "visual-edit",
				prompt,
				displayPrompt: payload.instruction,
				context: { filePath: payload.filePath, caretId: payload.caretId },
			})
		) {
			sendEditResult(workspacePath, { success: true })
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] AI edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleOverlayEdit(payload: OverlayEditPayload, workspacePath: string): Promise<void> {
	try {
		const resolvedFilePath = payload.filePath ? await resolveCaretPath(payload.filePath, workspacePath) : ""
		const prompt = await buildVisualEditPrompt(
			{
				instruction: payload.instruction,
				filePath: resolvedFilePath,
				lineNumber: 0,
				columnNumber: 0,
				componentName: "",
				caretId: "",
				componentStack: "",
			},
			workspacePath,
		)
		const images = payload.screenshotDataUrl ? [payload.screenshotDataUrl] : undefined
		if (
			await requestAgent(workspacePath, {
				kind: "visual-edit",
				prompt,
				displayPrompt: payload.instruction,
				images,
				context: { region: payload.regionBounds },
			})
		) {
			sendEditResult(workspacePath, { success: true })
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Overlay edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleInlineEdit(payload: InlineEditPayload, workspacePath: string): Promise<void> {
	try {
		// Serialized per file: rapid successive edits (or an edit racing the
		// precompute hook) must never interleave read-modify-writes.
		const success = await runExclusive(payload.filePath, async () => {
			if (payload.editType === "text") {
				return editJSXText(
					payload.filePath,
					payload.lineNumber,
					payload.tagName || "",
					payload.newValue,
					payload.oldValue,
					payload.caretId,
				)
			}
			if (payload.editType === "color") {
				return editJSXColor(payload.filePath, payload.lineNumber, payload.newValue, payload.caretId)
			}
			if (payload.editType === "image") {
				return handleImageEdit(payload, workspacePath)
			}
			return false
		})

		if (success) {
			sendEditResult(workspacePath, { success: true })
		} else {
			sendEditResult(workspacePath, {
				success: false,
				error: "This content can't be edited inline — it may use dynamic expressions. Use AI Edit to describe the change you want.",
				suggestAiEdit: true,
			})
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Inline edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleImageEdit(payload: InlineEditPayload, workspacePath: string): Promise<boolean> {
	if (!payload.imageData) return false

	const assetsDir = path.join(workspacePath, ".caret", "assets")
	await fs.mkdir(assetsDir, { recursive: true })

	const base64Data = payload.imageData.replace(/^data:image\/\w+;base64,/, "")
	const fileName = payload.newValue.replace(/[^a-zA-Z0-9._-]/g, "_")
	const destPath = path.join(assetsDir, fileName)

	await fs.writeFile(destPath, Buffer.from(base64Data, "base64"))

	return editJSXImageSrc(payload.filePath, payload.lineNumber, `./assets/${fileName}`, payload.caretId)
}

async function handlePageFocused(rawFilePath: string, workspacePath: string): Promise<void> {
	try {
		const filePath = await resolveCaretPath(rawFilePath, workspacePath)
		const result = await precomputeAndApply(filePath)
		// The RESOLVED path, never the raw one. The client stores these ranges in a
		// map keyed by file and looks them up with the absolute path the React
		// fiber reports — a payload keyed "pages/home/index.tsx" matches nothing,
		// which left the dynamic-text gate dead: "Edit text" stayed enabled on
		// `{product.name}`, and the user found out only after typing, as a failure.
		hostFor(workspacePath).sendToCanvas({
			source: "caret-host",
			type: "precompute-result",
			payload: { filePath, dynamicRanges: result.dynamicRanges },
		})
		Logger.debug(`[design] page-focused: sent ${result.dynamicRanges.length} dynamic ranges, modified=${result.modified}`)

		// Components render inside the page, so their elements are exactly as
		// clickable — and the map's item content usually lives in one (`<p>
		// {product.name}</p>` in ProductCard, driven by the page's data array).
		// Analyzed read-only: healing is the page pipeline's job, and a silent
		// write to a component from a focus event would be a surprise.
		for (const dir of ["components", "layouts"]) {
			const folder = path.join(workspacePath, ".caret", dir)
			const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
			for (const entry of entries) {
				if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue
				const componentPath = path.join(folder, entry.name)
				try {
					const source = await fs.readFile(componentPath, "utf-8")
					const ranges = precomputePage(source, componentPath).dynamicRanges
					hostFor(workspacePath).sendToCanvas({
						source: "caret-host",
						type: "precompute-result",
						payload: { filePath: componentPath, dynamicRanges: ranges },
					})
				} catch (err) {
					Logger.warn(`[design] page-focused: could not analyze ${componentPath}: ${err}`)
				}
			}
		}
	} catch (err) {
		Logger.error(`[design] page-focused: precompute failed for ${rawFilePath}:`, err)
	}
}

async function handleFlowEdgeCreate(payload: FlowEdgeCreatePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			let step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) {
				step = { page: payload.fromPage, next: [] }
				flow.steps.push(step)
			}
			if (!step.next.includes(payload.toPage)) {
				step.next.push(payload.toPage)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(`[design] Flow edge created: ${payload.flowId} ${payload.fromPage} → ${payload.toPage}`)
	} catch (err) {
		Logger.error("[design] Failed to create flow edge:", err)
	}
}

async function handleFlowEdgeDelete(payload: FlowEdgeDeletePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			const step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) return
			if (payload.isError) {
				step.onError = (step.onError || []).filter((p) => p !== payload.toPage)
				if (step.onError.length === 0) delete step.onError
			} else {
				step.next = step.next.filter((p) => p !== payload.toPage)
			}
			if (step.next.length === 0 && !step.onError?.length && !step.label) {
				flow.steps = flow.steps.filter((s) => s !== step)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(`[design] Flow edge deleted: ${payload.flowId} ${payload.fromPage} → ${payload.toPage}`)
	} catch (err) {
		Logger.error("[design] Failed to delete flow edge:", err)
	}
}

async function handleFlowEdgeUpdate(payload: FlowEdgeUpdatePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			let step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) {
				step = { page: payload.fromPage, next: [] }
				flow.steps.push(step)
			}
			if (payload.isError) {
				const onError = (step.onError || []).filter((p) => p !== payload.oldToPage)
				if (!onError.includes(payload.newToPage)) onError.push(payload.newToPage)
				step.onError = onError
			} else {
				step.next = step.next.filter((p) => p !== payload.oldToPage)
				if (!step.next.includes(payload.newToPage)) step.next.push(payload.newToPage)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(
			`[design] Flow edge updated: ${payload.flowId} ${payload.fromPage} → ${payload.oldToPage} ⇒ ${payload.newToPage}`,
		)
	} catch (err) {
		Logger.error("[design] Failed to update flow edge:", err)
	}
}

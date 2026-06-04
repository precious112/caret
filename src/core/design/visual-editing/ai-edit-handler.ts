import { Logger } from "@/shared/services/Logger"
import type { AiEditRequestPayload } from "../rendering-shell/messages"
import { buildVisualEditPrompt } from "./context-builder"

export type InitTaskFn = (task: string, images?: string[]) => Promise<unknown>

let initTaskFn: InitTaskFn | null = null

export function registerInitTask(fn: InitTaskFn): void {
	initTaskFn = fn
	Logger.info("[design] AI task handler registered")
}

export async function handleAiEditRequest(
	payload: AiEditRequestPayload,
	workspacePath: string,
	images?: string[],
): Promise<{ success: boolean; error?: string }> {
	console.log(
		`[design] handleAiEditRequest: component=${payload.componentName} file=${payload.filePath} line=${payload.lineNumber} images=${images?.length || 0}`,
	)
	console.log(`[design] handleAiEditRequest: initTaskFn=${initTaskFn ? "registered" : "NULL"}`)

	if (!initTaskFn) {
		console.error("[design] AI edit failed: initTaskFn is null")
		return { success: false, error: "AI task handler not registered. Try toggling design mode off and on." }
	}

	try {
		const prompt = await buildVisualEditPrompt(payload, workspacePath)
		console.log(`[design] handleAiEditRequest: prompt built (${prompt.length} chars), calling initTaskFn...`)
		await initTaskFn(prompt, images)
		console.log(`[design] handleAiEditRequest: initTaskFn completed`)
		return { success: true }
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		console.error(`[design] AI edit failed: ${errorMsg}`)
		return { success: false, error: errorMsg }
	}
}

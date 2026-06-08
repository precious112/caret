import * as fs from "fs/promises"
import * as path from "path"

import type { FlowDefinition } from "./types"

export async function readFlowDefinition(workspacePath: string, flowId: string): Promise<FlowDefinition | null> {
	const flowPath = path.join(workspacePath, ".caret", "flows", `${flowId}.flow.json`)
	try {
		const content = await fs.readFile(flowPath, "utf-8")
		return JSON.parse(content) as FlowDefinition
	} catch {
		return null
	}
}

export async function writeFlowDefinition(workspacePath: string, flowId: string, flow: FlowDefinition): Promise<void> {
	const flowsDir = path.join(workspacePath, ".caret", "flows")
	await fs.mkdir(flowsDir, { recursive: true })
	await fs.writeFile(path.join(flowsDir, `${flowId}.flow.json`), JSON.stringify(flow, null, 2))
}

export async function listFlows(workspacePath: string): Promise<FlowDefinition[]> {
	const flowsDir = path.join(workspacePath, ".caret", "flows")
	try {
		const entries = await fs.readdir(flowsDir, { withFileTypes: true })
		const flows: FlowDefinition[] = []

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".flow.json")) continue
			const flowId = entry.name.replace(".flow.json", "")
			const flow = await readFlowDefinition(workspacePath, flowId)
			if (flow) {
				flows.push(flow)
			}
		}
		return flows
	} catch {
		return []
	}
}

export function validateFlowDefinition(obj: unknown): obj is FlowDefinition {
	if (!obj || typeof obj !== "object") return false
	const flow = obj as Record<string, unknown>
	if (typeof flow.id !== "string") return false
	if (typeof flow.name !== "string") return false
	if (!Array.isArray(flow.steps)) return false
	for (const step of flow.steps) {
		if (!step || typeof step !== "object") return false
		if (typeof step.page !== "string") return false
		if (!Array.isArray(step.next)) return false
		if (step.onError !== undefined && !Array.isArray(step.onError)) return false
	}
	return true
}

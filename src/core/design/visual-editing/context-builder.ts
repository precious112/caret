import * as fs from "fs/promises"
import * as path from "path"

import type { AiEditRequestPayload } from "../rendering-shell/messages"

export async function buildVisualEditPrompt(payload: AiEditRequestPayload, workspacePath: string): Promise<string> {
	const sections: string[] = []

	sections.push(`The user selected a SPECIFIC element in the design preview and requested an edit.`)
	sections.push(`IMPORTANT: Only modify the element at the specified line. Do NOT change other elements in the file.`)
	sections.push(`\nUser instruction: "${payload.instruction}"`)

	if (payload.filePath && payload.lineNumber > 0) {
		sections.push(`\nSelected element:`)
		if (payload.componentName) sections.push(`- Component: ${payload.componentName}`)
		sections.push(`- File: ${path.relative(workspacePath, payload.filePath)}`)
		sections.push(`- Line: ${payload.lineNumber}`)
	}

	if (payload.filePath) {
		try {
			const source = await fs.readFile(payload.filePath, "utf-8")
			const lines = source.split("\n")
			sections.push(`\nSource file (${path.relative(workspacePath, payload.filePath)}):`)
			sections.push("```tsx")
			sections.push(source)
			sections.push("```")

			if (payload.lineNumber > 0) {
				const start = Math.max(0, payload.lineNumber - 4)
				const end = Math.min(lines.length, payload.lineNumber + 6)
				const snippet = lines
					.slice(start, end)
					.map((l, i) => {
						const ln = start + i + 1
						const marker = ln === payload.lineNumber ? " >>>" : "    "
						return `${marker} ${ln}: ${l}`
					})
					.join("\n")
				sections.push(`\nThe user clicked on the element at line ${payload.lineNumber}. Here is the surrounding code:`)
				sections.push("```")
				sections.push(snippet)
				sections.push("```")
				sections.push(
					`Only modify the element at or near line ${payload.lineNumber}. Leave all other elements unchanged.`,
				)
			}
		} catch {
			console.warn(`[design] Could not read source file: ${payload.filePath}`)
		}
	}

	const tokensPath = path.join(workspacePath, ".caret", "tokens", "foundation.json")
	try {
		const tokens = await fs.readFile(tokensPath, "utf-8")
		sections.push(`\nDesign tokens (foundation.json):`)
		sections.push("```json")
		sections.push(tokens)
		sections.push("```")
	} catch {
		console.info("[design] No foundation tokens found — skipping token context")
	}

	sections.push(`\nApply the requested change to the source file. Write only the modified file using write_to_file.`)

	return sections.join("\n")
}

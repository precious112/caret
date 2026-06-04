import * as fs from "fs/promises"
import * as path from "path"

import type { AiEditRequestPayload } from "../rendering-shell/messages"
import { findJSXElementAtPosition, findJSXElementByCaretId, parseSource } from "./ast-editor"

function extractElementSource(source: string, node: { loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null }): string | null {
	if (!node.loc) return null
	const lines = source.split("\n")
	const startLine = node.loc.start.line - 1
	const endLine = node.loc.end.line - 1
	if (startLine < 0 || endLine >= lines.length) return null

	if (startLine === endLine) {
		return lines[startLine].slice(node.loc.start.column, node.loc.end.column)
	}

	const result: string[] = []
	result.push(lines[startLine].slice(node.loc.start.column))
	for (let i = startLine + 1; i < endLine; i++) {
		result.push(lines[i])
	}
	result.push(lines[endLine].slice(0, node.loc.end.column))
	return result.join("\n")
}

export async function buildVisualEditPrompt(payload: AiEditRequestPayload, workspacePath: string): Promise<string> {
	const sections: string[] = []

	const isOverlayEdit = payload.lineNumber === 0 && !payload.caretId

	if (isOverlayEdit) {
		sections.push(`The user painted a region on the design preview and provided a screenshot of what they see.`)
		sections.push(`Look at the attached screenshot to understand what the user is referring to.`)
		sections.push(`\nUser instruction: "${payload.instruction}"`)
	} else {
		sections.push(`The user selected a SPECIFIC element in the design preview and requested an edit.`)
		sections.push(`IMPORTANT: Only modify the element at the specified location. Do NOT change other elements in the file.`)
		sections.push(`\nUser instruction: "${payload.instruction}"`)
	}

	if (payload.filePath) {
		try {
			const source = await fs.readFile(payload.filePath, "utf-8")
			const lines = source.split("\n")
			const relPath = path.relative(workspacePath, payload.filePath)

			let elementCode: string | null = null
			let elementLine = payload.lineNumber
			let isInsideIterator = false

			try {
				const ast = parseSource(source)
				const node = payload.caretId
					? findJSXElementByCaretId(ast, payload.caretId) || findJSXElementAtPosition(ast, payload.lineNumber, payload.columnNumber)
					: findJSXElementAtPosition(ast, payload.lineNumber, payload.columnNumber)

				if (node) {
					elementCode = extractElementSource(source, node)
					if (node.loc) elementLine = node.loc.start.line
				}
			} catch {
				// AST parsing failed — fall back to line-based context
			}

			if (elementCode) {
				if (payload.caretId) {
					sections.push(`\nThe user clicked on this specific element (data-caret-id="${payload.caretId}"):`)
				} else {
					sections.push(`\nThe user clicked on this specific element:`)
					isInsideIterator = true
				}
				sections.push("```tsx")
				sections.push(elementCode)
				sections.push("```")
				sections.push(`Located at line ${elementLine}${payload.columnNumber > 0 ? `, column ${payload.columnNumber}` : ""} in ${relPath}.`)
				if (isInsideIterator) {
					sections.push(`This element may be inside a .map() or iteration callback.`)
				}
				sections.push(`Only modify this element. Do not change other elements.`)
			}

			if (payload.componentName) sections.push(`\nComponent: ${payload.componentName}`)
			sections.push(`File: ${relPath}`)

			sections.push(`\nSource file (${relPath}):`)
			sections.push("```tsx")
			sections.push(source)
			sections.push("```")

			if (elementLine > 0) {
				const start = Math.max(0, elementLine - 4)
				const end = Math.min(lines.length, elementLine + 6)
				const snippet = lines
					.slice(start, end)
					.map((l, i) => {
						const ln = start + i + 1
						const marker = ln === elementLine ? " >>>" : "    "
						return `${marker} ${ln}: ${l}`
					})
					.join("\n")
				sections.push(`\nSurrounding code:`)
				sections.push("```")
				sections.push(snippet)
				sections.push("```")
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

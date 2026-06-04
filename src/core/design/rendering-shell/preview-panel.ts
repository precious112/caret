import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { Logger } from "@/shared/services/Logger"
import { handleAiEditRequest } from "../visual-editing/ai-edit-handler"
import { editJSXColor, editJSXImageSrc, editJSXText } from "../visual-editing/ast-editor"
import { precomputeAndApply } from "../visual-editing/post-generation-hook"
import type { DesignMessage, InlineEditPayload, OverlayEditPayload } from "./messages"

let panel: vscode.WebviewPanel | null = null
let currentWorkspacePath: string | null = null

export function openDesignPreviewPanel(port: number, workspacePath?: string): void {
	if (workspacePath) currentWorkspacePath = workspacePath

	if (panel) {
		panel.reveal(vscode.ViewColumn.Two)
		updatePanelContent(port)
		return
	}

	panel = vscode.window.createWebviewPanel("caretDesignPreview", "Design Preview", vscode.ViewColumn.Two, {
		enableScripts: true,
		retainContextWhenHidden: true,
		localResourceRoots: [],
	})

	updatePanelContent(port)

	panel.webview.onDidReceiveMessage((message: DesignMessage) => {
		console.log(`[design] webview message received: source=${message.source} type=${message.type}`)
		if (message.source !== "caret-vite") return
		handleViteMessage(message).catch((err) => {
			console.error("[design] message handler error:", err)
		})
	})

	panel.onDidDispose(() => {
		panel = null
	})
}

export function closeDesignPreviewPanel(): void {
	if (panel) {
		panel.dispose()
		panel = null
	}
}

export function sendMessageToPreview(message: { source: "caret-extension"; type: string; payload: unknown }): void {
	panel?.webview.postMessage(message)
}

async function resolveCaretPath(filePath: string): Promise<string> {
	if (!filePath || !currentWorkspacePath) return filePath
	const caretDir = path.join(currentWorkspacePath, ".caret")

	if (path.isAbsolute(filePath) && filePath.startsWith(caretDir)) return filePath

	const relative = filePath.startsWith("/") ? filePath.slice(1) : filePath

	// Try direct under .caret/ first (handles paths like "pages/home/index.tsx", "components/Button.tsx")
	const underCaretDir = path.join(caretDir, relative)
	try {
		await fs.access(underCaretDir)
		return underCaretDir
	} catch {}

	// Try under .caret/pages/ for bare page names (handles "home/index.tsx")
	const underPages = path.join(caretDir, "pages", relative)
	try {
		await fs.access(underPages)
		return underPages
	} catch {}

	// Try under .caret/components/
	const underComponents = path.join(caretDir, "components", relative)
	try {
		await fs.access(underComponents)
		return underComponents
	} catch {}

	Logger.warn(`[design] Could not resolve caret path: "${filePath}" (tried under .caret/, .caret/pages/, .caret/components/)`)
	return underCaretDir
}

async function handleViteMessage(message: DesignMessage): Promise<void> {
	console.log(`[design] handleViteMessage: type=${message.type}`)
	switch (message.type) {
		case "log": {
			const { level, message: msg } = (message as any).payload
			if (level === "error") {
				console.error(`[design:iframe] ${msg}`)
			} else {
				console.log(`[design:iframe] ${msg}`)
			}
			break
		}

		case "element-selected":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath)
			console.log(
				`[design] Element selected: ${message.payload.componentName} at ${message.payload.filePath}:${message.payload.lineNumber}`,
			)
			break

		case "open-file":
			openFileInEditor(await resolveCaretPath(message.payload.filePath), message.payload.lineNumber)
			break

		case "inline-edit":
			console.log(
				`[design] Inline edit received: type=${message.payload.editType} file=${message.payload.filePath} line=${message.payload.lineNumber} tag=${(message.payload as any).tagName}`,
			)
			console.log(`[design] currentWorkspacePath=${currentWorkspacePath}`)
			message.payload.filePath = await resolveCaretPath(message.payload.filePath)
			console.log(`[design] Resolved path: ${message.payload.filePath}`)
			handleInlineEdit(message.payload)
			break

		case "ai-edit-request":
			console.log(
				`[design] AI edit request: file=${message.payload.filePath} line=${message.payload.lineNumber} component=${message.payload.componentName}`,
			)
			if (currentWorkspacePath) {
				message.payload.filePath = await resolveCaretPath(message.payload.filePath)
				console.log(`[design] Resolved AI edit path: ${message.payload.filePath}`)
				handleAiEditRequest(message.payload, currentWorkspacePath)
					.then((result) => {
						console.log(`[design] AI edit result: success=${result.success} error=${result.error || "none"}`)
						sendMessageToPreview({ source: "caret-extension", type: "edit-result", payload: result })
					})
					.catch((err) => {
						console.error("[design] AI edit handler threw:", err)
						sendMessageToPreview({
							source: "caret-extension",
							type: "edit-result",
							payload: { success: false, error: String(err) },
						})
					})
			} else {
				console.error("[design] AI edit request but currentWorkspacePath is null")
			}
			break

		case "overlay-edit":
			if (currentWorkspacePath) {
				handleOverlayEdit(message.payload)
			} else {
				console.error("[design] Overlay edit but currentWorkspacePath is null")
			}
			break

		case "page-focused":
			handlePageFocused(message.payload.filePath)
			break
	}
}

async function openFileInEditor(filePath: string, lineNumber?: number): Promise<void> {
	try {
		const uri = vscode.Uri.file(filePath)
		// biome-ignore lint: design module is VS Code-only; host bridge lacks line-number selection
		const doc = await vscode.workspace.openTextDocument(uri)
		const line = Math.max(0, (lineNumber || 1) - 1)
		const range = new vscode.Range(line, 0, line, 0)
		// biome-ignore lint: design module is VS Code-only; host bridge lacks line-number selection
		await vscode.window.showTextDocument(doc, { selection: range, viewColumn: vscode.ViewColumn.One })
	} catch (err) {
		Logger.error(`[design] Failed to open file: ${filePath}`, err)
	}
}

async function handleInlineEdit(payload: InlineEditPayload): Promise<void> {
	try {
		let success = false

		if (payload.editType === "text") {
			success = await editJSXText(
				payload.filePath,
				payload.lineNumber,
				payload.tagName || "",
				payload.newValue,
				payload.oldValue,
				payload.caretId,
			)
		} else if (payload.editType === "color") {
			success = await editJSXColor(payload.filePath, payload.lineNumber, payload.newValue, payload.caretId)
		} else if (payload.editType === "image") {
			success = await handleImageEdit(payload)
		}

		if (success) {
			sendMessageToPreview({ source: "caret-extension", type: "edit-result", payload: { success: true } })
		} else {
			sendMessageToPreview({
				source: "caret-extension",
				type: "edit-result",
				payload: {
					success: false,
					error: "This content can't be edited inline — it may use dynamic expressions. Use AI Edit to describe the change you want.",
					suggestAiEdit: true,
				},
			})
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Inline edit failed: ${errorMsg}`)
		sendMessageToPreview({ source: "caret-extension", type: "edit-result", payload: { success: false, error: errorMsg } })
	}
}

async function handleImageEdit(payload: InlineEditPayload): Promise<boolean> {
	if (!payload.imageData || !currentWorkspacePath) return false

	const assetsDir = path.join(currentWorkspacePath, ".caret", "assets")
	await fs.mkdir(assetsDir, { recursive: true })

	const base64Data = payload.imageData.replace(/^data:image\/\w+;base64,/, "")
	const fileName = payload.newValue.replace(/[^a-zA-Z0-9._-]/g, "_")
	const destPath = path.join(assetsDir, fileName)

	await fs.writeFile(destPath, Buffer.from(base64Data, "base64"))

	const relativePath = `./assets/${fileName}`
	return editJSXImageSrc(payload.filePath, payload.lineNumber, relativePath, payload.caretId)
}

async function handleOverlayEdit(payload: OverlayEditPayload): Promise<void> {
	if (!currentWorkspacePath) return

	try {
		const resolvedFilePath = payload.filePath ? await resolveCaretPath(payload.filePath) : ""
		const images = payload.screenshotDataUrl ? [payload.screenshotDataUrl] : undefined

		const result = await handleAiEditRequest(
			{
				instruction: payload.instruction,
				filePath: resolvedFilePath,
				lineNumber: 0,
				columnNumber: 0,
				componentName: "",
				caretId: "",
				componentStack: "",
			},
			currentWorkspacePath,
			images,
		)

		sendMessageToPreview({ source: "caret-extension", type: "edit-result", payload: result })
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Overlay edit failed: ${errorMsg}`)
		sendMessageToPreview({ source: "caret-extension", type: "edit-result", payload: { success: false, error: errorMsg } })
	}
}

async function handlePageFocused(rawFilePath: string): Promise<void> {
	try {
		const filePath = await resolveCaretPath(rawFilePath)
		console.log(`[design] page-focused: running precompute on ${filePath}`)
		const result = await precomputeAndApply(filePath)
		sendMessageToPreview({
			source: "caret-extension",
			type: "precompute-result",
			payload: {
				filePath: rawFilePath,
				dynamicRanges: result.dynamicRanges,
			},
		})
		console.log(`[design] page-focused: sent ${result.dynamicRanges.length} dynamic ranges, modified=${result.modified}`)
	} catch (err) {
		console.error(`[design] page-focused: precompute failed for ${rawFilePath}:`, err)
	}
}

function updatePanelContent(port: number): void {
	if (!panel) return

	panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:*; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<style>
		body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
		iframe { width: 100%; height: 100%; border: none; }
	</style>
</head>
<body>
	<iframe id="vite-frame" src="http://localhost:${port}/"></iframe>
	<script>
		const vscode = acquireVsCodeApi();
		const iframe = document.getElementById('vite-frame');
		window.addEventListener('message', (e) => {
			if (e.data?.source === 'caret-vite') {
				vscode.postMessage(e.data);
			}
			if (e.data?.source === 'caret-extension') {
				iframe.contentWindow.postMessage(e.data, '*');
			}
		});
	</script>
</body>
</html>`
}

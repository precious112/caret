import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { getRenderingShellPort, startRenderingShell, stopRenderingShell } from "./rendering-shell"
import { closeDesignPreviewPanel, openDesignPreviewPanel } from "./rendering-shell/preview-panel"
import { caretDirectoryExists } from "./scaffold"
import { type InitTaskFn, registerInitTask } from "./visual-editing/ai-edit-handler"

let designMode = false

export function setDesignMode(value: boolean, initTask?: InitTaskFn): void {
	designMode = value
	vscode.commands.executeCommand("setContext", "caret.isDesignMode", value)

	if (value) {
		if (initTask) registerInitTask(initTask)
		activateRenderingShell()
	} else {
		deactivateRenderingShell()
	}
}

async function activateRenderingShell(): Promise<void> {
	try {
		const workspacePath = await getCwd(getDesktopDir())
		const hasDir = await caretDirectoryExists(workspacePath)
		if (!hasDir) return

		if (getRenderingShellPort()) return

		const { port } = await startRenderingShell(workspacePath)
		openDesignPreviewPanel(port, workspacePath)
		Logger.info(`Design rendering shell started on port ${port}`)
	} catch (error) {
		Logger.error("Failed to start rendering shell:", error)
	}
}

function deactivateRenderingShell(): void {
	stopRenderingShell()
	closeDesignPreviewPanel()
}

export function isInDesignMode(): boolean {
	return designMode
}

async function checkForCaretDirectory(): Promise<boolean> {
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	for (const folder of workspacePaths.paths) {
		if (await caretDirectoryExists(folder)) {
			return true
		}
	}
	return false
}

/**
 * Initialize design mode detection and setup file watchers.
 * Auto-sets the VS Code context if .caret/ exists in the workspace.
 */
export async function initializeDesignMode(): Promise<vscode.Disposable[]> {
	const disposables: vscode.Disposable[] = []

	const hasCaretDir = await checkForCaretDirectory()
	if (hasCaretDir) {
		Logger.log("Design layer detected: setting caret.hasCaretDir context")
		vscode.commands.executeCommand("setContext", "caret.hasCaretDir", true)
	}

	const caretDirWatcher = vscode.workspace.createFileSystemWatcher("**/.caret")

	caretDirWatcher.onDidCreate(async () => {
		Logger.log(".caret/ directory created")
		vscode.commands.executeCommand("setContext", "caret.hasCaretDir", true)
	})

	caretDirWatcher.onDidDelete(async () => {
		Logger.log(".caret/ directory deleted")
		vscode.commands.executeCommand("setContext", "caret.hasCaretDir", false)
		if (designMode) {
			setDesignMode(false)
		}
	})

	disposables.push(caretDirWatcher)
	return disposables
}

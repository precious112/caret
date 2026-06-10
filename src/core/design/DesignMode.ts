import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { getRenderingShellPort, setOnUnexpectedShellExit, startRenderingShell, stopRenderingShell } from "./rendering-shell"
import { closeDesignPreviewPanel, openDesignPreviewPanel } from "./rendering-shell/preview-panel"
import { caretDirectoryExists } from "./scaffold"
import { type InitTaskFn, registerInitTask } from "./visual-editing/ai-edit-handler"

let designMode = false
// Serializes activation/deactivation: startRenderingShell can take ~60s
// (npm install), so an unguarded rapid toggle could spawn two vite processes.
let lifecycleChain: Promise<void> = Promise.resolve()

export function setDesignMode(value: boolean, initTask?: InitTaskFn): void {
	designMode = value
	vscode.commands.executeCommand("setContext", "caret.isDesignMode", value)

	if (value) {
		if (initTask) registerInitTask(initTask)
		lifecycleChain = lifecycleChain.then(() => (designMode ? activateRenderingShell() : undefined))
	} else {
		lifecycleChain = lifecycleChain.then(() => deactivateRenderingShell())
	}
}

async function activateRenderingShell(): Promise<void> {
	try {
		const workspacePath = await getCwd(getDesktopDir())
		const hasDir = await caretDirectoryExists(workspacePath)
		if (!hasDir) return

		if (getRenderingShellPort()) return

		setOnUnexpectedShellExit(handleUnexpectedShellExit)
		const { port } = await startRenderingShell(workspacePath)
		// User may have toggled off while vite was booting
		if (!designMode) {
			stopRenderingShell()
			return
		}
		openDesignPreviewPanel(port, workspacePath)
		Logger.info(`Design rendering shell started on port ${port}`)
	} catch (error) {
		Logger.error("Failed to start rendering shell:", error)
		vscode.window.showErrorMessage(
			`Caret design preview failed to start: ${error instanceof Error ? error.message : error}. Check .caret/vite.log for details.`,
		)
	}
}

function deactivateRenderingShell(): void {
	setOnUnexpectedShellExit(null)
	stopRenderingShell()
	closeDesignPreviewPanel()
}

function handleUnexpectedShellExit(): void {
	if (!designMode) return
	vscode.window
		.showWarningMessage("The design preview server stopped unexpectedly. Check .caret/vite.log for details.", "Restart")
		.then((choice) => {
			if (choice === "Restart" && designMode) {
				lifecycleChain = lifecycleChain.then(() => activateRenderingShell())
			}
		})
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

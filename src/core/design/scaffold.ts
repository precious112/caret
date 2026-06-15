import * as fs from "fs/promises"
import * as path from "path"

import type { FoundationTokens, SyncState } from "./types"

const CARET_SUBDIRS = [
	"tokens",
	"tokens/components",
	"pages",
	"flows",
	"components",
	"layouts",
	"assets",
	"thumbnails",
	"lib",
	"lib/canvas",
]

const DEFAULT_FOUNDATION_TOKENS: FoundationTokens = {
	vibe: { description: "", tags: [] },
	color: {
		brand: { seed: "#3b82f6", scale: {} },
		neutral: { character: "cool", scale: {} },
		semantic: { success: "#22c55e", warning: "#eab308", error: "#ef4444", info: "#3b82f6" },
	},
	typography: {
		fontFamily: "Inter",
		fallback: "system-ui, sans-serif",
		scaleRatio: 1.25,
		baseSize: 16,
		scale: {},
	},
	spacing: { baseUnit: 4, scale: [0, 1, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64] },
	radius: { character: "soft", scale: [0, 2, 4, 8, 12, 9999] },
}

const DEFAULT_SYNC_STATE: SyncState = {
	lastSyncedCommit: null,
}

const CARET_PACKAGE_JSON = {
	name: "caret-design-layer",
	private: true,
	type: "module",
	dependencies: {
		react: "^19.0.0",
		"react-dom": "^19.0.0",
		"react-grab": "^0.1.37",
	},
	devDependencies: {
		vite: "^7.1.0",
		"@vitejs/plugin-react-swc": "^4.0.0",
		tailwindcss: "^4.1.0",
		"@tailwindcss/vite": "^4.1.0",
		"@types/react": "^19.0.0",
		"@types/react-dom": "^19.0.0",
	},
}

const CARET_GITIGNORE = `node_modules/
vite.log
thumbnails/
canvas-layout.json
.sync-pending.json
`

/**
 * Creates the .caret/ directory structure in the user's workspace.
 * Idempotent — won't overwrite existing files.
 */
export async function ensureCaretDirectoryExists(workspacePath: string): Promise<string> {
	const caretDir = path.join(workspacePath, ".caret")

	for (const subdir of CARET_SUBDIRS) {
		await fs.mkdir(path.join(caretDir, subdir), { recursive: true })
	}

	const foundationPath = path.join(caretDir, "tokens", "foundation.json")
	if (!(await fileExists(foundationPath))) {
		await fs.writeFile(foundationPath, JSON.stringify(DEFAULT_FOUNDATION_TOKENS, null, 2))
	}

	const syncStatePath = path.join(caretDir, "sync-state.json")
	if (!(await fileExists(syncStatePath))) {
		await fs.writeFile(syncStatePath, JSON.stringify(DEFAULT_SYNC_STATE, null, 2))
	}

	const packageJsonPath = path.join(caretDir, "package.json")
	if (!(await fileExists(packageJsonPath))) {
		await fs.writeFile(packageJsonPath, JSON.stringify(CARET_PACKAGE_JSON, null, 2))
	}

	await ensureCaretGitignore(workspacePath)

	return caretDir
}

/**
 * Checks if .caret/ directory exists in the workspace.
 */
export async function caretDirectoryExists(workspacePath: string): Promise<boolean> {
	return fileExists(path.join(workspacePath, ".caret"))
}

/**
 * Idempotently ensures `.caret/.gitignore` contains every required ignore line.
 * Projects scaffolded before a line was added (e.g. `.sync-pending.json`) would
 * otherwise track that transient file — so this appends any missing lines.
 */
export async function ensureCaretGitignore(workspacePath: string): Promise<void> {
	const gitignorePath = path.join(workspacePath, ".caret", ".gitignore")
	if (!(await fileExists(gitignorePath))) {
		await fs.mkdir(path.dirname(gitignorePath), { recursive: true })
		await fs.writeFile(gitignorePath, CARET_GITIGNORE)
		return
	}
	const existing = await fs.readFile(gitignorePath, "utf-8")
	const present = new Set(existing.split("\n").map((l) => l.trim()))
	const missing = CARET_GITIGNORE.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !present.has(l))
	if (missing.length > 0) {
		await fs.writeFile(gitignorePath, `${existing.replace(/\n*$/, "")}\n${missing.join("\n")}\n`)
	}
}

// Cached `.caret/` presence, kept fresh by DesignMode's watcher. Lives here (a
// vscode-free module) so the controller can read it synchronously on the hot
// state-post path without statically importing the vscode-coupled DesignMode.
let hasCaretDirCache = false

/** Cached `.caret/` presence — gates the chat "Sync now" button in webview state. */
export function getHasCaretDir(): boolean {
	return hasCaretDirCache
}

/** Updated by DesignMode on startup + `.caret/` create/delete. */
export function setHasCaretDir(value: boolean): void {
	hasCaretDirCache = value
}

// Mirror of DesignMode's active flag in a vscode-free module, so code in the
// task layer (which also runs in standalone) can gate on design mode without
// statically importing the vscode-coupled DesignMode.
let designModeActiveCache = false

/** Whether design mode is currently active (vscode-free read). */
export function isDesignModeActive(): boolean {
	return designModeActiveCache
}

/** Updated by DesignMode.setDesignMode. */
export function setDesignModeActive(value: boolean): void {
	designModeActiveCache = value
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

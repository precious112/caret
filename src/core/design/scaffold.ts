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

	const gitignorePath = path.join(caretDir, ".gitignore")
	if (!(await fileExists(gitignorePath))) {
		await fs.writeFile(gitignorePath, CARET_GITIGNORE)
	}

	return caretDir
}

/**
 * Checks if .caret/ directory exists in the workspace.
 */
export async function caretDirectoryExists(workspacePath: string): Promise<boolean> {
	return fileExists(path.join(workspacePath, ".caret"))
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

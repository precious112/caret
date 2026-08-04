/**
 * Preferences, replacing VS Code's `globalState` / `StateManager`.
 *
 * A single JSON file under `app.getPath("userData")`, written atomically. The
 * get/set shape deliberately mirrors what `StateManager` exposed so call sites
 * read the same, and everything is loaded synchronously at startup because
 * window creation needs the recents list before it can draw anything.
 */
import { app } from "electron"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"

export interface Prefs {
	/** Most-recently-opened project paths, newest first. */
	recentProjects: string[]
	/** Command used to reveal a file, e.g. `code -g` or `cursor`. Empty = OS default. */
	editorCommand: string
	/** The user's own Google Fonts API key, if they have one. */
	googleFontsApiKey: string
	/** Whether `.caret/` is auto-committed after the design layer settles. */
	autoCommitDesign: boolean
	/** Windows the user had open, restored on next launch. */
	lastSession: string[]
	/** Set once the first-run onboarding has been completed. */
	onboardingCompleted: boolean
	/** Which coding backend Caret drives. Null until the user picks one. */
	backendId: "opencode" | "claude" | "codex" | "kimi" | null
	/** Model in the backend's own namespace, e.g. `anthropic/claude-sonnet-5`. Empty = its default. */
	backendModel: string
	/** How hard the model thinks. Empty = the backend's own default. */
	backendEffort: "" | "minimal" | "low" | "medium" | "high" | "xhigh"
	/**
	 * Projects where the user chose "don't ask again" for writes to their app's
	 * own source. Per project rather than global: consent to rewrite one repo is
	 * not consent to rewrite the next one.
	 */
	appWritesAllowed: string[]
}

const DEFAULTS: Prefs = {
	recentProjects: [],
	editorCommand: "",
	googleFontsApiKey: "",
	autoCommitDesign: true,
	lastSession: [],
	onboardingCompleted: false,
	backendId: null,
	backendModel: "",
	backendEffort: "",
	appWritesAllowed: [],
}

const MAX_RECENTS = 12

let cache: Prefs = { ...DEFAULTS }
let filePath = ""

function resolvePath(): string {
	filePath ||= path.join(app.getPath("userData"), "preferences.json")
	return filePath
}

/** Loads preferences from disk. Call once, before the first window opens. */
export function loadPrefs(): Prefs {
	try {
		const raw = fs.readFileSync(resolvePath(), "utf-8")
		// Merge over defaults so a preferences file written by an older version
		// gains new keys rather than leaving them undefined.
		cache = { ...DEFAULTS, ...JSON.parse(raw) }
	} catch {
		cache = { ...DEFAULTS }
	}
	return cache
}

export function getPrefs(): Prefs {
	return cache
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
	return cache[key]
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
	cache = { ...cache, [key]: value }
	await persist()
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
	cache = { ...cache, ...patch }
	await persist()
}

/** Moves `projectPath` to the front of the recents list. */
export async function recordRecentProject(projectPath: string): Promise<void> {
	const recents = [projectPath, ...cache.recentProjects.filter((p) => p !== projectPath)].slice(0, MAX_RECENTS)
	await setPref("recentProjects", recents)
}

export async function forgetRecentProject(projectPath: string): Promise<void> {
	await setPref(
		"recentProjects",
		cache.recentProjects.filter((p) => p !== projectPath),
	)
}

/**
 * Temp-then-rename, so a crash mid-write leaves the previous preferences intact
 * rather than a truncated file that fails to parse on next launch.
 */
async function persist(): Promise<void> {
	const target = resolvePath()
	const tmp = `${target}.tmp`
	await fsp.mkdir(path.dirname(target), { recursive: true })
	await fsp.writeFile(tmp, JSON.stringify(cache, null, 2), "utf-8")
	await fsp.rename(tmp, target)
}

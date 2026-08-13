/**
 * Bidirectional drift detection — a hash comparison over the manifest, with no
 * inference anywhere.
 *
 * Each mapping entry recorded both sides' content hashes at translation time.
 * Comparing them against the bytes on disk NOW classifies every mapped design
 * file:
 *
 *   design moved, app still     → "forward"   (an ordinary design→app sync)
 *   app moved, design still     → "app-drift" (the app walked away from the
 *                                  design — invisible before the manifest)
 *   both moved                  → "conflict"  (surfaced, never auto-merged)
 *   neither                     → "clean"
 *
 * A deleted app file counts as app movement (drift is drift, whether by edit
 * or by removal). A deleted design file is forward movement — the design
 * layer's deletions sync forward like its edits do.
 */
import * as path from "path"

import { hashFileContent, type MappingEntry, readManifest } from "./mapping-manifest"

export type DriftClass = "clean" | "forward" | "app-drift" | "conflict"

export interface DriftEntry {
	designPath: string
	appPaths: string[]
	classification: DriftClass
	designChanged: boolean
	/** App files whose content moved (or vanished) since the mapping was recorded. */
	changedAppPaths: string[]
}

export interface DriftReport {
	entries: DriftEntry[]
	forward: number
	appDrift: number
	conflicts: number
	clean: number
}

async function classifyEntry(workspacePath: string, entry: MappingEntry): Promise<DriftEntry> {
	const designNow = await hashFileContent(path.join(workspacePath, entry.designPath))
	const designChanged = designNow !== entry.designHash

	const changedAppPaths: string[] = []
	for (const appPath of entry.appPaths) {
		const recorded = entry.appHashes[appPath] ?? null
		const now = await hashFileContent(path.join(workspacePath, appPath))
		if (now !== recorded) changedAppPaths.push(appPath)
	}

	const classification: DriftClass =
		designChanged && changedAppPaths.length > 0
			? "conflict"
			: designChanged
				? "forward"
				: changedAppPaths.length > 0
					? "app-drift"
					: "clean"

	return { designPath: entry.designPath, appPaths: entry.appPaths, classification, designChanged, changedAppPaths }
}

/** The full drift picture for every mapped design file. */
export async function computeDrift(workspacePath: string): Promise<DriftReport> {
	const manifest = await readManifest(workspacePath)
	const entries: DriftEntry[] = []
	for (const entry of manifest.entries) {
		entries.push(await classifyEntry(workspacePath, entry))
	}
	return {
		entries,
		forward: entries.filter((e) => e.classification === "forward").length,
		appDrift: entries.filter((e) => e.classification === "app-drift").length,
		conflicts: entries.filter((e) => e.classification === "conflict").length,
		clean: entries.filter((e) => e.classification === "clean").length,
	}
}

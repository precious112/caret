import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import { writeFileAtomic } from "./file-mutation-queue"
import type { PageMeta } from "./types"

export async function readPageMeta(workspacePath: string, pageId: string): Promise<PageMeta | null> {
	const metaPath = path.join(workspacePath, ".caret", "pages", pageId, "meta.json")
	let content: string
	try {
		content = await fs.readFile(metaPath, "utf-8")
	} catch {
		return null
	}
	try {
		return JSON.parse(content) as PageMeta
	} catch (err) {
		Logger.warn(`[design] Page meta ${metaPath} is not valid JSON and will be ignored: ${err}`)
		return null
	}
}

export async function writePageMeta(workspacePath: string, pageId: string, meta: PageMeta): Promise<void> {
	const pageDir = path.join(workspacePath, ".caret", "pages", pageId)
	await fs.mkdir(pageDir, { recursive: true })
	await writeFileAtomic(path.join(pageDir, "meta.json"), JSON.stringify(meta, null, 2))
}

export async function listPages(workspacePath: string): Promise<PageMeta[]> {
	const pagesDir = path.join(workspacePath, ".caret", "pages")
	try {
		const entries = await fs.readdir(pagesDir, { withFileTypes: true })
		const pages: PageMeta[] = []

		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const meta = await readPageMeta(workspacePath, entry.name)
			if (meta) {
				pages.push(meta)
			} else {
				pages.push({
					id: entry.name,
					title: entry.name,
					type: "page",
					states: [],
					tags: [],
				})
			}
		}
		return pages
	} catch {
		return []
	}
}

export function validatePageMeta(obj: unknown): obj is PageMeta {
	if (!obj || typeof obj !== "object") return false
	const meta = obj as Record<string, unknown>
	if (typeof meta.id !== "string") return false
	if (typeof meta.title !== "string") return false
	if (typeof meta.type !== "string") return false
	if (!Array.isArray(meta.states)) return false
	if (!Array.isArray(meta.tags)) return false
	return true
}

import { EmptyRequest } from "@shared/proto/cline/common"
import { DesignPagesResponse } from "@shared/proto/cline/design"
import * as fs from "fs/promises"
import * as path from "path"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from "../index"

export async function listDesignPages(controller: Controller, _: EmptyRequest): Promise<DesignPagesResponse> {
	const workspacePath = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
	const pagesDir = path.join(workspacePath, ".caret", "pages")

	try {
		const entries = await fs.readdir(pagesDir, { withFileTypes: true })
		const pages = []

		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const metaPath = path.join(pagesDir, entry.name, "meta.json")
			try {
				const metaContent = await fs.readFile(metaPath, "utf-8")
				const meta = JSON.parse(metaContent)
				pages.push({
					id: meta.id || entry.name,
					title: meta.title || entry.name,
					type: meta.type || "page",
					states: meta.states || [],
					tags: meta.tags || [],
				})
			} catch {
				pages.push({
					id: entry.name,
					title: entry.name,
					type: "page",
					states: [],
					tags: [],
				})
			}
		}

		return DesignPagesResponse.create({ pages })
	} catch {
		return DesignPagesResponse.create({ pages: [] })
	}
}

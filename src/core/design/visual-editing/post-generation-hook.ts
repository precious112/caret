import * as fs from "fs/promises"

import { precomputePage } from "./page-precompute"
import type { PrecomputeResult } from "./page-precompute"

export async function precomputeAndApply(filePath: string): Promise<PrecomputeResult> {
	const source = await fs.readFile(filePath, "utf-8")
	const result = precomputePage(source, filePath)

	if (result.modified && result.correctedSource) {
		await fs.writeFile(filePath, result.correctedSource)
		console.log(`[design] precompute: corrected ${filePath} (added caret-ids / converted styles)`)
	}

	return result
}

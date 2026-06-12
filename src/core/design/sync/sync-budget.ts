import type { DesignFileDiff, DesignLayerDiff } from "@/utils/git"

/**
 * Rough token estimate. Matches the chars/4 heuristic the codebase already uses
 * (see vscode-lm provider) — good enough for a pre-flight budget gate; we never
 * need exact counts, only "is this comfortably under the window".
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export interface BudgetedDiff {
	/** The assembled diff section for the prompt (stat + packed hunks + summarized list). */
	text: string
	/** Files whose full hunk was inlined. */
	shown: number
	/** Total changed files. */
	total: number
	/** Files listed under SUMMARIZED (hunk omitted, AI reads on demand). */
	summarized: number
	/** Estimated tokens of `text`. */
	estimatedTokens: number
}

/**
 * Token-budget guardrails (Layers 1 + 3) for the design-layer diff.
 *
 * - The `--stat` is ALWAYS included whole, so the model always sees the complete
 *   set of changed files — scope is never lost (unlike a blind middle-drop trim).
 * - Full hunks are packed smallest-first until `budgetTokens` is reached.
 * - Over-budget files go under a SUMMARIZED block with an explicit READ <path>,
 *   never silently dropped.
 *
 * @param budgetTokens token budget for this diff section (the orchestrator sizes
 *   it from the model's context window, reserving room for inventory + reasoning).
 */
export function buildBudgetedDiff(diff: DesignLayerDiff, budgetTokens: number): BudgetedDiff {
	const intentLabel = diff.isFirstSync
		? "FULL DESIGN LAYER (first sync — no prior bookmark, everything is new)"
		: "DESIGN CHANGES SINCE LAST SYNC"

	const statBlock = `${intentLabel}  (git diff --stat)\n${diff.stat || "(no file-level changes reported)"}`

	const total = diff.files.length
	if (total === 0) {
		return { text: statBlock, shown: 0, total: 0, summarized: 0, estimatedTokens: estimateTokens(statBlock) }
	}

	// The --stat is non-negotiable; the remaining budget is for hunks.
	let spent = estimateTokens(statBlock)
	const shown: DesignFileDiff[] = []
	const summarized: DesignFileDiff[] = []

	// Smallest-first so we inline as many files as possible before falling back
	// to summaries for the large ones.
	const bySize = [...diff.files].sort((a, b) => a.hunk.length - b.hunk.length)
	for (const file of bySize) {
		const cost = estimateTokens(file.hunk)
		if (spent + cost <= budgetTokens) {
			shown.push(file)
			spent += cost
		} else {
			summarized.push(file)
		}
	}

	const parts: string[] = [statBlock]

	parts.push(`\n── BUDGETED DIFF (${shown.length}/${total} files shown · ${summarized.length} summarized) ──`)
	// Present inlined hunks in the original (path) order for readability.
	const shownPaths = new Set(shown.map((f) => f.path))
	for (const file of diff.files.filter((f) => shownPaths.has(f.path))) {
		parts.push(file.hunk)
	}

	if (summarized.length > 0) {
		parts.push("\n── SUMMARIZED (diff omitted — read the file directly before planning its page) ──")
		// Largest-change first so the most significant omissions are most visible.
		const order = [...summarized].sort((a, b) => b.changedLines - a.changedLines)
		for (const file of order) {
			parts.push(` ${file.path} — ${file.changedLines} lines changed — READ ${file.path}`)
		}
	}

	const text = parts.join("\n")
	return {
		text,
		shown: shown.length,
		total,
		summarized: summarized.length,
		estimatedTokens: estimateTokens(text),
	}
}

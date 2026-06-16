import { listFlows } from "../flow-meta"
import { listPages } from "../page-meta"
import { readFoundationTokens } from "../tokens"
import type { BudgetedDiff } from "./sync-budget"

/**
 * Builds the design inventory block — metadata only, never full page source.
 * The AI reads the specific page `index.tsx` files it needs on demand.
 */
async function buildInventory(workspacePath: string): Promise<string> {
	const [pages, flows, tokens] = await Promise.all([
		listPages(workspacePath),
		listFlows(workspacePath),
		readFoundationTokens(workspacePath),
	])

	// All of this is AI-generated/edited and may be missing fields — stay defensive
	// so the sync prompt never crashes on an incomplete meta.json / flow / tokens file.
	const pageLines =
		pages.length === 0
			? "(none)"
			: pages
					.map(
						(p) =>
							` ${p.id} [${p.type ?? "page"}] — "${p.title ?? p.id}" · states: ${(p.states ?? []).join(", ") || "—"}`,
					)
					.join("\n")

	const flowLines =
		flows.length === 0
			? "(none)"
			: flows
					.map((f) => {
						const chain = (f.steps ?? [])
							.map((s) => s?.page)
							.filter(Boolean)
							.join(" → ")
						return ` ${f.id} (${f.name ?? f.id}): ${chain}`
					})
					.join("\n")

	const tokenLine = tokens
		? `brand ${tokens.color?.brand?.seed ?? "—"} · font ${tokens.typography?.fontFamily ?? "—"} · radius ${tokens.radius?.character ?? "—"} · spacing ${tokens.spacing?.baseUnit ?? "—"}px` +
			` (read .caret/tokens/foundation.json for full scales)`
		: "(no foundation tokens configured)"

	return [
		"DESIGN INVENTORY (metadata only — read page sources on demand)",
		`PAGES (${pages.length}):`,
		pageLines,
		`FLOWS (${flows.length}):`,
		flowLines,
		`TOKENS: ${tokenLine}`,
	].join("\n")
}

/**
 * Assembles the full sync task prompt: instruction header + budgeted design diff
 * + design inventory. Fed into a plan-mode `initTask`.
 */
export async function buildSyncPrompt(workspacePath: string, budgetedDiff: BudgetedDiff, intentLog = ""): Promise<string> {
	const inventory = await buildInventory(workspacePath)

	const header = `<explicit_instructions type="sync">
You are syncing the DESIGN layer (.caret/) into the APPLICATION layer (the user's shipped app).

The diff below is the INTENT — what changed in the design since the last sync. Analyze it
together with the design inventory, then READ the specific app + page sources you need, and
produce a PLAN to make the application match the design. Cover UI translation AND any
business-logic, state, routing, API, or data-shape changes the design implies — a small design
change can imply large app work. If the design needs something the current architecture can't
support without a refactor, say so honestly rather than forcing a half-baked patch.

Some large diffs are SUMMARIZED below instead of inlined — you MUST read those files directly
before planning their pages. Page sources are never inlined here; read .caret/pages/<id>/index.tsx
as needed.

Do NOT edit .caret/sync-state.json — Caret records the sync automatically when this task completes.
</explicit_instructions>`

	const intentBlock = intentLog ? ["DESIGN COMMITS SINCE LAST SYNC (intent — newest first):", intentLog].join("\n") : ""

	const sections = [header, "", "─".repeat(60), budgetedDiff.text]
	if (intentBlock) {
		sections.push("", "─".repeat(60), intentBlock)
	}
	sections.push("", "─".repeat(60), inventory)
	return sections.join("\n")
}

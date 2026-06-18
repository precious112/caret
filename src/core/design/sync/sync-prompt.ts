import type { DesignChangedFile, DesignChangeStatus } from "@/utils/git"
import { listFlows } from "../flow-meta"
import { listPages } from "../page-meta"
import { readFoundationTokens } from "../tokens"

export interface SyncPromptInput {
	/** Net cumulative changed design files since the last sync (no file content). */
	changedFiles: DesignChangedFile[]
	/** True when there is no prior bookmark — the whole design layer is new. */
	isFirstSync: boolean
	/** Commit-subject narrative — context only, may list superseded changes. */
	intentLog?: string
}

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

/** Derive a page id from a `.caret/pages/<id>/...` path, or null if not a page file. */
function pageIdFromPath(path: string): string | null {
	const segments = path.split("/")
	if (segments[0] === ".caret" && segments[1] === "pages" && segments.length >= 3) {
		return segments[2]
	}
	return null
}

function statusLabel(statuses: Set<DesignChangeStatus>): string {
	return [...statuses].join(", ")
}

/**
 * Renders the net-changed worklist: changed pages (by id) and changed shared
 * design (components/tokens/layouts/flows). No file content — just the list of
 * what to read and reconcile.
 */
function buildWorklist(changedFiles: DesignChangedFile[], isFirstSync: boolean): string {
	if (changedFiles.length === 0) {
		return isFirstSync
			? "CHANGED DESIGN FILES: first sync — treat the ENTIRE current design layer (see inventory below) as new and reconcile every page into the app."
			: "CHANGED DESIGN FILES: none detected at file level — reconcile the full current design state against the app."
	}

	// Aggregate page files by id; everything else is shared design.
	const pageStatuses = new Map<string, Set<DesignChangeStatus>>()
	const shared: DesignChangedFile[] = []
	for (const file of changedFiles) {
		const id = pageIdFromPath(file.path)
		if (id) {
			const set = pageStatuses.get(id) ?? new Set<DesignChangeStatus>()
			set.add(file.status)
			pageStatuses.set(id, set)
		} else {
			shared.push(file)
		}
	}

	const lines: string[] = [
		"CHANGED DESIGN FILES TO RECONCILE (net changes since last sync — read each current source, do not assume from this list):",
	]
	if (isFirstSync) {
		lines.push("(First sync — every file below is new.)")
	}

	if (pageStatuses.size > 0) {
		lines.push("", "Pages — read .caret/pages/<id>/index.tsx and reconcile the matching app page:")
		for (const [id, statuses] of pageStatuses) {
			const deleted = statuses.has("deleted") && statuses.size === 1
			const note = deleted ? " — page removed from the design; remove it from the app" : ""
			lines.push(` - ${id} (${statusLabel(statuses)})${note}`)
		}
	}

	if (shared.length > 0) {
		lines.push(
			"",
			"Shared design (components / tokens / layouts / flows) — read each and reconcile EVERY page/app area that uses it:",
		)
		for (const file of shared) {
			lines.push(` - ${file.path} (${file.status})`)
		}
	}

	return lines.join("\n")
}

/**
 * Assembles the full sync task prompt: instruction header + changed-files worklist
 * + (optional) commit-intent hint + design inventory. Contains NO file/diff content
 * — the AI reads the current `.caret/` and app sources itself and infers the changes.
 * Fed into a plan-mode `initTask`.
 */
export async function buildSyncPrompt(workspacePath: string, input: SyncPromptInput): Promise<string> {
	const inventory = await buildInventory(workspacePath)
	const worklist = buildWorklist(input.changedFiles, input.isFirstSync)

	const header = `<explicit_instructions type="sync">
You are syncing the DESIGN layer (.caret/) into the APPLICATION layer (the user's shipped app).

The .caret/ design files are the SINGLE SOURCE OF TRUTH for how the app should look and behave. Below is ONLY the list of design files that changed since the last sync — NOT their contents. For EACH item you MUST:
  1. READ the current .caret/ source in full (the desired state) — e.g. .caret/pages/<id>/index.tsx plus any shared components/tokens it imports.
  2. READ the corresponding current application source.
  3. Compare them yourself and infer + apply the changes that make the app match the design. Cover UI translation AND any business-logic, state, routing, API, or data-shape changes the design implies — a small design change can imply large app work.

Always reconcile against the CURRENT file contents — never apply a remembered or precomputed diff. A file may have changed many times since the last sync; only its current state matters. If the design needs something the current architecture can't support without a refactor, say so honestly rather than forcing a half-baked patch.

The \`data-caret-id\` attributes in the design sources are Caret's visual-editor tooling metadata (they make inline editing of the .caret/ design UIs deterministic). They have NO meaning in the shipped app — do NOT copy them into the application code. Omit them entirely when translating; carry over only real UI, content, and behavior.

Completion criteria: every changed page and shared item listed below is reflected in the app, verified against its current design source. Do NOT edit .caret/sync-state.json — Caret records the sync automatically when this task completes.
</explicit_instructions>`

	const sections = [header, "", "─".repeat(60), worklist]

	if (input.intentLog) {
		sections.push(
			"",
			"─".repeat(60),
			[
				"DESIGN COMMITS SINCE LAST SYNC (context only — this history may list changes that were later superseded; the CURRENT files above are authoritative, not this log):",
				input.intentLog,
			].join("\n"),
		)
	}

	sections.push("", "─".repeat(60), inventory)
	return sections.join("\n")
}

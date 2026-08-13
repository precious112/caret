/**
 * Generate-and-pick: N takes on one instruction, rendered live, chosen by
 * pointing.
 *
 * For anything that cannot be said precisely in words ("make it feel more
 * premium"), one attempt is a coin flip. Instead Caret copies the page N
 * times, runs one independent edit per copy — each pushed toward a different
 * reading of the same instruction — and the user picks the one that looks
 * right. Pointing needs no design vocabulary, which is exactly right for the
 * developer this product is for.
 *
 * Variants are REAL pages (`.caret/pages/<id>--v1/…`): the canvas can render
 * them in live iframes with zero new machinery, the healer stamps their
 * caret-ids, and the winner is applied by copying its source back over the
 * original. They are transient — gitignored via the `pages/*--v<n>` pattern so
 * an in-flight pick never enters a sync worklist — and the set's state lives
 * in `.caret/.variants.json` (scratch, gitignored, healer-ignored).
 */
import * as fs from "fs/promises"
import * as path from "path"

import { runExclusive, writeFileAtomic } from "./file-mutation-queue"

export type VariantStatus = "working" | "ready" | "failed"

export interface VariantEntry {
	/** The variant's page id (`home--v1`) — also its directory and route. */
	id: string
	/** "Take 1", "Take 2" … what the compare surface labels the card. */
	label: string
	/** The divergence hint this take was generated under. */
	angle: string
	status: VariantStatus
	error?: string
}

export interface VariantSet {
	version: 1
	/** The page being explored. */
	pageId: string
	/** The user's instruction, verbatim. */
	instruction: string
	startedAt: string
	/** Who produced the takes — Caret's own loop, or an external agent via MCP. */
	source: "caret" | "external"
	/** What the pick means. "explore": takes on an instruction (the default).
	 * "drift-proposal": the take is the app's current truth translated back to
	 * design — accepting refreshes the sync mapping (Phase 9 reverse sync). */
	kind?: "explore" | "drift-proposal"
	/** For drift proposals: the app files whose truth the take reflects. */
	proposalAppPaths?: string[]
	variants: VariantEntry[]
}

export const VARIANT_SCRATCH_FILE = ".variants.json"

/** How many takes a variant run produces. Three is enough spread to pick from and few enough to compare at a glance. */
export const VARIANT_COUNT = 3

/**
 * Each take reads the same instruction through a different lens. The hints are
 * about *approach*, never about style specifics — the foundation and rules
 * decide style; the lens only stops three runs collapsing into one answer.
 */
export const VARIANT_ANGLES = [
	"Take the most restrained, conventional reading of the instruction — the safe interpretation done cleanly.",
	"Take a bolder reading — push the visual direction noticeably further than the cautious version would.",
	"Take a structural reading — reorganize or re-compose rather than restyle, if the instruction allows it.",
]

function scratchPath(workspacePath: string): string {
	return path.join(workspacePath, ".caret", VARIANT_SCRATCH_FILE)
}

function pagesDir(workspacePath: string): string {
	return path.join(workspacePath, ".caret", "pages")
}

export function variantPageId(pageId: string, n: number): string {
	return `${pageId}--v${n}`
}

export async function readVariantSet(workspacePath: string): Promise<VariantSet | null> {
	try {
		const raw = JSON.parse(await fs.readFile(scratchPath(workspacePath), "utf-8"))
		if (raw?.version !== 1 || typeof raw.pageId !== "string" || !Array.isArray(raw.variants)) return null
		return raw as VariantSet
	} catch {
		return null
	}
}

async function writeVariantSet(workspacePath: string, set: VariantSet): Promise<void> {
	const target = scratchPath(workspacePath)
	await runExclusive(target, () => writeFileAtomic(target, JSON.stringify(set, null, 2)))
}

async function copyDir(from: string, to: string): Promise<void> {
	await fs.rm(to, { recursive: true, force: true })
	await fs.cp(from, to, { recursive: true })
}

/**
 * Copies the page N times and records the set. Refuses when a set is already
 * in flight — two concurrent picks over one scratch file would corrupt both.
 */
export async function createVariantSet(
	workspacePath: string,
	pageId: string,
	instruction: string,
	opts: { count?: number; kind?: "explore" | "drift-proposal"; proposalAppPaths?: string[]; label?: string } = {},
): Promise<VariantSet> {
	const existing = await readVariantSet(workspacePath)
	if (existing) {
		throw new Error(
			`A variant pick for "${existing.pageId}" is already open — choose one or discard it before starting another.`,
		)
	}

	const sourceDir = path.join(pagesDir(workspacePath), pageId)
	await fs.access(path.join(sourceDir, "index.tsx"))
	const meta = JSON.parse(await fs.readFile(path.join(sourceDir, "meta.json"), "utf-8").catch(() => "{}"))

	const count = opts.count ?? VARIANT_COUNT
	const variants: VariantEntry[] = []
	for (let n = 1; n <= count; n++) {
		const id = variantPageId(pageId, n)
		const dir = path.join(pagesDir(workspacePath), id)
		await copyDir(sourceDir, dir)
		await writeFileAtomic(
			path.join(dir, "meta.json"),
			JSON.stringify(
				{ ...meta, id, title: `${meta.title ?? pageId} — ${opts.label ?? `take ${n}`}`, variantOf: pageId },
				null,
				2,
			),
		)
		variants.push({
			id,
			label: opts.label ?? `Take ${n}`,
			angle: VARIANT_ANGLES[(n - 1) % VARIANT_ANGLES.length],
			status: "working",
		})
	}

	const set: VariantSet = {
		version: 1,
		pageId,
		instruction,
		startedAt: new Date().toISOString(),
		source: "caret",
		...(opts.kind ? { kind: opts.kind } : {}),
		...(opts.proposalAppPaths ? { proposalAppPaths: opts.proposalAppPaths } : {}),
		variants,
	}
	await writeVariantSet(workspacePath, set)
	return set
}

/**
 * Registers variant pages an EXTERNAL agent already wrote (the MCP path).
 * Validates each page actually renders-worthy source before showing a pick.
 */
export async function registerExternalVariants(
	workspacePath: string,
	pageId: string,
	variantIds: string[],
	instruction: string,
): Promise<VariantSet> {
	const existing = await readVariantSet(workspacePath)
	if (existing) {
		throw new Error(`A variant pick for "${existing.pageId}" is already open — resolve it first.`)
	}
	await fs.access(path.join(pagesDir(workspacePath), pageId, "index.tsx"))
	for (const id of variantIds) {
		await fs.access(path.join(pagesDir(workspacePath), id, "index.tsx"))
	}

	const set: VariantSet = {
		version: 1,
		pageId,
		instruction,
		startedAt: new Date().toISOString(),
		source: "external",
		variants: variantIds.map((id, i) => ({ id, label: `Take ${i + 1}`, angle: "external", status: "ready" })),
	}
	await writeVariantSet(workspacePath, set)
	return set
}

export async function updateVariantStatus(
	workspacePath: string,
	variantId: string,
	status: VariantStatus,
	error?: string,
): Promise<void> {
	const set = await readVariantSet(workspacePath)
	if (!set) return
	const entry = set.variants.find((v) => v.id === variantId)
	if (!entry) return
	entry.status = status
	entry.error = error
	await writeVariantSet(workspacePath, set)
}

/**
 * Removes every variant page directory and the scratch. Registering a set —
 * Caret's own copies or an external agent's via `propose_variants` — hands the
 * variant pages to the pick: they exist to be compared, and whichever way the
 * pick resolves they are cleaned up rather than left as invisible clutter.
 */
export async function discardVariantSet(workspacePath: string): Promise<void> {
	const set = await readVariantSet(workspacePath)
	if (set) {
		for (const variant of set.variants) {
			await fs.rm(path.join(pagesDir(workspacePath), variant.id), { recursive: true, force: true })
		}
	}
	await fs.rm(scratchPath(workspacePath), { force: true })
}

/**
 * Applies the chosen take: its source files replace the original page's, the
 * meta keeps the ORIGINAL identity (id and title are not part of the take),
 * and the set is cleaned up.
 */
export async function applyVariantChoice(workspacePath: string, variantId: string): Promise<void> {
	const set = await readVariantSet(workspacePath)
	if (!set) throw new Error("No variant pick is open.")
	const chosen = set.variants.find((v) => v.id === variantId)
	if (!chosen) throw new Error(`"${variantId}" is not one of the open takes.`)

	const originalDir = path.join(pagesDir(workspacePath), set.pageId)
	const variantDir = path.join(pagesDir(workspacePath), variantId)

	const originalMeta = await fs.readFile(path.join(originalDir, "meta.json"), "utf-8").catch(() => null)
	await copyDir(variantDir, originalDir)
	if (originalMeta) {
		await writeFileAtomic(path.join(originalDir, "meta.json"), originalMeta)
	}

	for (const variant of set.variants) {
		await fs.rm(path.join(pagesDir(workspacePath), variant.id), { recursive: true, force: true })
	}
	await fs.rm(scratchPath(workspacePath), { force: true })
}

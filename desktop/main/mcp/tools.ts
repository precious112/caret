/**
 * Tools v1 — the whole surface an external agent drives Caret through.
 *
 * Two rules shape this file.
 *
 * **Every result echoes the foundational context.** An agent asked to "build me
 * a card" that has to *choose* to look up spacing and typography will not — it
 * fills the gap from its training data, confidently and wrongly. The primary
 * delivery for foundations is the generated rules files (which every mainstream
 * agent auto-loads), because an MCP server cannot inject into a client's
 * context. This echo is the backstop for an agent that only touches the tools.
 *
 * **Structured for the machine, prose only for judgment.** Token tables, page
 * inventories and flow graphs go out as JSON — measurably fewer tokens and fewer
 * hallucinations than the same content as Markdown. `get_guide` carries the
 * prose half, which is the part that genuinely needs reading rather than parsing.
 */
import * as fs from "fs/promises"
import * as path from "path"
import { z } from "zod"

import {
	caretDirectoryExists,
	completeSync,
	type FlowDefinition,
	listFlows,
	listPages,
	type PageMeta,
	readFoundationTokens,
	readPageMeta,
	readSyncState,
	runSync,
	validateFoundationTokens,
	validatePageMeta,
	writeFoundationTokens,
	writePageMeta,
} from "../../../src/core/design"
import { runExclusive, writeFileAtomic } from "../../../src/core/design/file-mutation-queue"
import { mutateFlowDefinition } from "../../../src/core/design/flow-meta"
import { Logger } from "../../../src/shared/services/Logger"
import { getDesignLayerChangedFiles } from "../../../src/utils/git"
import { recordEdit } from "../provenance"
import { buildFoundationContext, buildGuide } from "../rules/context"
import type { ScreenshotResult } from "../types"

export interface ToolContext {
	projectPath: string
	/** Renders one page and captures it, or says why it could not. */
	screenshot(pageId: string): Promise<ScreenshotResult>
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
	isError?: boolean
}

/**
 * Wraps a payload as a tool result with the foundational context attached.
 *
 * The context comes second so the agent reads the answer to its question first,
 * but it is always present — the whole point is that it cannot be skipped.
 */
async function reply(ctx: ToolContext, payload: unknown): Promise<ToolResult> {
	const foundation = await buildFoundationContext(ctx.projectPath)
	return {
		content: [
			{ type: "text", text: JSON.stringify(payload, null, 2) },
			{ type: "text", text: `<caret_foundation>\n${JSON.stringify(foundation)}\n</caret_foundation>` },
		],
	}
}

function fail(message: string): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }], isError: true }
}

/**
 * Refuses any path that escapes `.caret/`.
 *
 * An agent is not assumed hostile, but it is assumed to make mistakes, and a
 * `write_page` with `../../.ssh/authorized_keys` is a mistake with a very bad
 * ending. Resolution happens before the check so `..` segments and symlinked
 * prefixes cannot slip through.
 */
function resolveInCaret(projectPath: string, relative: string): string | null {
	const caretDir = path.resolve(projectPath, ".caret")
	const resolved = path.resolve(caretDir, relative)
	return resolved === caretDir || resolved.startsWith(caretDir + path.sep) ? resolved : null
}

export interface ToolDefinition {
	name: string
	title: string
	description: string
	inputSchema: z.ZodRawShape
	handler: (ctx: ToolContext, args: any) => Promise<ToolResult>
}

export const TOOLS: ToolDefinition[] = [
	{
		name: "get_project",
		title: "Read the design layer",
		description:
			"The structure of this project's design layer: every page with its metadata, every flow, and the current sync state. Call this first — it is the map.",
		inputSchema: {},
		async handler(ctx) {
			if (!(await caretDirectoryExists(ctx.projectPath))) {
				return fail("This project has no .caret/ design layer yet.")
			}
			const [pages, flows, sync] = await Promise.all([
				listPages(ctx.projectPath),
				listFlows(ctx.projectPath),
				readSyncState(ctx.projectPath),
			])
			return reply(ctx, {
				project: path.basename(ctx.projectPath),
				pages: pages.map(summarisePage),
				flows: flows.map(summariseFlow),
				lastSyncedCommit: sync.lastSyncedCommit,
			})
		},
	},

	{
		name: "get_page",
		title: "Read one page",
		description: "The full source and metadata of a single design page.",
		inputSchema: { pageId: z.string().describe("Page id, matching the directory under .caret/pages/") },
		async handler(ctx, { pageId }: { pageId: string }) {
			const dir = resolveInCaret(ctx.projectPath, path.join("pages", pageId))
			if (!dir) return fail(`Invalid page id: ${pageId}`)
			try {
				const source = await fs.readFile(path.join(dir, "index.tsx"), "utf-8")
				const meta = await readPageMeta(ctx.projectPath, pageId)
				return reply(ctx, { pageId, meta, source })
			} catch {
				return fail(`No page "${pageId}" in this design layer.`)
			}
		},
	},

	{
		name: "get_tokens",
		title: "Read foundation tokens",
		description:
			"This project's foundation tokens — colour, typography, spacing, radius. These are binding: styling that does not come from here will look wrong next to everything that does.",
		inputSchema: {},
		async handler(ctx) {
			const tokens = await readFoundationTokens(ctx.projectPath)
			return tokens ? reply(ctx, tokens) : fail("This project has no foundation tokens yet.")
		},
	},

	{
		name: "get_flows",
		title: "Read flows and page states",
		description: "The flow graph (which page leads where, including error paths) and each page's declared states.",
		inputSchema: {},
		async handler(ctx) {
			const [flows, pages] = await Promise.all([listFlows(ctx.projectPath), listPages(ctx.projectPath)])
			return reply(ctx, {
				flows: flows.map(summariseFlow),
				pageStates: Object.fromEntries(pages.map((p) => [p.id, p.states ?? []])),
			})
		},
	},

	{
		name: "get_screenshot",
		title: "Screenshot a page",
		description:
			"A rendered screenshot of a design page, captured fresh at 1440x900. Use this to look at your own work: after writing a page, screenshot it and check it renders the way you intended.",
		inputSchema: { pageId: z.string().describe("Page id, matching the directory under .caret/pages/") },
		async handler(ctx, { pageId }: { pageId: string }) {
			// Checked before rendering, because an unknown id does not error — the
			// shell serves an empty document and the capture succeeds. Handing an
			// agent a blank white image is worse than refusing: it looks like
			// evidence that the page is broken.
			const dir = resolveInCaret(ctx.projectPath, path.join("pages", pageId))
			if (!dir || !(await exists(path.join(dir, "index.tsx")))) {
				const available = await listPageIds(ctx.projectPath)
				return fail(`No page "${pageId}" in this design layer. Available pages: ${available.join(", ") || "none"}.`)
			}

			const result = await ctx.screenshot(pageId)
			if (!result.ok) return fail(result.reason)

			const [, mimeType = "image/png", data = ""] = /^data:([^;]+);base64,(.*)$/.exec(result.dataUrl) ?? []
			if (!data) return fail(`page "${pageId}" was captured but the image could not be encoded`)
			return { content: [{ type: "image", data, mimeType }] }
		},
	},

	{
		name: "get_sync_worklist",
		title: "Read the sync worklist",
		description:
			"The design files that changed since the last design→app sync. A net cumulative list: a change made and later reverted does not appear.",
		inputSchema: {},
		async handler(ctx) {
			const { lastSyncedCommit } = await readSyncState(ctx.projectPath)
			const changed = await getDesignLayerChangedFiles(ctx.projectPath, lastSyncedCommit)
			return reply(ctx, { since: lastSyncedCommit, isFirstSync: lastSyncedCommit === null, changed })
		},
	},

	{
		name: "get_guide",
		title: "Read the authoring guide",
		description:
			"How to author pages in this design layer — the conventions that keep the visual editor working. Read this before writing a page for the first time in a session.",
		inputSchema: {},
		async handler(ctx) {
			return { content: [{ type: "text", text: await buildGuide(ctx.projectPath) }] }
		},
	},

	{
		name: "create_page",
		title: "Create a page",
		description: "Creates a new design page with its metadata sidecar. Fails if the page already exists.",
		inputSchema: {
			pageId: z.string().describe('Directory-safe id, e.g. "checkout-review"'),
			source: z.string().describe("The full index.tsx source"),
			meta: z
				.object({
					title: z.string(),
					type: z.string().default("page"),
					states: z.array(z.string()).default([]),
					tags: z.array(z.string()).default([]),
				})
				.describe("Page metadata. Always give meaningful tags — the canvas groups by them."),
		},
		async handler(ctx, args: { pageId: string; source: string; meta: Omit<PageMeta, "id"> }) {
			const dir = resolveInCaret(ctx.projectPath, path.join("pages", args.pageId))
			if (!dir) return fail(`Invalid page id: ${args.pageId}`)
			if (await exists(dir)) return fail(`Page "${args.pageId}" already exists — use write_page to change it.`)

			const meta: PageMeta = { id: args.pageId, ...args.meta }
			if (!validatePageMeta(meta)) return fail("Invalid page metadata — id, title, type, states and tags are all required.")

			await fs.mkdir(dir, { recursive: true })
			const indexPath = path.join(dir, "index.tsx")
			await runExclusive(indexPath, () => writeFileAtomic(indexPath, args.source))
			await writePageMeta(ctx.projectPath, args.pageId, meta)
			await recordEdit(ctx.projectPath, { actor: "agent", action: "create", file: indexPath })

			return reply(ctx, { ok: true, pageId: args.pageId })
		},
	},

	{
		name: "write_page",
		title: "Replace a page's source",
		description:
			"Replaces the source of an existing page. Prefer this over your own file tools: it writes atomically, validates, and records what changed.",
		inputSchema: { pageId: z.string(), source: z.string() },
		async handler(ctx, args: { pageId: string; source: string }) {
			const dir = resolveInCaret(ctx.projectPath, path.join("pages", args.pageId))
			if (!dir) return fail(`Invalid page id: ${args.pageId}`)
			const indexPath = path.join(dir, "index.tsx")
			if (!(await exists(indexPath))) return fail(`No page "${args.pageId}" — use create_page.`)

			const before = await fs.readFile(indexPath, "utf-8").catch(() => "")
			await runExclusive(indexPath, () => writeFileAtomic(indexPath, args.source))
			await recordEdit(ctx.projectPath, {
				actor: "agent",
				action: "write",
				file: indexPath,
				sizeBefore: before.length,
				sizeAfter: args.source.length,
			})
			return reply(ctx, { ok: true, pageId: args.pageId })
		},
	},

	{
		name: "update_tokens",
		title: "Update foundation tokens",
		description:
			"Replaces the foundation tokens and regenerates the rules files every agent reads. Changing these changes how everything in the project looks, so make the change the user asked for and nothing else.",
		inputSchema: { tokens: z.record(z.unknown()).describe("A complete FoundationTokens object") },
		async handler(ctx, args: { tokens: Record<string, unknown> }) {
			if (!validateFoundationTokens(args.tokens)) {
				return fail("Invalid foundation tokens — expected the full { vibe, color, typography, spacing, radius } shape.")
			}

			await writeFoundationTokens(ctx.projectPath, args.tokens)
			await recordEdit(ctx.projectPath, { actor: "agent", action: "write", file: "tokens/foundation.json" })
			return reply(ctx, { ok: true })
		},
	},

	{
		name: "write_flow",
		title: "Update a flow",
		description: "Replaces the steps of an existing flow definition.",
		inputSchema: {
			flowId: z.string(),
			steps: z.array(
				z.object({
					page: z.string(),
					label: z.string().optional(),
					next: z.array(z.string()).default([]),
					onError: z.array(z.string()).optional(),
				}),
			),
		},
		async handler(ctx, args: { flowId: string; steps: FlowDefinition["steps"] }) {
			const found = await mutateFlowDefinition(ctx.projectPath, args.flowId, (flow) => {
				flow.steps = args.steps
			})
			if (!found) return fail(`No flow "${args.flowId}" in this design layer.`)
			await recordEdit(ctx.projectPath, { actor: "agent", action: "write", file: `flows/${args.flowId}.flow.json` })
			return reply(ctx, { ok: true, flowId: args.flowId })
		},
	},

	{
		name: "start_sync",
		title: "Start a design → app sync",
		description:
			"Asks Caret to hand you the design→app sync worklist. Normally the user starts this from Caret; call it only when they ask you to sync.",
		inputSchema: {},
		async handler(ctx) {
			const result = await runSync(ctx.projectPath)
			return reply(ctx, result)
		},
	},

	{
		name: "complete_sync",
		title: "Record a sync as done",
		description:
			"Call this when you have finished a design→app sync, with the syncId you were given. This is the only thing that advances Caret's sync bookmark — skip it and the next sync will re-report everything you just did.",
		inputSchema: { syncId: z.string().describe("The syncId from the sync prompt") },
		async handler(ctx, { syncId }: { syncId: string }) {
			const outcome = await completeSync(ctx.projectPath, syncId)
			if (outcome === "advanced" || outcome === "already-applied") {
				return reply(ctx, { ok: true, outcome })
			}
			return fail(`Could not record the sync (${outcome}).`)
		},
	},
]

function summarisePage(page: PageMeta) {
	return {
		id: page.id,
		title: page.title,
		type: page.type ?? "page",
		states: page.states ?? [],
		tags: page.tags ?? [],
		source: `.caret/pages/${page.id}/index.tsx`,
	}
}

function summariseFlow(flow: FlowDefinition) {
	return flow.invalid
		? { id: flow.id, invalid: true, error: flow.error }
		: {
				id: flow.id,
				name: flow.name ?? flow.id,
				description: flow.description,
				steps: (flow.steps ?? []).map((s) => ({ page: s.page, label: s.label, next: s.next ?? [], onError: s.onError })),
			}
}

async function exists(target: string): Promise<boolean> {
	try {
		await fs.access(target)
		return true
	} catch {
		return false
	}
}

/** Page ids in this design layer, for naming the alternatives in a refusal. */
async function listPageIds(projectPath: string): Promise<string[]> {
	const dir = resolveInCaret(projectPath, "pages")
	if (!dir) return []
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	} catch {
		return []
	}
}

export function logToolError(name: string, err: unknown): ToolResult {
	Logger.error(`[mcp] tool ${name} failed:`, err)
	return fail(err instanceof Error ? err.message : String(err))
}

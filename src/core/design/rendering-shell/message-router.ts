/**
 * Routes messages arriving from the canvas to the design core.
 *
 * This is the host-free half of what used to be `preview-panel.ts`: the same
 * handlers, with the VS Code webview replaced by the {@link DesignHost} seam.
 * Nothing in here knows whether it is running inside an Electron window, a test
 * harness, or nothing at all.
 */
import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import type { AgentTask } from "../agent/bridge"
import { markSignal, pendingSignals, signalKey } from "../corrections"
import { runExclusive } from "../file-mutation-queue"
import { mutateFlowDefinition } from "../flow-meta"
import { resolveParamsFor, spliceColorEdit, spliceParamEdit, spliceTextEdit } from "../param/edit"
import { PANEL_PROPERTIES } from "../param/params"
import { addPromotedRule } from "../promoted-rules"
import { readProvenance, recordEdit } from "../provenance"
import { bridgeFor, editLaneFor, hostFor } from "../services"
import { readFoundationTokens, writeFoundationTokens } from "../tokens"
import {
	applyVariantChoice,
	createVariantSet,
	discardVariantSet,
	readVariantSet,
	updateVariantStatus,
	type VariantSet,
} from "../variants"
import { editJSXColor, editJSXImageSrc, editJSXText } from "../visual-editing/ast-editor"
import { buildVisualEditPrompt } from "../visual-editing/context-builder"
import { precomputePage } from "../visual-editing/page-precompute"
import { precomputeAndApply } from "../visual-editing/post-generation-hook"
import {
	countTokenUses,
	foundationTokenForClass,
	setFoundationTokenValue,
	tokenClassForHex,
} from "../visual-editing/token-colors"
import { writeThemeCss } from "./entry-template"
import type {
	AiEditRequestPayload,
	DesignInboundMessage,
	FlowEdgeCreatePayload,
	FlowEdgeDeletePayload,
	FlowEdgeUpdatePayload,
	InlineEditPayload,
	OverlayEditPayload,
	ParamEditPayload,
	ParamResolvePayload,
	PromoteTokenPayload,
} from "./messages"
import { isValidDesignMessagePayload } from "./messages"

export interface MessageRouterDeps {
	/** Absolute path of the project this canvas belongs to. */
	workspacePath: string
	/** Invoked when the canvas asks for a design→app sync (the toolbar button). */
	onSyncRequested: () => void | Promise<void>
}

export interface MessageRouter {
	handle(message: DesignInboundMessage): Promise<void>
}

export function createMessageRouter(deps: MessageRouterDeps): MessageRouter {
	return { handle: (message) => handleMessage(message, deps) }
}

function sendEditResult(workspacePath: string, payload: import("./messages").EditResultPayload): void {
	hostFor(workspacePath).sendToCanvas({ source: "caret-host", type: "edit-result", payload })
}

/**
 * Hands a task to the connected agent, turning the no-agent case into a visible
 * edit-result rather than a swallowed rejection. Returns whether it was accepted.
 *
 * Visual edits go to the edit lane when the host wired one: their own
 * conversation, narrated to the canvas pill, never touching the chat. Sync and
 * flow-sync stay on the chat bridge — those are conversations the user follows
 * in the sidebar. Hosts without a lane fall back to the chat bridge, which is
 * the old behaviour.
 */
async function requestAgent(workspacePath: string, task: AgentTask): Promise<boolean> {
	const bridge =
		task.kind === "visual-edit" ? (editLaneFor(workspacePath) ?? bridgeFor(workspacePath)) : bridgeFor(workspacePath)
	try {
		await bridge.request(task)
		return true
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		Logger.warn(`[design] agent request (${task.kind}) refused: ${message}`)
		sendEditResult(workspacePath, { success: false, error: message })
		return false
	}
}

/**
 * Maps a path reported by the canvas onto a real file under `.caret/`.
 *
 * React fiber source paths arrive in several shapes depending on how the element
 * was authored, so each candidate location is probed rather than guessed at.
 */
async function resolveCaretPath(filePath: string, workspacePath: string): Promise<string> {
	if (!filePath) return filePath
	const caretDir = path.join(workspacePath, ".caret")

	if (path.isAbsolute(filePath)) {
		if (filePath.startsWith(caretDir)) return filePath
		// The fiber reports sources through RESOLVED symlinks while the project
		// may have been opened through an alias (macOS: /var → /private/var, and
		// /tmp likewise). A prefix test on the raw strings concludes the file is
		// foreign and mangles the path — compare realpaths before giving up.
		try {
			const [realFile, realCaret] = await Promise.all([fs.realpath(filePath), fs.realpath(caretDir)])
			if (realFile.startsWith(realCaret)) return filePath
		} catch {}
	}

	const relative = filePath.startsWith("/") ? filePath.slice(1) : filePath

	// Direct under .caret/ (handles "pages/home/index.tsx", "components/Button.tsx"),
	// then bare page names, then shared components.
	for (const candidate of [
		path.join(caretDir, relative),
		path.join(caretDir, "pages", relative),
		path.join(caretDir, "components", relative),
	]) {
		try {
			await fs.access(candidate)
			return candidate
		} catch {}
	}

	Logger.warn(`[design] Could not resolve caret path: "${filePath}" (tried under .caret/, .caret/pages/, .caret/components/)`)
	return path.join(caretDir, relative)
}

async function handleMessage(message: DesignInboundMessage, deps: MessageRouterDeps): Promise<void> {
	if (!isValidDesignMessagePayload(message.type, message.payload)) {
		Logger.error(`[design] Ignoring malformed ${message.type} payload: ${JSON.stringify(message.payload)}`)
		return
	}

	const { workspacePath } = deps

	switch (message.type) {
		case "log": {
			const { level, message: msg } = message.payload
			if (level === "error") {
				Logger.error(`[design:canvas] ${msg}`)
			} else {
				Logger.info(`[design:canvas] ${msg}`)
			}
			break
		}

		case "element-selected":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			Logger.debug(
				`[design] Element selected: ${message.payload.componentName} at ${message.payload.filePath}:${message.payload.lineNumber}`,
			)
			break

		case "open-file":
			await hostFor(workspacePath).openInEditor(
				await resolveCaretPath(message.payload.filePath, workspacePath),
				message.payload.lineNumber,
			)
			break

		case "inline-edit":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleInlineEdit(message.payload, workspacePath)
			break

		case "ai-edit-request":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleAiEdit(message.payload, workspacePath)
			break

		case "overlay-edit":
			await handleOverlayEdit(message.payload, workspacePath)
			break

		case "page-focused":
			await handlePageFocused(message.payload.filePath, workspacePath)
			break

		case "flow-edge-create":
			await handleFlowEdgeCreate(message.payload, workspacePath)
			break

		case "flow-edge-delete":
			await handleFlowEdgeDelete(message.payload, workspacePath)
			break

		case "flow-edge-update":
			await handleFlowEdgeUpdate(message.payload, workspacePath)
			break

		case "design-sync-now":
			await deps.onSyncRequested()
			break

		case "promote-token":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handlePromoteToken(message.payload, workspacePath)
			break

		case "variant-request":
			await handleVariantRequest(message.payload, workspacePath)
			break

		case "param-edit":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleParamEdit(message.payload, workspacePath)
			break

		case "param-resolve":
			message.payload.filePath = await resolveCaretPath(message.payload.filePath, workspacePath)
			await handleParamResolve(message.payload, workspacePath)
			break

		case "variant-pick":
			await handleVariantPick(message.payload, workspacePath)
			break

		case "edit-cancel":
			await editLaneFor(workspacePath)?.cancel()
			break

		case "edit-permission":
			await editLaneFor(workspacePath)?.respondToPermission(message.payload.requestId, message.payload.decision)
			break
	}
}

async function handleAiEdit(payload: AiEditRequestPayload, workspacePath: string): Promise<void> {
	try {
		const prompt = await buildVisualEditPrompt(payload, workspacePath)
		if (
			await requestAgent(workspacePath, {
				kind: "visual-edit",
				prompt,
				displayPrompt: payload.instruction,
				context: { filePath: payload.filePath, caretId: payload.caretId },
			})
		) {
			// The instruction is the user's own correction, in their own words —
			// the raw material for "you've asked for this three times".
			void recordEdit(workspacePath, {
				actor: "inline",
				action: "write",
				file: payload.filePath,
				param: payload.caretId,
				note: "ai-edit instruction",
				detail: { kind: "instruction", text: payload.instruction },
			})
			void maybeOfferCorrections(workspacePath)
			sendEditResult(workspacePath, { success: true })
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] AI edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleOverlayEdit(payload: OverlayEditPayload, workspacePath: string): Promise<void> {
	try {
		const resolvedFilePath = payload.filePath ? await resolveCaretPath(payload.filePath, workspacePath) : ""
		const prompt = await buildVisualEditPrompt(
			{
				instruction: payload.instruction,
				filePath: resolvedFilePath,
				lineNumber: 0,
				columnNumber: 0,
				componentName: "",
				caretId: "",
				componentStack: "",
				// The painted region *is* the space the asset would go into, so an
				// overlay edit gets the same fit judgment as a selected element.
				box: payload.regionBounds
					? { width: Math.round(payload.regionBounds.width), height: Math.round(payload.regionBounds.height) }
					: undefined,
			},
			workspacePath,
		)
		const images = payload.screenshotDataUrl ? [payload.screenshotDataUrl] : undefined
		if (
			await requestAgent(workspacePath, {
				kind: "visual-edit",
				prompt,
				displayPrompt: payload.instruction,
				images,
				context: { region: payload.regionBounds },
			})
		) {
			void recordEdit(workspacePath, {
				actor: "inline",
				action: "write",
				file: resolvedFilePath || ".caret",
				note: "overlay instruction",
				detail: { kind: "instruction", text: payload.instruction },
			})
			void maybeOfferCorrections(workspacePath)
			sendEditResult(workspacePath, { success: true })
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Overlay edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

function buildVariantPrompt(set: VariantSet, variant: VariantSet["variants"][number]): string {
	return `You are producing ${variant.label} of ${set.variants.length} INDEPENDENT takes on one instruction,
for a side-by-side pick. The page to change is .caret/pages/${variant.id}/index.tsx — a working
copy of "${set.pageId}" made for this take. Read its current source, then apply the instruction.

${variant.angle}

INSTRUCTION: ${set.instruction}

Rules for this take:
- Edit ONLY .caret/pages/${variant.id}/index.tsx. Never touch .caret/pages/${set.pageId}/ or any other page.
- Shared components are read-only here: if the change wants a component edit, inline the changed
  markup into this page's own source instead.
- This take runs unattended: shell commands and anything else that needs permission will be
  DENIED automatically. Use only your file read and edit tools.
- The other takes read the same instruction differently — do not hedge toward a middle ground;
  commit fully to this take's reading.`
}

/**
 * Generate-and-pick, Caret-orchestrated: the page is copied N times and each
 * copy gets one independent edit-lane turn under a different reading of the
 * instruction. Sequential on purpose — the edit lane is one-at-a-time, its
 * pill narrates each take, and every write goes through the same permission
 * boundary as any other edit. The compare surface updates as takes land.
 */
async function handleVariantRequest(payload: import("./messages").VariantRequestPayload, workspacePath: string): Promise<void> {
	const bridge = editLaneFor(workspacePath) ?? bridgeFor(workspacePath)
	if (!bridge.connected()) {
		sendEditResult(workspacePath, {
			success: false,
			error: "Generating takes needs a coding backend — open Settings → Backend to connect one.",
		})
		return
	}

	let set: VariantSet
	try {
		set = await createVariantSet(workspacePath, payload.pageId, payload.instruction)
	} catch (err) {
		sendEditResult(workspacePath, { success: false, error: err instanceof Error ? err.message : String(err) })
		return
	}

	void recordEdit(workspacePath, {
		actor: "inline",
		action: "write",
		file: `.caret/pages/${payload.pageId}/index.tsx`,
		note: "variant request",
		detail: { kind: "instruction", text: payload.instruction },
	})
	sendEditResult(workspacePath, { success: true })

	// Fire and forget: the takes stream in behind the compare surface.
	void (async () => {
		for (const variant of set.variants) {
			try {
				await bridge.request({
					kind: "visual-edit",
					prompt: buildVariantPrompt(set, variant),
					displayPrompt: `${variant.label}: ${set.instruction}`,
					context: { filePath: `.caret/pages/${variant.id}/index.tsx` },
					unattended: true,
				})
				await updateVariantStatus(workspacePath, variant.id, "ready")
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				Logger.warn(`[design] variant ${variant.id} failed: ${message}`)
				await updateVariantStatus(workspacePath, variant.id, "failed", message)
			}
		}
	})()
}

async function handleVariantPick(payload: import("./messages").VariantPickPayload, workspacePath: string): Promise<void> {
	try {
		if (payload.variantId) {
			// The apply rewrites the original page's files — Caret's own write, not
			// an external hand-edit.
			const set = await readVariantSet(workspacePath)
			if (set) {
				const originalDir = path.join(workspacePath, ".caret", "pages", set.pageId)
				for (const file of ["index.tsx", "meta.json"]) {
					hostFor(workspacePath).noteSelfWrite(path.join(originalDir, file))
				}
			}
			await applyVariantChoice(workspacePath, payload.variantId)
			Logger.info(`[design] variant pick: ${payload.variantId} applied over ${set?.pageId}`)
		} else {
			await discardVariantSet(workspacePath)
			Logger.info(`[design] variant pick: kept the original, takes discarded`)
		}
		sendEditResult(workspacePath, { success: true })
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] variant pick failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

/**
 * The generalized edit: one Param path (`<caretId>/style/<property>`) set to a
 * token or a raw value, spliced onto the variant active at the canvas's
 * viewport. What the property panel speaks.
 */
/** The panel's read: every supported property of one element, resolved from source. */
async function handleParamResolve(payload: ParamResolvePayload, workspacePath: string): Promise<void> {
	try {
		const [source, tokens] = await Promise.all([fs.readFile(payload.filePath, "utf-8"), readFoundationTokens(workspacePath)])
		const params = resolveParamsFor(
			source,
			payload.filePath,
			payload.caretId,
			PANEL_PROPERTIES,
			payload.viewportWidth,
			tokens,
		)
		hostFor(workspacePath).sendToCanvas({
			source: "caret-host",
			type: "param-resolve-result",
			payload: { caretId: payload.caretId, params: (params ?? []) as unknown as Array<Record<string, unknown>> },
		})
	} catch (err) {
		Logger.warn(`[design] param resolve failed: ${err}`)
		hostFor(workspacePath).sendToCanvas({
			source: "caret-host",
			type: "param-resolve-result",
			payload: { caretId: payload.caretId, params: [] },
		})
	}
}

async function handleParamEdit(payload: ParamEditPayload, workspacePath: string): Promise<void> {
	try {
		const tokens = await readFoundationTokens(workspacePath)
		hostFor(workspacePath).noteSelfWrite(payload.filePath)
		const result = await spliceParamEdit(
			payload.filePath,
			payload.caretId,
			payload.property,
			{ token: payload.token, raw: payload.raw },
			payload.viewportWidth,
			tokens,
		)
		if (!result.ok) {
			sendEditResult(workspacePath, { success: false, error: result.refused ?? "the edit was refused" })
			return
		}
		void recordEdit(workspacePath, {
			actor: "inline",
			action: "write",
			file: payload.filePath,
			param: `${payload.caretId}/style/${payload.property}`,
			newValue: payload.token ?? payload.raw,
		})
		sendEditResult(workspacePath, {
			success: true,
			editTarget: { filePath: payload.filePath, lineNumber: 0, caretId: payload.caretId },
		})
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] param edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleInlineEdit(payload: InlineEditPayload, workspacePath: string): Promise<void> {
	try {
		if (payload.editType === "color") {
			await handleColorEdit(payload, workspacePath)
			return
		}

		// Serialized per file: rapid successive edits (or an edit racing the
		// precompute hook) must never interleave read-modify-writes.
		hostFor(workspacePath).noteSelfWrite(payload.filePath)
		const success = await runExclusive(payload.filePath, async () => {
			if (payload.editType === "text") {
				// Splice path first: replaces only the trimmed content span, so the
				// recast reprint (and its compounding-indentation bug) never runs
				// for the ordinary case. The recast chain stays as the fallback for
				// what an index lookup can't serve.
				const spliced = await spliceTextEdit(payload.filePath, payload.caretId, payload.newValue, payload.oldValue)
				if (spliced.handled) return spliced.ok
				return editJSXText(
					payload.filePath,
					payload.lineNumber,
					payload.tagName || "",
					payload.newValue,
					payload.oldValue,
					payload.caretId,
				)
			}
			if (payload.editType === "image") {
				return handleImageEdit(payload, workspacePath)
			}
			return false
		})

		if (success) {
			void recordEdit(workspacePath, {
				actor: "inline",
				action: "write",
				file: payload.filePath,
				param: payload.caretId,
				oldValue: payload.oldValue || undefined,
				newValue: payload.newValue,
				note: payload.editType,
			})
			sendEditResult(workspacePath, { success: true })
		} else {
			sendEditResult(workspacePath, {
				success: false,
				error: "This content can't be edited inline — it may use dynamic expressions. Use AI Edit to describe the change you want.",
				suggestAiEdit: true,
			})
		}
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Inline edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

/**
 * The colour write policy, settled in Phase 7: an inline gesture points at ONE
 * element, so the default is detach — a wrong detach hits one element and is
 * visible immediately, a wrong token edit silently changes every use. Two
 * refinements keep the token system from eroding:
 *
 *  - **Bind on exact match.** A picked colour that IS a token's value writes
 *    the token class, not a magic number that happens to equal it today.
 *  - **Detach is promotable.** Replacing a token class reports what was
 *    detached and how many places the token reaches, so the canvas can offer
 *    "change the token instead" as one click rather than a modal in the way.
 */
async function handleColorEdit(payload: InlineEditPayload, workspacePath: string): Promise<void> {
	try {
		const tokens = await readFoundationTokens(workspacePath)
		const bindTo = tokenClassForHex(payload.newValue, tokens) ?? undefined

		hostFor(workspacePath).noteSelfWrite(payload.filePath)
		const spliced = await spliceColorEdit(payload.filePath, payload.caretId, payload.newValue, bindTo)
		const result = spliced.handled
			? { ok: spliced.ok, replacedClass: spliced.replacedClass }
			: await runExclusive(payload.filePath, () =>
					editJSXColor(payload.filePath, payload.lineNumber, payload.newValue, payload.caretId, bindTo),
				)

		if (!result.ok) {
			sendEditResult(workspacePath, {
				success: false,
				error: "This content can't be edited inline — it may use dynamic expressions. Use AI Edit to describe the change you want.",
				suggestAiEdit: true,
			})
			return
		}

		const editTarget = { filePath: payload.filePath, lineNumber: payload.lineNumber, caretId: payload.caretId }
		if (bindTo) {
			void recordEdit(workspacePath, {
				actor: "inline",
				action: "write",
				file: payload.filePath,
				param: payload.caretId,
				newValue: payload.newValue,
				detail: { kind: "color-bind", token: bindTo },
			})
			sendEditResult(workspacePath, { success: true, boundTo: bindTo, editTarget })
			return
		}

		const detachedFrom = result.replacedClass ? foundationTokenForClass(result.replacedClass, tokens) : null
		if (detachedFrom) {
			void recordEdit(workspacePath, {
				actor: "inline",
				action: "write",
				file: payload.filePath,
				param: payload.caretId,
				oldValue: result.replacedClass,
				newValue: payload.newValue,
				detail: { kind: "color-detach", token: detachedFrom, hex: payload.newValue },
			})
			// +1: the scan runs after the detach, so the element in hand no longer
			// counts itself — but promoting re-binds it, so it is part of the reach.
			const uses = await countTokenUses(path.join(workspacePath, ".caret"), detachedFrom)
			sendEditResult(workspacePath, { success: true, detachedFrom, tokenUses: uses.occurrences + 1, editTarget })
			void maybeOfferCorrections(workspacePath)
			return
		}

		void recordEdit(workspacePath, {
			actor: "inline",
			action: "write",
			file: payload.filePath,
			param: payload.caretId,
			newValue: payload.newValue,
			detail: { kind: "color", hex: payload.newValue },
		})
		sendEditResult(workspacePath, { success: true, editTarget })
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] Colour edit failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

/**
 * Correction capture: when the log shows the SAME correction made repeatedly,
 * offer to promote it — a colour into the token, an instruction into the
 * always-on rules. One offer at a time, each raised exactly once; an explicit
 * "no" is remembered so the offer never nags.
 */
async function maybeOfferCorrections(workspacePath: string): Promise<void> {
	try {
		const records = await readProvenance(workspacePath)
		const signals = await pendingSignals(workspacePath, records)
		const signal = signals[0]
		if (!signal) return

		const key = signalKey(signal)
		await markSignal(workspacePath, key, "offered")
		const host = hostFor(workspacePath)

		if (signal.kind === "token") {
			const across = signal.places.length > 1 ? ` across ${signal.places.length} places` : ""
			const choice = await host.notify(
				"info",
				`You've overridden ${signal.token} to ${signal.hex} ${signal.count} times${across}. Change the token itself so every use follows?`,
				["Change the token", "Keep as one-offs"],
			)
			if (choice === "Change the token") {
				await applyTokenCorrection(workspacePath, signal.token, signal.hex, signal.places)
			} else if (choice === "Keep as one-offs") {
				await markSignal(workspacePath, key, "dismissed")
			}
			return
		}

		const choice = await host.notify(
			"info",
			`You've asked for this ${signal.count} times: "${signal.instruction}". Make it a standing rule every agent sees?`,
			["Add to the rules", "Not a rule"],
		)
		if (choice === "Add to the rules") {
			await addPromotedRule(workspacePath, signal.instruction, "correction")
			Logger.info(`[design] promoted a repeated instruction into .caret/rules.json`)
		} else if (choice === "Not a rule") {
			await markSignal(workspacePath, key, "dismissed")
		}
	} catch (err) {
		// Offers are opportunistic — a failure here must never break the edit
		// that triggered the look.
		Logger.warn(`[design] correction offer failed: ${err}`)
	}
}

/** Repoints the token, regenerates the theme, and re-binds the recorded places. */
async function applyTokenCorrection(workspacePath: string, token: string, hex: string, places: string[]): Promise<void> {
	const tokens = await readFoundationTokens(workspacePath)
	if (!tokens || !setFoundationTokenValue(tokens, token, hex)) {
		await hostFor(workspacePath).notify("warn", `Couldn't change ${token} — the foundation no longer defines it.`)
		return
	}
	hostFor(workspacePath).noteSelfWrite(path.join(workspacePath, ".caret", "tokens", "foundation.json"))
	await writeFoundationTokens(workspacePath, tokens)
	await writeThemeCss(path.join(workspacePath, ".caret"))

	// Each detached place now carries a literal equal to the token — re-bind it
	// so a later token edit reaches it again. Best-effort per place.
	for (const place of places) {
		const [file, caretId] = place.split("#")
		if (!file || !caretId) continue
		const absolute = path.isAbsolute(file) ? file : path.join(workspacePath, file)
		hostFor(workspacePath).noteSelfWrite(absolute)
		await runExclusive(absolute, () => editJSXColor(absolute, 0, hex, caretId, token)).catch(() => {})
	}
	Logger.info(`[design] correction promoted: ${token} → ${hex} (${places.length} place(s) re-bound)`)
}

/**
 * "Change the token instead": repoints the foundation token at the picked
 * colour, regenerates the theme (one CSS hot update restyles every use), and
 * re-binds the detached element back onto the token class so the page source
 * doesn't keep a redundant arbitrary value that equals the token.
 */
async function handlePromoteToken(payload: PromoteTokenPayload, workspacePath: string): Promise<void> {
	try {
		const tokens = await readFoundationTokens(workspacePath)
		if (!tokens || !setFoundationTokenValue(tokens, payload.token, payload.hex)) {
			sendEditResult(workspacePath, {
				success: false,
				error: `Couldn't change ${payload.token} — the foundation no longer defines that token.`,
			})
			return
		}

		hostFor(workspacePath).noteSelfWrite(path.join(workspacePath, ".caret", "tokens", "foundation.json"))
		await writeFoundationTokens(workspacePath, tokens)
		// The desktop watcher also regenerates on foundation.json changes, but the
		// promote must not depend on a watcher being alive (the shell harness has
		// none), and a second identical atomic write is harmless.
		await writeThemeCss(path.join(workspacePath, ".caret"))

		hostFor(workspacePath).noteSelfWrite(payload.filePath)
		const rebound = await runExclusive(payload.filePath, () =>
			editJSXColor(payload.filePath, payload.lineNumber, payload.hex, payload.caretId, payload.token),
		)
		if (!rebound.ok) {
			Logger.warn(`[design] promote-token: token updated but re-bind of ${payload.filePath}:${payload.lineNumber} failed`)
		}

		sendEditResult(workspacePath, {
			success: true,
			boundTo: payload.token,
			editTarget: { filePath: payload.filePath, lineNumber: payload.lineNumber, caretId: payload.caretId },
		})
		Logger.info(`[design] promote-token: ${payload.token} → ${payload.hex}`)
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err)
		Logger.error(`[design] promote-token failed: ${errorMsg}`)
		sendEditResult(workspacePath, { success: false, error: errorMsg })
	}
}

async function handleImageEdit(payload: InlineEditPayload, workspacePath: string): Promise<boolean> {
	if (!payload.imageData) return false

	const assetsDir = path.join(workspacePath, ".caret", "assets")
	await fs.mkdir(assetsDir, { recursive: true })

	const base64Data = payload.imageData.replace(/^data:image\/\w+;base64,/, "")
	const fileName = payload.newValue.replace(/[^a-zA-Z0-9._-]/g, "_")
	const destPath = path.join(assetsDir, fileName)

	await fs.writeFile(destPath, Buffer.from(base64Data, "base64"))

	return editJSXImageSrc(payload.filePath, payload.lineNumber, `./assets/${fileName}`, payload.caretId)
}

async function handlePageFocused(rawFilePath: string, workspacePath: string): Promise<void> {
	try {
		const filePath = await resolveCaretPath(rawFilePath, workspacePath)
		const result = await precomputeAndApply(filePath)
		// The RESOLVED path, never the raw one. The client stores these ranges in a
		// map keyed by file and looks them up with the absolute path the React
		// fiber reports — a payload keyed "pages/home/index.tsx" matches nothing,
		// which left the dynamic-text gate dead: "Edit text" stayed enabled on
		// `{product.name}`, and the user found out only after typing, as a failure.
		hostFor(workspacePath).sendToCanvas({
			source: "caret-host",
			type: "precompute-result",
			payload: { filePath, dynamicRanges: result.dynamicRanges },
		})
		Logger.debug(`[design] page-focused: sent ${result.dynamicRanges.length} dynamic ranges, modified=${result.modified}`)

		// Components render inside the page, so their elements are exactly as
		// clickable — and the map's item content usually lives in one (`<p>
		// {product.name}</p>` in ProductCard, driven by the page's data array).
		// Analyzed read-only: healing is the page pipeline's job, and a silent
		// write to a component from a focus event would be a surprise.
		for (const dir of ["components", "layouts"]) {
			const folder = path.join(workspacePath, ".caret", dir)
			const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => [])
			for (const entry of entries) {
				if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue
				const componentPath = path.join(folder, entry.name)
				try {
					const source = await fs.readFile(componentPath, "utf-8")
					const ranges = precomputePage(source, componentPath).dynamicRanges
					hostFor(workspacePath).sendToCanvas({
						source: "caret-host",
						type: "precompute-result",
						payload: { filePath: componentPath, dynamicRanges: ranges },
					})
				} catch (err) {
					Logger.warn(`[design] page-focused: could not analyze ${componentPath}: ${err}`)
				}
			}
		}
	} catch (err) {
		Logger.error(`[design] page-focused: precompute failed for ${rawFilePath}:`, err)
	}
}

async function handleFlowEdgeCreate(payload: FlowEdgeCreatePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			let step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) {
				step = { page: payload.fromPage, next: [] }
				flow.steps.push(step)
			}
			if (!step.next.includes(payload.toPage)) {
				step.next.push(payload.toPage)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(`[design] Flow edge created: ${payload.flowId} ${payload.fromPage} → ${payload.toPage}`)
	} catch (err) {
		Logger.error("[design] Failed to create flow edge:", err)
	}
}

async function handleFlowEdgeDelete(payload: FlowEdgeDeletePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			const step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) return
			if (payload.isError) {
				step.onError = (step.onError || []).filter((p) => p !== payload.toPage)
				if (step.onError.length === 0) delete step.onError
			} else {
				step.next = step.next.filter((p) => p !== payload.toPage)
			}
			if (step.next.length === 0 && !step.onError?.length && !step.label) {
				flow.steps = flow.steps.filter((s) => s !== step)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(`[design] Flow edge deleted: ${payload.flowId} ${payload.fromPage} → ${payload.toPage}`)
	} catch (err) {
		Logger.error("[design] Failed to delete flow edge:", err)
	}
}

async function handleFlowEdgeUpdate(payload: FlowEdgeUpdatePayload, workspacePath: string): Promise<void> {
	try {
		const found = await mutateFlowDefinition(workspacePath, payload.flowId, (flow) => {
			let step = flow.steps.find((s) => s.page === payload.fromPage)
			if (!step) {
				step = { page: payload.fromPage, next: [] }
				flow.steps.push(step)
			}
			if (payload.isError) {
				const onError = (step.onError || []).filter((p) => p !== payload.oldToPage)
				if (!onError.includes(payload.newToPage)) onError.push(payload.newToPage)
				step.onError = onError
			} else {
				step.next = step.next.filter((p) => p !== payload.oldToPage)
				if (!step.next.includes(payload.newToPage)) step.next.push(payload.newToPage)
			}
		})
		if (!found) {
			Logger.error(`[design] Flow not found: ${payload.flowId}`)
			return
		}
		Logger.info(
			`[design] Flow edge updated: ${payload.flowId} ${payload.fromPage} → ${payload.oldToPage} ⇒ ${payload.newToPage}`,
		)
	} catch (err) {
		Logger.error("[design] Failed to update flow edge:", err)
	}
}

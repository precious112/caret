/**
 * Splice-backed inline editors — the primary write path for text and colour.
 *
 * These replace the recast reprint path for the operations that are pure span
 * replacement, which retires its bug class: recast re-indented the reprinted
 * subtree, the next edit read the inflated whitespace back, and indentation
 * grew a level per edit. A splice writes only the span; the whitespace is
 * never read or written.
 *
 * The recast editors remain as the FALLBACK for the shapes an index lookup
 * cannot serve (no caret-id, colour inside a style object, line-only
 * addressing) — recast is still correct for genuine restructuring; splice is
 * simply the right tool for span replacement, and span replacement is what
 * inline editing overwhelmingly is.
 */
import type { FoundationTokens } from "../types"
import { type ParamWrite, parseClassName, propertyOf, resolveParam, writeParam } from "./params"
import { getIndex } from "./source-index"
import { type SpliceEdit, spliceFile } from "./splice"

export interface SpliceEditOutcome {
	/** True when the splice path handled the edit (successfully or as a clean no-op). */
	handled: boolean
	/** True when a write happened (or the value was already correct — idempotent success). */
	ok: boolean
	/** The class the colour edit replaced, for detach detection. */
	replacedClass?: string
}

const NOT_HANDLED: SpliceEditOutcome = { handled: false, ok: false }

/**
 * Text edit by caret-id: replaces the trimmed content span whose text matches
 * `oldText` (or the element's single span). Never touches whitespace.
 * Idempotent: current === new is success without a write.
 */
export async function spliceTextEdit(
	filePath: string,
	caretId: string | undefined,
	newText: string,
	oldText?: string,
): Promise<SpliceEditOutcome> {
	if (!caretId) return NOT_HANDLED

	let outcome: SpliceEditOutcome = NOT_HANDLED
	await spliceFile(filePath, (source) => {
		const index = getIndex(filePath, source)
		if (index.parseError) return null
		const element = index.elements.get(caretId)
		if (!element || element.textSpans.length === 0) return null

		// The span to edit: the one carrying oldText when given (guards against
		// a stale target after HMR), else the only span. Multiple spans with no
		// oldText is ambiguous — leave it to the fallback chain.
		const candidates = oldText
			? element.textSpans.filter((span) => span.text === oldText.trim())
			: element.textSpans.length === 1
				? element.textSpans
				: []
		if (candidates.length !== 1) {
			// Redelivery guard: if some span already carries the new text, the
			// edit already landed — success without a write.
			if (element.textSpans.some((span) => span.text === newText.trim())) {
				outcome = { handled: true, ok: true }
			}
			return null
		}

		const span = candidates[0]
		outcome = { handled: true, ok: true }
		if (span.text === newText.trim()) return null
		return [{ start: span.start, end: span.end, text: newText.trim() }]
	})
	return outcome
}

/**
 * Colour edit by caret-id: replaces the FIRST colour-family utility in the
 * element's className — same user-facing semantic the picker always had —
 * keeping both the family prefix (`bg-` stays `bg-`) and any variant prefix.
 * `tokenClass` writes the token name instead of an arbitrary value.
 */
export async function spliceColorEdit(
	filePath: string,
	caretId: string | undefined,
	newColor: string,
	tokenClass?: string,
): Promise<SpliceEditOutcome> {
	if (!caretId) return NOT_HANDLED

	let outcome: SpliceEditOutcome = NOT_HANDLED
	await spliceFile(filePath, (source) => {
		const index = getIndex(filePath, source)
		if (index.parseError) return null
		const element = index.elements.get(caretId)
		if (!element) return null

		const classAttr = element.attributes.get("className")

		// A dynamic className or a colour living in style={{}} is the recast
		// fallback's job — not handled here.
		if (classAttr && classAttr.value === null) return null

		const value = classAttr?.value ?? ""
		const utilities = parseClassName(value)
		const target = utilities.find((utility) => propertyOf(utility.base)?.type === "color")
		const suffix = tokenClass ?? `[${newColor}]`

		if (target && classAttr?.valueStart !== null && classAttr !== undefined) {
			const family = [
				"bg-",
				"text-",
				"border-",
				"ring-",
				"from-",
				"to-",
				"via-",
				"outline-",
				"accent-",
				"fill-",
				"stroke-",
			].find((prefix) => target.base.startsWith(prefix))
			if (!family) return null
			const variantPrefix = target.raw.slice(0, target.raw.length - target.base.length)
			const start = (classAttr.valueStart ?? 0) + target.start
			const end = (classAttr.valueStart ?? 0) + target.end
			outcome = { handled: true, ok: true, replacedClass: target.base }
			const replacement = `${variantPrefix}${family}${suffix}`
			if (source.slice(start, end) === replacement) return null
			return [{ start, end, text: replacement }]
		}

		// No colour class: append one (or create className), same as before.
		if (classAttr && classAttr.valueStart !== null && classAttr.valueEnd !== null) {
			outcome = { handled: true, ok: true }
			const needsSpace = value.length > 0
			return [{ start: classAttr.valueEnd, end: classAttr.valueEnd, text: `${needsSpace ? " " : ""}text-${suffix}` }]
		}
		if (!classAttr) {
			outcome = { handled: true, ok: true }
			return [{ start: element.openingInsertAt, end: element.openingInsertAt, text: ` className="text-${suffix}"` }]
		}
		return null
	})
	return outcome
}

/**
 * The generalized Param edit: `<caretId>/style/<property>` set to a token or
 * raw value at a viewport. This is what the property panel speaks, and the
 * `{path, value}` payload the plan generalizes InlineEditPayload toward.
 */
export async function spliceParamEdit(
	filePath: string,
	caretId: string,
	property: string,
	next: ParamWrite,
	viewportWidth: number,
	tokens: FoundationTokens | null,
): Promise<{ ok: boolean; refused?: string }> {
	let refused: string | undefined
	let wrote = false

	await spliceFile(filePath, (source) => {
		const index = getIndex(filePath, source)
		if (index.parseError) {
			refused = `the file does not parse: ${index.parseError}`
			return null
		}
		const element = index.elements.get(caretId)
		if (!element) {
			refused = `no element with caret-id "${caretId}" in this file`
			return null
		}
		const edits = writeParam(element, property, next, { viewportWidth, tokens })
		if ("refused" in edits) {
			refused = edits.refused
			return null
		}
		wrote = true
		return edits as SpliceEdit[]
	})

	return refused ? { ok: false, refused } : { ok: wrote }
}

/** The panel's read side: every supported property of one element, resolved. */
export function resolveParamsFor(
	source: string,
	filePath: string,
	caretId: string,
	properties: readonly string[],
	viewportWidth: number,
	tokens: FoundationTokens | null,
) {
	const index = getIndex(filePath, source)
	const element = index.elements.get(caretId)
	if (!element) return null
	return properties.map((property) => resolveParam(element, property, { viewportWidth, tokens }))
}

import * as recast from "recast"

import { parseSource } from "./ast-editor"

type ASTNode = recast.types.namedTypes.Node

export type DiagnosticCode = "dynamic-text" | "dynamic-image-src" | "dynamic-tailwind-class"

export interface DynamicRange {
	startLine: number
	startCol: number
	endLine: number
	endCol: number
	diagnostics: DiagnosticCode[]
}

/**
 * Counts of caret-id rule violations the precompute pass had to auto-heal. A
 * non-zero total means the AI ignored the design-layer caret-id rules — surfaced
 * so the breakage is observable, not silent.
 */
export interface CaretIdViolations {
	/** `data-caret-id={expr}` (not a string literal) → rewritten to a unique static id. */
	dynamic: number
	/** Same static id used on multiple elements → later ones renamed unique. */
	duplicate: number
	/** A `data-caret-id` on an element inside `.map()`/iterator → stripped. */
	inIterator: number
}

export interface PrecomputeResult {
	filePath: string
	modified: boolean
	correctedSource?: string
	dynamicRanges: DynamicRange[]
	caretIdViolations: CaretIdViolations
}

const VISIBLE_TAGS = new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"span",
	"a",
	"button",
	"img",
	"input",
	"textarea",
	"label",
])

const ITERATOR_METHODS = new Set(["map", "forEach", "flatMap", "filter"])

const TAILWIND_COLOR_PREFIXES = [
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
]

const CSS_TO_TAILWIND: Record<string, string> = {
	backgroundColor: "bg",
	color: "text",
	fontSize: "text",
	padding: "p",
	paddingTop: "pt",
	paddingRight: "pr",
	paddingBottom: "pb",
	paddingLeft: "pl",
	margin: "m",
	marginTop: "mt",
	marginRight: "mr",
	marginBottom: "mb",
	marginLeft: "ml",
	width: "w",
	height: "h",
	maxWidth: "max-w",
	minWidth: "min-w",
	maxHeight: "max-h",
	minHeight: "min-h",
	borderRadius: "rounded",
	borderColor: "border",
	gap: "gap",
	top: "top",
	right: "right",
	bottom: "bottom",
	left: "left",
	opacity: "opacity",
	zIndex: "z",
}

function isNativeElement(tagName: string): boolean {
	return tagName[0] === tagName[0].toLowerCase()
}

function isVisibleTag(tagName: string): boolean {
	return VISIBLE_TAGS.has(tagName)
}

/** Native DOM tag name (lowercase JSX identifier) or null. Drives inline-style conversion. */
function getTagName(node: recast.types.namedTypes.JSXElement): string | null {
	const name = node.openingElement.name
	if (name.type === "JSXIdentifier") return name.name
	return null
}

/**
 * The "effective" tag for caret-id targeting. Resolves a plain identifier (`h1`,
 * `div`, `Button`) AND a member expression's property (`motion.h2` → `"h2"`),
 * since framer-motion forwards `data-*` attributes to the underlying DOM tag.
 * Gated downstream by `isVisibleTag`, so only `motion.<visible-tag>` qualifies —
 * `motion.div` / `Tooltip.Trigger` fall out.
 */
function getCaretTagName(node: recast.types.namedTypes.JSXElement): string | null {
	const name = node.openingElement.name
	if (name.type === "JSXIdentifier") return name.name
	if (name.type === "JSXMemberExpression" && name.property.type === "JSXIdentifier") {
		return name.property.name
	}
	return null
}

function getCaretIdAttr(node: recast.types.namedTypes.JSXElement): recast.types.namedTypes.JSXAttribute | null {
	for (const attr of node.openingElement.attributes || []) {
		if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === "data-caret-id") {
			return attr
		}
	}
	return null
}

/** Strip every `data-caret-id` attribute from the element. Returns true if any was removed. */
function removeCaretIdAttribute(node: recast.types.namedTypes.JSXElement): boolean {
	const attrs = node.openingElement.attributes || []
	const kept = attrs.filter(
		(attr) => !(attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === "data-caret-id"),
	)
	if (kept.length !== attrs.length) {
		node.openingElement.attributes = kept
		return true
	}
	return false
}

function getSemanticHint(node: recast.types.namedTypes.JSXElement): string | null {
	const hintAttrs = ["alt", "placeholder", "aria-label"]
	for (const attr of node.openingElement.attributes || []) {
		if (
			attr.type === "JSXAttribute" &&
			attr.name.type === "JSXIdentifier" &&
			hintAttrs.includes(attr.name.name) &&
			attr.value?.type === "StringLiteral" &&
			attr.value.value.trim()
		) {
			return attr.value.value
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9\s-]/g, "")
				.replace(/\s+/g, "-")
				.slice(0, 30)
		}
	}
	return null
}

function toKebabId(prefix: string, hint: string | null): string {
	if (hint) return `${prefix}-${hint}`
	return prefix
}

function addCaretIdAttribute(node: recast.types.namedTypes.JSXElement, id: string): void {
	const b = recast.types.builders
	const attr = b.jsxAttribute(b.jsxIdentifier("data-caret-id"), b.stringLiteral(id))
	node.openingElement.attributes = node.openingElement.attributes || []
	node.openingElement.attributes.unshift(attr)
}

function hasDynamicTextChild(node: recast.types.namedTypes.JSXElement): boolean {
	for (const child of node.children || []) {
		if (
			child.type === "JSXExpressionContainer" &&
			child.expression.type !== "StringLiteral" &&
			child.expression.type !== "JSXEmptyExpression"
		) {
			return true
		}
	}
	return false
}

function hasDynamicImageSrc(node: recast.types.namedTypes.JSXElement): boolean {
	for (const attr of node.openingElement.attributes || []) {
		if (
			attr.type === "JSXAttribute" &&
			attr.name.type === "JSXIdentifier" &&
			attr.name.name === "src" &&
			attr.value?.type === "JSXExpressionContainer" &&
			attr.value.expression.type !== "StringLiteral"
		) {
			return true
		}
	}
	return false
}

function hasDynamicTailwindClass(node: recast.types.namedTypes.JSXElement): boolean {
	for (const attr of node.openingElement.attributes || []) {
		if (attr.type !== "JSXAttribute") continue
		if (attr.name.type !== "JSXIdentifier" || attr.name.name !== "className") continue
		if (attr.value?.type !== "JSXExpressionContainer") continue

		const expr = attr.value.expression
		if (expr.type === "TemplateLiteral" && expr.expressions.length > 0) {
			for (const quasi of expr.quasis) {
				const raw = quasi.value.raw
				if (
					TAILWIND_COLOR_PREFIXES.some(
						(p) => raw.endsWith(p) || (raw.includes(p) && raw.indexOf(p) < raw.length - p.length),
					)
				) {
					return true
				}
			}
		}
	}
	return false
}

function getElementRange(node: recast.types.namedTypes.JSXElement): {
	startLine: number
	startCol: number
	endLine: number
	endCol: number
} | null {
	if (!node.loc) return null
	return {
		startLine: node.loc.start.line,
		startCol: node.loc.start.column,
		endLine: node.loc.end.line,
		endCol: node.loc.end.column,
	}
}

function convertInlineStyle(node: recast.types.namedTypes.JSXElement): { classes: string[]; fullyConverted: boolean } | null {
	const attrs = node.openingElement.attributes || []
	let styleAttrIndex = -1
	let styleExpr: recast.types.namedTypes.ObjectExpression | null = null

	for (let i = 0; i < attrs.length; i++) {
		const attr = attrs[i]
		if (
			attr.type === "JSXAttribute" &&
			attr.name.type === "JSXIdentifier" &&
			attr.name.name === "style" &&
			attr.value?.type === "JSXExpressionContainer" &&
			attr.value.expression.type === "ObjectExpression"
		) {
			styleAttrIndex = i
			styleExpr = attr.value.expression as recast.types.namedTypes.ObjectExpression
			break
		}
	}

	if (!styleExpr || styleAttrIndex === -1) return null

	const classes: string[] = []
	let fullyConverted = true

	for (const prop of styleExpr.properties) {
		if (prop.type !== "ObjectProperty" && prop.type !== "Property") {
			fullyConverted = false
			continue
		}

		const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : ""
		const twPrefix = CSS_TO_TAILWIND[key]

		if (!twPrefix) {
			fullyConverted = false
			continue
		}

		let value: string | null = null
		if (prop.value.type === "StringLiteral") {
			value = prop.value.value
		} else if (
			prop.value.type === "NumericLiteral" ||
			(prop.value.type === "Literal" && typeof (prop.value as any).value === "number")
		) {
			value = String((prop.value as any).value)
		}

		if (value !== null) {
			classes.push(`${twPrefix}-[${value}]`)
		} else {
			fullyConverted = false
		}
	}

	if (classes.length === 0) return null

	return { classes, fullyConverted }
}

function mergeClassesIntoClassName(node: recast.types.namedTypes.JSXElement, newClasses: string[]): void {
	const b = recast.types.builders
	const attrs = node.openingElement.attributes || []
	const classStr = newClasses.join(" ")

	for (const attr of attrs) {
		if (
			attr.type === "JSXAttribute" &&
			attr.name.type === "JSXIdentifier" &&
			attr.name.name === "className" &&
			attr.value?.type === "StringLiteral"
		) {
			attr.value.value = attr.value.value + " " + classStr
			return
		}
	}

	attrs.push(b.jsxAttribute(b.jsxIdentifier("className"), b.stringLiteral(classStr)))
}

function removeStyleAttribute(node: recast.types.namedTypes.JSXElement): void {
	const attrs = node.openingElement.attributes || []
	node.openingElement.attributes = attrs.filter((attr) => {
		if (attr.type !== "JSXAttribute") return true
		if (attr.name.type !== "JSXIdentifier") return true
		return attr.name.name !== "style"
	})
}

function isInsideIterator(path: any): boolean {
	let current = path.parent
	while (current) {
		const node = current.node || current.value
		if (!node) break

		if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
			const grandparent = current.parent
			if (grandparent) {
				const gpNode = grandparent.node || grandparent.value
				if (gpNode && gpNode.type === "CallExpression" && gpNode.callee) {
					const callee = gpNode.callee
					if (
						callee.type === "MemberExpression" &&
						callee.property.type === "Identifier" &&
						ITERATOR_METHODS.has(callee.property.name)
					) {
						return true
					}
				}
			}
		}

		current = current.parent
	}
	return false
}

export function precomputePage(source: string, filePath: string): PrecomputeResult {
	let ast: ASTNode
	try {
		ast = parseSource(source)
	} catch (err) {
		console.error(`[design] precompute: failed to parse ${filePath}:`, err)
		return { filePath, modified: false, dynamicRanges: [], caretIdViolations: { dynamic: 0, duplicate: 0, inIterator: 0 } }
	}

	const dynamicRanges: DynamicRange[] = []
	let modified = false
	const idCounters = new Map<string, number>()
	const violations: CaretIdViolations = { dynamic: 0, duplicate: 0, inIterator: 0 }

	// Pre-pass: every static caret-id literal already in the file. Generated ids
	// must avoid these so we never collide with an author-provided id that appears
	// later in the document.
	const existingIds = new Set<string>()
	recast.types.visit(ast, {
		visitJSXElement(path) {
			const attr = getCaretIdAttr(path.node)
			if (attr?.value?.type === "StringLiteral") existingIds.add(attr.value.value)
			return this.traverse(path)
		},
	})

	// Caret-ids confirmed/assigned so far in document order — the uniqueness set.
	const usedIds = new Set<string>()

	function freshId(tagName: string, node: recast.types.namedTypes.JSXElement): string {
		const hint = getSemanticHint(node)
		let candidate: string
		do {
			const count = (idCounters.get(tagName) || 0) + 1
			idCounters.set(tagName, count)
			candidate = toKebabId(`${tagName}-${count}`, hint)
		} while (existingIds.has(candidate) || usedIds.has(candidate))
		usedIds.add(candidate)
		return candidate
	}

	recast.types.visit(ast, {
		visitJSXElement(path) {
			const node = path.node
			const nativeTag = getTagName(node)
			const caretTag = getCaretTagName(node)

			const inIterator = isInsideIterator(path)
			const range = getElementRange(node)

			if (inIterator && range && caretTag) {
				const diagnostics: DiagnosticCode[] = []
				if (isVisibleTag(caretTag) && hasDynamicTextChild(node)) diagnostics.push("dynamic-text")
				if (caretTag === "img" && hasDynamicImageSrc(node)) diagnostics.push("dynamic-image-src")
				if (hasDynamicTailwindClass(node)) diagnostics.push("dynamic-tailwind-class")
				if (diagnostics.length === 0) diagnostics.push("dynamic-text")
				dynamicRanges.push({ ...range, diagnostics })
			}

			// Convert inline styles — native DOM elements only (never motion.* etc.,
			// whose `style` can carry animated motion values).
			if (nativeTag && isNativeElement(nativeTag)) {
				const conversion = convertInlineStyle(node)
				if (conversion) {
					mergeClassesIntoClassName(node, conversion.classes)
					if (conversion.fullyConverted) {
						removeStyleAttribute(node)
					}
					modified = true
				}
			}

			// Normalize caret-ids on visible elements (native + motion.<visible-tag>):
			// every one must be a UNIQUE STATIC string literal, or the AST-based inline
			// editor can't locate it. This both auto-corrects and counts AI rule breaks.
			if (caretTag && isVisibleTag(caretTag)) {
				if (inIterator) {
					// Elements inside .map() render N times — a single literal id would
					// duplicate across rows. Inline editing isn't supported here; strip it.
					if (removeCaretIdAttribute(node)) {
						modified = true
						violations.inIterator++
					}
				} else {
					const attr = getCaretIdAttr(node)
					if (!attr) {
						addCaretIdAttribute(node, freshId(caretTag, node))
						modified = true
					} else if (attr.value?.type !== "StringLiteral") {
						// Dynamic id (`{expr}` / template / ternary) — the AST matcher only
						// matches string literals. Replace with a unique static one.
						removeCaretIdAttribute(node)
						addCaretIdAttribute(node, freshId(caretTag, node))
						modified = true
						violations.dynamic++
					} else if (usedIds.has(attr.value.value)) {
						// Duplicate static id — rename the later occurrence.
						attr.value.value = freshId(caretTag, node)
						modified = true
						violations.duplicate++
					} else {
						usedIds.add(attr.value.value)
					}
				}
			}

			if (!inIterator && range && caretTag) {
				const diagnostics: DiagnosticCode[] = []
				if (hasDynamicTextChild(node)) diagnostics.push("dynamic-text")
				if (caretTag === "img" && hasDynamicImageSrc(node)) diagnostics.push("dynamic-image-src")
				if (hasDynamicTailwindClass(node)) diagnostics.push("dynamic-tailwind-class")
				if (diagnostics.length > 0) {
					dynamicRanges.push({ ...range, diagnostics })
				}
			}

			return this.traverse(path)
		},
	})

	const totalViolations = violations.dynamic + violations.duplicate + violations.inIterator
	if (totalViolations > 0) {
		console.warn(
			`[design] precompute: auto-healed ${totalViolations} caret-id violation(s) in ${filePath} ` +
				`(dynamic: ${violations.dynamic}, duplicate: ${violations.duplicate}, in-iterator: ${violations.inIterator}) — ` +
				`AI likely ignored the design-layer caret-id rules`,
		)
	}

	const result: PrecomputeResult = { filePath, modified, dynamicRanges, caretIdViolations: violations }
	if (modified) {
		result.correctedSource = recast.print(ast).code
	}
	return result
}

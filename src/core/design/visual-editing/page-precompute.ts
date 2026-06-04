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

export interface PrecomputeResult {
	filePath: string
	modified: boolean
	correctedSource?: string
	dynamicRanges: DynamicRange[]
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

function getTagName(node: recast.types.namedTypes.JSXElement): string | null {
	const name = node.openingElement.name
	if (name.type === "JSXIdentifier") return name.name
	return null
}

function hasCaretId(node: recast.types.namedTypes.JSXElement): boolean {
	for (const attr of node.openingElement.attributes || []) {
		if (
			attr.type === "JSXAttribute" &&
			attr.name.type === "JSXIdentifier" &&
			attr.name.name === "data-caret-id" &&
			attr.value?.type === "StringLiteral"
		) {
			return true
		}
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
				if (TAILWIND_COLOR_PREFIXES.some((p) => raw.endsWith(p) || (raw.includes(p) && raw.indexOf(p) < raw.length - p.length))) {
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

function convertInlineStyle(
	node: recast.types.namedTypes.JSXElement,
): { classes: string[]; fullyConverted: boolean } | null {
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
		} else if (prop.value.type === "NumericLiteral" || (prop.value.type === "Literal" && typeof (prop.value as any).value === "number")) {
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
		return { filePath, modified: false, dynamicRanges: [] }
	}

	const dynamicRanges: DynamicRange[] = []
	let modified = false
	const idCounters = new Map<string, number>()

	function nextId(tagName: string, hint: string | null): string {
		const count = (idCounters.get(tagName) || 0) + 1
		idCounters.set(tagName, count)
		return toKebabId(`${tagName}-${count}`, hint)
	}

	recast.types.visit(ast, {
		visitJSXElement(path) {
			const node = path.node
			const tagName = getTagName(node)
			if (!tagName) return this.traverse(path)

			const inIterator = isInsideIterator(path)
			const range = getElementRange(node)

			if (inIterator && range) {
				const diagnostics: DiagnosticCode[] = []
				if (isVisibleTag(tagName) && hasDynamicTextChild(node)) diagnostics.push("dynamic-text")
				if (tagName === "img" && hasDynamicImageSrc(node)) diagnostics.push("dynamic-image-src")
				if (hasDynamicTailwindClass(node)) diagnostics.push("dynamic-tailwind-class")
				if (diagnostics.length === 0) diagnostics.push("dynamic-text")
				dynamicRanges.push({ ...range, diagnostics })
			}

			// Convert inline styles (both inside and outside iterators)
			if (isNativeElement(tagName)) {
				const conversion = convertInlineStyle(node)
				if (conversion) {
					mergeClassesIntoClassName(node, conversion.classes)
					if (conversion.fullyConverted) {
						removeStyleAttribute(node)
					}
					modified = true
				}
			}

			// Add caret-id and detect dynamic content (only outside iterators)
			if (!inIterator && isNativeElement(tagName) && isVisibleTag(tagName)) {
				if (!hasCaretId(node)) {
					const hint = getSemanticHint(node)
					const id = nextId(tagName, hint)
					addCaretIdAttribute(node, id)
					modified = true
				}
			}

			if (!inIterator && range) {
				const diagnostics: DiagnosticCode[] = []
				if (hasDynamicTextChild(node)) diagnostics.push("dynamic-text")
				if (tagName === "img" && hasDynamicImageSrc(node)) diagnostics.push("dynamic-image-src")
				if (hasDynamicTailwindClass(node)) diagnostics.push("dynamic-tailwind-class")
				if (diagnostics.length > 0) {
					dynamicRanges.push({ ...range, diagnostics })
				}
			}

			return this.traverse(path)
		},
	})

	const result: PrecomputeResult = { filePath, modified, dynamicRanges }
	if (modified) {
		result.correctedSource = recast.print(ast).code
	}
	return result
}

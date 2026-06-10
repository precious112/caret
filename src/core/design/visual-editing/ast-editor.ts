import * as fs from "fs/promises"

import * as recast from "recast"

import { writeFileAtomic } from "../file-mutation-queue"

const babelParser = require("recast/parsers/babel-ts")

type ASTNode = recast.types.namedTypes.Node

export function parseSource(source: string) {
	return recast.parse(source, {
		parser: babelParser,
		sourceFileName: "source.tsx",
	})
}

export function findJSXElementByCaretId(ast: ASTNode, caretId: string): recast.types.namedTypes.JSXElement | null {
	let match: recast.types.namedTypes.JSXElement | null = null

	recast.types.visit(ast, {
		visitJSXElement(path) {
			const node = path.node
			for (const attr of node.openingElement.attributes || []) {
				if (
					attr.type === "JSXAttribute" &&
					attr.name.type === "JSXIdentifier" &&
					attr.name.name === "data-caret-id" &&
					attr.value?.type === "StringLiteral" &&
					attr.value.value === caretId
				) {
					match = node
					return false
				}
			}
			return this.traverse(path)
		},
	})

	return match
}

export function findJSXElementAtLine(
	ast: ASTNode,
	lineNumber: number,
	tagName?: string,
): recast.types.namedTypes.JSXElement | null {
	let match: recast.types.namedTypes.JSXElement | null = null

	recast.types.visit(ast, {
		visitJSXElement(path) {
			const node = path.node
			const startLine = node.loc?.start.line
			if (startLine === lineNumber) {
				if (tagName) {
					const opening = node.openingElement
					if (opening.name.type === "JSXIdentifier" && opening.name.name.toLowerCase() === tagName) {
						match = node
						return false
					}
				} else {
					match = node
					return false
				}
			}
			return this.traverse(path)
		},
	})

	if (!match && tagName) {
		let closestDist = Number.POSITIVE_INFINITY
		recast.types.visit(ast, {
			visitJSXElement(path) {
				const node = path.node
				const startLine = node.loc?.start.line
				if (startLine) {
					const dist = Math.abs(startLine - lineNumber)
					if (dist < closestDist) {
						const opening = node.openingElement
						if (opening.name.type === "JSXIdentifier" && opening.name.name.toLowerCase() === tagName) {
							closestDist = dist
							match = node
						}
					}
				}
				this.traverse(path)
			},
		})
	}

	return match
}

export function findJSXElementAtPosition(ast: ASTNode, line: number, column: number): recast.types.namedTypes.JSXElement | null {
	let match: recast.types.namedTypes.JSXElement | null = null

	recast.types.visit(ast, {
		visitJSXElement(path) {
			const node = path.node
			const loc = node.loc
			if (!loc) return this.traverse(path)

			const afterStart = line > loc.start.line || (line === loc.start.line && column >= loc.start.column)
			const beforeEnd = line < loc.end.line || (line === loc.end.line && column <= loc.end.column)

			if (afterStart && beforeEnd) {
				match = node
			}

			this.traverse(path)
		},
	})

	return match
}

export async function editJSXText(
	filePath: string,
	lineNumber: number,
	tagName: string,
	newText: string,
	oldText?: string,
	caretId?: string,
): Promise<boolean> {
	try {
		console.log(
			`[design] editJSXText: file=${filePath} line=${lineNumber} tag=${tagName} caretId=${caretId} newText=${newText} oldText=${oldText}`,
		)
		const source = await fs.readFile(filePath, "utf-8")
		console.log(`[design] editJSXText: file read OK, ${source.length} chars`)
		const ast = parseSource(source)
		console.log(`[design] editJSXText: AST parsed OK`)
		const element = caretId
			? findJSXElementByCaretId(ast, caretId) || findJSXElementAtLine(ast, lineNumber, tagName)
			: findJSXElementAtLine(ast, lineNumber, tagName)
		console.log(`[design] editJSXText: element found=${!!element}`)

		if (!element) {
			console.warn(`[design] AST: no JSX element found at ${filePath}:${lineNumber} (tag=${tagName})`)
			return oldText ? fallbackTextReplace(filePath, source, oldText, newText) : false
		}

		// Stale-target guard: the client captured oldText from the DOM, but the
		// file may have shifted since (HMR, external edits). Only mutate content
		// that still matches what the user saw; otherwise fall through to the
		// unique-occurrence text replace, and from there to the AI-edit fallback.
		const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
		const matchesOld = (current: string) => !oldText || normalize(current) === normalize(oldText)

		for (const child of element.children || []) {
			if (child.type === "JSXText" && typeof child.value === "string" && child.value.trim()) {
				if (!matchesOld(child.value)) {
					console.warn(`[design] AST: text at ${filePath}:${lineNumber} no longer matches oldText — stale target`)
					continue
				}
				const leading = child.value.match(/^(\s*)/)?.[1] || ""
				const trailing = child.value.match(/(\s*)$/)?.[1] || ""
				child.value = leading + newText + trailing
				const output = recast.print(ast).code
				await writeFileAtomic(filePath, output)
				return true
			}
			if (child.type === "JSXExpressionContainer" && child.expression && child.expression.type === "StringLiteral") {
				if (!matchesOld(child.expression.value)) continue
				child.expression.value = newText
				const output = recast.print(ast).code
				await writeFileAtomic(filePath, output)
				return true
			}
		}

		const attrs = element.openingElement.attributes || []
		for (const attr of attrs) {
			if (attr.type !== "JSXAttribute") continue
			const name = attr.name.type === "JSXIdentifier" ? attr.name.name : ""
			if (["label", "title", "placeholder", "alt", "children"].includes(name)) {
				if (attr.value?.type === "StringLiteral" && matchesOld(attr.value.value)) {
					attr.value.value = newText
					const output = recast.print(ast).code
					await writeFileAtomic(filePath, output)
					return true
				}
			}
		}

		console.warn(`[design] AST: found element but no editable text content at ${filePath}:${lineNumber}`)
		if (oldText) return fallbackTextReplace(filePath, source, oldText, newText)
		return false
	} catch (err) {
		console.error(`[design] AST text edit failed:`, err)
		return false
	}
}

async function fallbackTextReplace(filePath: string, source: string, oldText: string, newText: string): Promise<boolean> {
	const idx = source.indexOf(oldText)
	if (idx === -1) {
		console.warn(`[design] fallback: oldText not found in source: "${oldText.slice(0, 50)}"`)
		return false
	}
	if (source.indexOf(oldText, idx + 1) !== -1) {
		console.warn(`[design] fallback: oldText appears multiple times, refusing ambiguous replace: "${oldText.slice(0, 50)}"`)
		return false
	}
	const updated = source.slice(0, idx) + newText + source.slice(idx + oldText.length)
	await writeFileAtomic(filePath, updated)
	console.log(`[design] fallback: replaced text at offset ${idx}`)
	return true
}

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

const TAILWIND_COLOR_NAMES = new Set([
	"slate",
	"gray",
	"zinc",
	"neutral",
	"stone",
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
	"white",
	"black",
	"transparent",
	"inherit",
	"current",
])

function isTailwindColorClass(cls: string): boolean {
	return TAILWIND_COLOR_PREFIXES.some((prefix) => {
		if (!cls.startsWith(prefix)) return false
		const suffix = cls.slice(prefix.length)
		if (suffix.startsWith("[")) {
			const value = suffix.slice(1, -1)
			return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value) || /^hsla?\(/.test(value)
		}
		const parts = suffix.split("-")
		return TAILWIND_COLOR_NAMES.has(parts[0])
	})
}

function replaceTailwindColorClass(className: string, newHex: string): string | null {
	const classes = className.split(/\s+/)
	let replaced = false

	const result = classes.map((cls) => {
		if (!replaced && isTailwindColorClass(cls)) {
			const prefix = TAILWIND_COLOR_PREFIXES.find((p) => cls.startsWith(p))!
			replaced = true
			return `${prefix}[${newHex}]`
		}
		return cls
	})

	return replaced ? result.join(" ") : null
}

const COLOR_STYLE_PROPS = ["color", "backgroundColor", "borderColor", "outlineColor", "fill", "stroke"]

export async function editJSXColor(filePath: string, lineNumber: number, newColor: string, caretId?: string): Promise<boolean> {
	try {
		const source = await fs.readFile(filePath, "utf-8")
		const ast = parseSource(source)
		const element = caretId
			? findJSXElementByCaretId(ast, caretId) || findJSXElementAtLine(ast, lineNumber)
			: findJSXElementAtLine(ast, lineNumber)

		if (!element) {
			console.warn(`[design] AST: no JSX element found at ${filePath}:${lineNumber}`)
			return false
		}

		const attrs = element.openingElement.attributes || []

		for (const attr of attrs) {
			if (attr.type !== "JSXAttribute") continue
			const name = attr.name.type === "JSXIdentifier" ? attr.name.name : ""

			if (name === "className" && attr.value) {
				if (attr.value.type === "StringLiteral") {
					const replaced = replaceTailwindColorClass(attr.value.value, newColor)
					if (replaced) {
						attr.value.value = replaced
						await writeFileAtomic(filePath, recast.print(ast).code)
						return true
					}
				}
				if (attr.value.type === "JSXExpressionContainer") {
					const expr = attr.value.expression
					if (expr.type === "TemplateLiteral") {
						for (const quasi of expr.quasis) {
							const replaced = replaceTailwindColorClass(quasi.value.raw, newColor)
							if (replaced) {
								quasi.value.raw = replaced
								quasi.value.cooked = replaced
								await writeFileAtomic(filePath, recast.print(ast).code)
								return true
							}
						}
					}
				}
			}

			if (name === "style" && attr.value?.type === "JSXExpressionContainer") {
				const expr = attr.value.expression
				if (expr.type === "ObjectExpression") {
					if (replaceColorInObjectExpression(expr, newColor)) {
						await writeFileAtomic(filePath, recast.print(ast).code)
						return true
					}
				}
			}
		}

		if (replaceColorInStyleObject(ast, lineNumber, newColor)) {
			await writeFileAtomic(filePath, recast.print(ast).code)
			return true
		}

		console.warn(`[design] AST: no color value found to replace at ${filePath}:${lineNumber}`)
		return false
	} catch (err) {
		console.error(`[design] AST color edit failed:`, err)
		return false
	}
}

function replaceColorInObjectExpression(obj: recast.types.namedTypes.ObjectExpression, newColor: string): boolean {
	for (const prop of obj.properties) {
		if (prop.type !== "ObjectProperty" && prop.type !== "Property") continue
		const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : ""
		if (COLOR_STYLE_PROPS.includes(key) && (prop.value.type === "StringLiteral" || prop.value.type === "Literal")) {
			if (prop.value.type === "StringLiteral") {
				prop.value.value = newColor
			} else if ("value" in prop.value && typeof prop.value.value === "string") {
				prop.value.value = newColor
			}
			return true
		}
	}
	return false
}

function replaceColorInStyleObject(ast: ASTNode, lineNumber: number, newColor: string): boolean {
	let found = false
	recast.types.visit(ast, {
		visitObjectExpression(path) {
			const node = path.node
			const startLine = node.loc?.start.line || 0
			const endLine = node.loc?.end.line || 0
			if (startLine <= lineNumber + 5 && endLine >= lineNumber - 5) {
				if (replaceColorInObjectExpression(node, newColor)) {
					found = true
					return false
				}
			}
			return this.traverse(path)
		},
	})
	return found
}

export async function editJSXImageSrc(filePath: string, lineNumber: number, newSrc: string, caretId?: string): Promise<boolean> {
	try {
		const source = await fs.readFile(filePath, "utf-8")
		const ast = parseSource(source)
		const element = caretId
			? findJSXElementByCaretId(ast, caretId) || findJSXElementAtLine(ast, lineNumber, "img")
			: findJSXElementAtLine(ast, lineNumber, "img")

		if (!element) {
			console.warn(`[design] AST: no img element found at ${filePath}:${lineNumber}`)
			return false
		}

		const attrs = element.openingElement.attributes || []
		for (const attr of attrs) {
			if (attr.type !== "JSXAttribute") continue
			if (attr.name.type === "JSXIdentifier" && attr.name.name === "src") {
				if (attr.value?.type === "StringLiteral") {
					attr.value.value = newSrc
					await writeFileAtomic(filePath, recast.print(ast).code)
					return true
				}
			}
		}

		console.warn(`[design] AST: no src attribute found on img at ${filePath}:${lineNumber}`)
		return false
	} catch (err) {
		console.error(`[design] AST image edit failed:`, err)
		return false
	}
}

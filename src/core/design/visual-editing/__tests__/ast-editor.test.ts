import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"

import {
	editJSXColor,
	editJSXImageSrc,
	editJSXText,
	findJSXElementAtLine,
	findJSXElementByCaretId,
	parseSource,
} from "../ast-editor"

describe("findJSXElementByCaretId", () => {
	it("should find an element by data-caret-id", () => {
		const source = `<div><h1 data-caret-id="title" className="text-white">Hello</h1></div>`
		const ast = parseSource(source)
		const result = findJSXElementByCaretId(ast, "title")
		should(result).not.be.null()
		result?.openingElement.name.type.should.equal("JSXIdentifier")
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(result?.openingElement.name as any).name.should.equal("h1")
	})

	it("should find a nested element, not the parent", () => {
		const source = `<div data-caret-id="wrapper">
  <h1 data-caret-id="title">
    Text <span data-caret-id="subtitle">Sub</span>
  </h1>
</div>`
		const ast = parseSource(source)
		const result = findJSXElementByCaretId(ast, "subtitle")
		should(result).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(result?.openingElement.name as any).name.should.equal("span")
	})

	it("should find h1 when queried by h1 caret id (same-line siblings)", () => {
		const source = `<h1 data-caret-id="title" className="text-white">Text <span data-caret-id="accent" className="text-zinc-500">Sub</span></h1>`
		const ast = parseSource(source)

		const h1 = findJSXElementByCaretId(ast, "title")
		should(h1).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(h1?.openingElement.name as any).name.should.equal("h1")

		const span = findJSXElementByCaretId(ast, "accent")
		should(span).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(span?.openingElement.name as any).name.should.equal("span")
	})

	it("should return null when no match exists", () => {
		const source = `<div data-caret-id="wrapper"><p>Hello</p></div>`
		const ast = parseSource(source)
		const result = findJSXElementByCaretId(ast, "nonexistent")
		should(result).be.null()
	})

	it("should find a deeply nested element", () => {
		const source = `<div>
  <section>
    <div>
      <p data-caret-id="deep-text">Found me</p>
    </div>
  </section>
</div>`
		const ast = parseSource(source)
		const result = findJSXElementByCaretId(ast, "deep-text")
		should(result).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(result?.openingElement.name as any).name.should.equal("p")
	})
})

describe("findJSXElementAtLine", () => {
	it("should find an element at the exact line", () => {
		const source = `<div>
  <h1 className="text-white">Hello</h1>
</div>`
		const ast = parseSource(source)
		const result = findJSXElementAtLine(ast, 2)
		should(result).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(result?.openingElement.name as any).name.should.equal("h1")
	})

	it("should find nearest element with matching tagName when no exact line match", () => {
		const source = `<div>
  <h1>Title</h1>
  <p>Paragraph</p>
  <span>Text</span>
</div>`
		const ast = parseSource(source)
		const result = findJSXElementAtLine(ast, 5, "span")
		should(result).not.be.null()
		// biome-ignore lint/suspicious/noExplicitAny: recast AST node types
		;(result?.openingElement.name as any).name.should.equal("span")
	})

	it("should return null when no match exists", () => {
		const source = `<div><p>Hello</p></div>`
		const ast = parseSource(source)
		const result = findJSXElementAtLine(ast, 99)
		should(result).be.null()
	})
})

describe("editJSXText with caretId", () => {
	let tmpDir: string
	let tmpFile: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-editor-test-"))
		tmpFile = path.join(tmpDir, "test.tsx")
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("should edit text of the element matched by caretId", async () => {
		const source = `<div>
  <h1 data-caret-id="title">Old Title</h1>
  <span data-caret-id="sub">Old Sub</span>
</div>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXText(tmpFile, 1, "span", "New Sub", "Old Sub", "sub")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("New Sub")
		output.should.containEql("Old Title")
	})

	it("should fall back to line-based lookup when caretId is not provided", async () => {
		const source = `<div>
  <h1>Editable</h1>
</div>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXText(tmpFile, 2, "h1", "Changed")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("Changed")
	})
})

describe("editJSXColor with caretId", () => {
	let tmpDir: string
	let tmpFile: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-editor-test-"))
		tmpFile = path.join(tmpDir, "test.tsx")
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("should change color on the span, not the h1, when targeting span caretId", async () => {
		const source = `<h1 data-caret-id="title" className="text-white">Text <span data-caret-id="accent" className="text-zinc-500">Sub</span></h1>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXColor(tmpFile, 1, "#00ff00", "accent")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("text-[#00ff00]")
		output.should.containEql('className="text-white"')
	})

	it("should change color on h1 when targeting h1 caretId", async () => {
		const source = `<h1 data-caret-id="title" className="text-red-500">Hello</h1>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXColor(tmpFile, 1, "#0000ff", "title")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("text-[#0000ff]")
	})

	it("should replace an arbitrary hex color class like text-[#b9b1b1]", async () => {
		const source = `<span data-caret-id="accent" className="text-[#b9b1b1]">Bag</span>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXColor(tmpFile, 1, "#ff0000", "accent")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("text-[#ff0000]")
		output.should.not.containEql("#b9b1b1")
	})

	it("should replace a named Tailwind color class (regression check)", async () => {
		const source = `<span data-caret-id="label" className="text-zinc-500">Text</span>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXColor(tmpFile, 1, "#00ff00", "label")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql("text-[#00ff00]")
		output.should.not.containEql("text-zinc-500")
	})
})

describe("editJSXImageSrc with caretId", () => {
	let tmpDir: string
	let tmpFile: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-editor-test-"))
		tmpFile = path.join(tmpDir, "test.tsx")
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("should update the src of an img matched by caretId", async () => {
		const source = `<div>
  <img data-caret-id="hero-img" src="old.jpg" alt="Hero" />
  <img data-caret-id="thumb-img" src="thumb.jpg" alt="Thumb" />
</div>`
		await fs.writeFile(tmpFile, source)

		const result = await editJSXImageSrc(tmpFile, 1, "new.jpg", "hero-img")
		result.should.be.true()

		const output = await fs.readFile(tmpFile, "utf-8")
		output.should.containEql('src="new.jpg"')
		output.should.containEql('src="thumb.jpg"')
	})
})

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import "should"

import type { FoundationTokens } from "../../types"
import { spliceColorEdit, spliceParamEdit, spliceTextEdit } from "../edit"

const TOKENS: FoundationTokens = {
	vibe: { description: "", tags: [] },
	color: {
		brand: { seed: "#0b7aff", scale: { "500": "#0b7aff" } },
		neutral: { character: "cool", scale: {} },
		semantic: { success: "#16a34a", warning: "#f59e0b", error: "#dc2626", info: "#0ea5e9" },
	},
	typography: { fontFamily: "Inter", fallback: "sans-serif", scaleRatio: 1.25, baseSize: 16, scale: {} },
	spacing: { baseUnit: 4, scale: [] },
	radius: { character: "soft", scale: [0, 2, 4, 8, 12, 9999] },
}

describe("splice-backed editors", () => {
	let dir: string
	let file: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "splice-edit-"))
		file = path.join(dir, "index.tsx")
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("text: edits the span and PRESERVES all indentation across repeated edits", async () => {
		const original = `export default function P() {
  return (
    <div>
      <h1 data-caret-id="t" className="text-4xl">Welcome home</h1>
    </div>
  )
}
`
		await fs.writeFile(file, original)
		for (const next of ["First", "Second", "Third"]) {
			const outcome = await spliceTextEdit(file, "t", next, undefined)
			outcome.handled.should.be.true()
			outcome.ok.should.be.true()
		}
		;(await fs.readFile(file, "utf-8")).should.equal(original.replace("Welcome home", "Third"))
	})

	it("text: redelivery of the same edit is success without a write", async () => {
		await fs.writeFile(file, `<h1 data-caret-id="t">Done</h1>`)
		const outcome = await spliceTextEdit(file, "t", "Done", "Old")
		outcome.handled.should.be.true()
		outcome.ok.should.be.true()
		;(await fs.readFile(file, "utf-8")).should.equal(`<h1 data-caret-id="t">Done</h1>`)
	})

	it("text: falls through when there is no caret-id or the text is ambiguous", async () => {
		await fs.writeFile(file, `<h1 data-caret-id="t">One <b>x</b> Two</h1>`)
		const noId = await spliceTextEdit(file, undefined, "New")
		noId.handled.should.be.false()
		const ambiguous = await spliceTextEdit(file, "t", "New")
		ambiguous.handled.should.be.false()
	})

	it("colour: replaces the first colour family in place, keeping family and variant prefixes", async () => {
		await fs.writeFile(file, `<div data-caret-id="c" className="p-4 md:bg-brand-500 text-white">x</div>`)
		const outcome = await spliceColorEdit(file, "c", "#123456")
		outcome.handled.should.be.true()
		outcome.replacedClass?.should.equal("bg-brand-500")
		;(await fs.readFile(file, "utf-8")).should.containEql("md:bg-[#123456]")
		;(await fs.readFile(file, "utf-8")).should.containEql("text-white")
	})

	it("colour: writes the token class when binding", async () => {
		await fs.writeFile(file, `<div data-caret-id="c" className="bg-[#000000]">x</div>`)
		await spliceColorEdit(file, "c", "#0b7aff", "brand-500")
		;(await fs.readFile(file, "utf-8")).should.containEql(`className="bg-brand-500"`)
	})

	it("colour: appends or creates className when no colour class exists", async () => {
		await fs.writeFile(file, `<p data-caret-id="a" className="mt-2">x</p>\n`)
		await spliceColorEdit(file, "a", "#dc2626")
		;(await fs.readFile(file, "utf-8")).should.containEql(`className="mt-2 text-[#dc2626]"`)

		await fs.writeFile(file, `<p data-caret-id="b">x</p>`)
		await spliceColorEdit(file, "b", "#dc2626")
		;(await fs.readFile(file, "utf-8")).should.containEql(`<p data-caret-id="b" className="text-[#dc2626]">x</p>`)
	})

	it("colour: leaves dynamic classNames to the fallback", async () => {
		await fs.writeFile(file, `<div data-caret-id="d" className={cls}>x</div>`)
		const outcome = await spliceColorEdit(file, "d", "#fff")
		outcome.handled.should.be.false()
	})

	it("param: sets a property through the generalized path and refuses with reasons", async () => {
		await fs.writeFile(file, `<div data-caret-id="p" className="p-4">x</div>`)
		const ok = await spliceParamEdit(file, "p", "padding", { raw: "24px" }, 1440, TOKENS)
		ok.ok.should.be.true()
		;(await fs.readFile(file, "utf-8")).should.containEql(`className="p-[24px]"`)

		const missing = await spliceParamEdit(file, "nope", "padding", { raw: "1px" }, 1440, TOKENS)
		missing.ok.should.be.false()
		missing.refused?.should.containEql("caret-id")
	})
})

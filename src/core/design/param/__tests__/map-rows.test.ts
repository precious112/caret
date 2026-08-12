import "should"

import { resolveRowTextEdit } from "../map-rows"
import { applyEdits } from "../splice"

const LIST_PAGE = `const products = [
  { id: "a", name: "Monolith Trainer", price: 120 },
  { id: "b", name: "Aurora Slip-on", price: 95 },
  { id: "c", name: "Cinder Boot", price: 240 },
]

export default function Page() {
  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          <p data-caret-id="row-name">{product.name}</p>
          <span data-caret-id="row-price">{product.price}</span>
        </li>
      ))}
    </ul>
  )
}
`

describe("resolveRowTextEdit — content edits reach one row's data", () => {
	it("edits the named field of exactly the addressed row", () => {
		const result = resolveRowTextEdit(LIST_PAGE, "row-name", 1, "Aurora Loafer", "Aurora Slip-on")
		result.kind.should.equal("edit")
		if (result.kind !== "edit") return
		result.itemLabel.should.equal("item 2 · name")
		const next = applyEdits(LIST_PAGE, result.edits)
		next.should.containEql('"Aurora Loafer"')
		next.should.containEql('"Monolith Trainer"')
		next.should.containEql('"Cinder Boot"')
	})

	it("writes numbers as numbers and refuses non-numeric input for them", () => {
		const ok = resolveRowTextEdit(LIST_PAGE, "row-price", 2, "199")
		ok.kind.should.equal("edit")
		if (ok.kind === "edit") applyEdits(LIST_PAGE, ok.edits).should.containEql("price: 199")

		const bad = resolveRowTextEdit(LIST_PAGE, "row-price", 2, "not a number")
		bad.kind.should.equal("refusal")
		if (bad.kind === "refusal") bad.reason.should.containEql("numeric")
	})

	it("redelivery of the same value is success without a write", () => {
		const result = resolveRowTextEdit(LIST_PAGE, "row-name", 0, "Monolith Trainer")
		result.kind.should.equal("edit")
		if (result.kind === "edit") result.edits.length.should.equal(0)
	})

	it("refuses a stale oldText instead of writing over changed data", () => {
		const result = resolveRowTextEdit(LIST_PAGE, "row-name", 0, "New", "Some Stale Rendered Text")
		result.kind.should.equal("refusal")
	})

	it("works over an inline array literal too (shape 2)", () => {
		const source = `export default function P() {
  return <div>{[{ label: "One" }, { label: "Two" }].map((item) => <p data-caret-id="t">{item.label}</p>)}</div>
}
`
		const result = resolveRowTextEdit(source, "t", 1, "Deux", "Two")
		result.kind.should.equal("edit")
		if (result.kind === "edit") applyEdits(source, result.edits).should.containEql('"Deux"')
	})

	it("refuses shape 3 — data from props or elsewhere — naming the cause", () => {
		const source = `export default function P({ items }) {
  return <div>{items.map((item) => <p data-caret-id="t">{item.label}</p>)}</div>
}
`
		const result = resolveRowTextEdit(source, "t", 0, "New")
		result.kind.should.equal("refusal")
		if (result.kind === "refusal") result.reason.should.containEql("elsewhere")
	})

	it("refuses computed text and multi-field elements with distinct reasons", () => {
		const computed = `const xs = [{ p: 1 }]
export default function P() {
  return <div>{xs.map((x) => <p data-caret-id="c">{format(x.p)}</p>)}</div>
}
`
		const r1 = resolveRowTextEdit(computed, "c", 0, "New")
		r1.kind.should.equal("refusal")
		if (r1.kind === "refusal") r1.reason.should.containEql("computed")

		const multi = `const xs = [{ a: "x", b: "y" }]
export default function P() {
  return <div>{xs.map((x) => <p data-caret-id="m">{x.a}{x.b}</p>)}</div>
}
`
		const r2 = resolveRowTextEdit(multi, "m", 0, "New")
		r2.kind.should.equal("refusal")
		if (r2.kind === "refusal") r2.reason.should.containEql("several data fields")
	})

	it("is unhandled for elements outside any iterator", () => {
		const source = `export default function P() { return <p data-caret-id="s">Static</p> }`
		resolveRowTextEdit(source, "s", 0, "New").kind.should.equal("unhandled")
	})
})

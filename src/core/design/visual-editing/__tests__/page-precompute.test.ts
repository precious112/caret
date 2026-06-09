import { describe, it } from "mocha"
import "should"

import type { DynamicRange } from "../page-precompute"
import { precomputePage } from "../page-precompute"

function hasRange(ranges: DynamicRange[], diagnostic: string): boolean {
	return ranges.some((r) => r.diagnostics.includes(diagnostic as any))
}

function rangeAt(ranges: DynamicRange[], line: number): DynamicRange | undefined {
	return ranges.find((r) => r.startLine === line)
}

describe("precomputePage — caret-id injection", () => {
	it("should add data-caret-id to visible elements missing it", () => {
		const source = `export default function Page() {
  return (
    <div>
      <h1 className="text-white">Hello</h1>
      <p>World</p>
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("data-caret-id=")
		result.correctedSource!.should.containEql('data-caret-id="h1-1"')
		result.correctedSource!.should.containEql('data-caret-id="p-1"')
	})

	it("should not add data-caret-id to elements that already have it", () => {
		const source = `export default function Page() {
  return <h1 data-caret-id="title">Hello</h1>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.false()
		const count = (source.match(/data-caret-id/g) || []).length
		count.should.equal(1)
	})

	it("should not add data-caret-id to custom (capitalized) components", () => {
		const source = `export default function Page() {
  return <MyComponent>Hello</MyComponent>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.false()
	})

	it("should not add data-caret-id to non-visible native elements like div", () => {
		const source = `export default function Page() {
  return <div className="flex">Content</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.false()
	})

	it("should derive descriptive ID from alt attribute", () => {
		const source = `export default function Page() {
  return <img src="photo.jpg" alt="Hero Banner" />
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("hero-banner")
	})

	it("should derive descriptive ID from placeholder attribute", () => {
		const source = `export default function Page() {
  return <input placeholder="Search products" />
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("search-products")
	})
})

describe("precomputePage — inline style conversion", () => {
	it("should convert inline style to Tailwind arbitrary classes", () => {
		const source = `export default function Page() {
  return <div style={{ backgroundColor: "#ff0000", padding: "16px" }}>Box</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("bg-[#ff0000]")
		result.correctedSource!.should.containEql("p-[16px]")
		result.correctedSource!.should.not.containEql("style=")
	})

	it("should merge converted classes into existing className", () => {
		const source = `export default function Page() {
  return <div className="flex" style={{ margin: "8px" }}>Box</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("flex m-[8px]")
	})

	it("should keep style attribute if some properties can't be converted", () => {
		const source = `export default function Page() {
  return <div style={{ backgroundColor: "#ff0000", transform: "rotate(45deg)" }}>Box</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("bg-[#ff0000]")
		result.correctedSource!.should.containEql("style=")
	})

	it("should convert numeric values", () => {
		const source = `export default function Page() {
  return <div style={{ zIndex: 10, opacity: 0.5 }}>Box</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("z-[10]")
		result.correctedSource!.should.containEql("opacity-[0.5]")
	})

	it("should still convert inline styles inside .map()", () => {
		const source = `export default function Page() {
  return (
    <div>
      {items.map(item => (
        <p style={{ color: "red" }}>{item.name}</p>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("text-[red]")
	})
})

describe("precomputePage — .map() iterator handling", () => {
	it("should NOT add data-caret-id inside .map()", () => {
		const source = `export default function Page() {
  return (
    <div>
      {items.map(item => (
        <h3>{item.name}</h3>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		if (result.correctedSource) {
			result.correctedSource.should.not.containEql("data-caret-id")
		}
	})

	it("should mark all elements inside .map() as dynamic", () => {
		const source = `export default function Page() {
  return (
    <div>
      {items.map(item => (
        <h3>{item.name}</h3>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.be.greaterThan(0)
	})

	it("should mark static text inside .map() as dynamic too", () => {
		const source = `export default function Page() {
  return (
    <div>
      {items.map(item => (
        <div>
          <p>View details</p>
          <img src={item.img} />
        </div>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.be.greaterThan(0)
	})

	it("should handle .forEach() the same as .map()", () => {
		const source = `export default function Page() {
  const els = []
  items.forEach(item => {
    els.push(<span>{item.label}</span>)
  })
  return <div>{els}</div>
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.be.greaterThan(0)
	})

	it("should handle .flatMap() the same as .map()", () => {
		const source = `export default function Page() {
  return (
    <div>
      {items.flatMap(item => (
        <p>{item.text}</p>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.be.greaterThan(0)
	})

	it("should still add data-caret-id to static elements outside .map()", () => {
		const source = `export default function Page() {
  return (
    <div>
      <h1>Static Title</h1>
      {items.map(item => (
        <p>{item.text}</p>
      ))}
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql('data-caret-id="h1-1"')
	})
})

describe("precomputePage — dynamic content detection (outside iterators)", () => {
	it("should detect dynamic text children", () => {
		const source = `export default function Page() {
  return <h1 data-caret-id="title">{title}</h1>
}`
		const result = precomputePage(source, "test.tsx")
		hasRange(result.dynamicRanges, "dynamic-text").should.be.true()
	})

	it("should detect dynamic image src", () => {
		const source = `export default function Page() {
  return <img data-caret-id="hero" src={imageUrl} alt="Hero" />
}`
		const result = precomputePage(source, "test.tsx")
		hasRange(result.dynamicRanges, "dynamic-image-src").should.be.true()
	})

	it("should detect dynamic Tailwind class names", () => {
		const source = "export default function Page() {\n  return <div className={`bg-${color}-500 p-4`}>Box</div>\n}"
		const result = precomputePage(source, "test.tsx")
		hasRange(result.dynamicRanges, "dynamic-tailwind-class").should.be.true()
	})

	it("should NOT flag static text as dynamic", () => {
		const source = `export default function Page() {
  return <h1 data-caret-id="title">Static Title</h1>
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.equal(0)
	})

	it("should NOT flag static image src as dynamic", () => {
		const source = `export default function Page() {
  return <img data-caret-id="hero" src="photo.jpg" alt="Hero" />
}`
		const result = precomputePage(source, "test.tsx")
		hasRange(result.dynamicRanges, "dynamic-image-src").should.be.false()
	})

	it("should detect string expression container as non-dynamic", () => {
		const source = `export default function Page() {
  return <h1 data-caret-id="title">{"Static"}</h1>
}`
		const result = precomputePage(source, "test.tsx")
		result.dynamicRanges.length.should.equal(0)
	})
})

describe("precomputePage — combined scenarios", () => {
	it("should handle element with both inline style AND dynamic text", () => {
		const source = `export default function Page() {
  return <h1 style={{ color: "red" }}>{title}</h1>
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql("text-[red]")
		hasRange(result.dynamicRanges, "dynamic-text").should.be.true()
	})

	it("should handle multiple visible elements with different issues", () => {
		const source = `export default function Page() {
  return (
    <div>
      <h1>Static Title</h1>
      <p>{dynamicText}</p>
      <img src={imgUrl} alt="Photo" />
      <span style={{ color: "blue" }}>Styled</span>
    </div>
  )
}`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.true()
		result.correctedSource!.should.containEql('data-caret-id="h1-1"')
		result.correctedSource!.should.containEql("text-[blue]")
		hasRange(result.dynamicRanges, "dynamic-text").should.be.true()
		hasRange(result.dynamicRanges, "dynamic-image-src").should.be.true()
	})

	it("should be idempotent — second pass produces no changes", () => {
		const source = `export default function Page() {
  return (
    <div>
      <h1>Title</h1>
      <p>{dynamic}</p>
    </div>
  )
}`
		const first = precomputePage(source, "test.tsx")
		first.modified.should.be.true()

		const second = precomputePage(first.correctedSource!, "test.tsx")
		second.modified.should.be.false()
	})

	it("should return correct result for parse failure", () => {
		const source = `<<<<this is not valid JSX>>>>`
		const result = precomputePage(source, "test.tsx")
		result.modified.should.be.false()
		result.dynamicRanges.length.should.equal(0)
	})
})

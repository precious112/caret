import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import should from "should"

import {
	applyVariantChoice,
	createVariantSet,
	discardVariantSet,
	readVariantSet,
	registerExternalVariants,
	updateVariantStatus,
	VARIANT_COUNT,
} from "../variants"

const PAGE = `export default function Home() { return <h1>Original</h1> }`

describe("generate-and-pick variants", () => {
	let workspace: string
	let pagesDir: string

	beforeEach(async () => {
		workspace = await fs.mkdtemp(path.join(os.tmpdir(), "variants-"))
		pagesDir = path.join(workspace, ".caret", "pages")
		await fs.mkdir(path.join(pagesDir, "home"), { recursive: true })
		await fs.writeFile(path.join(pagesDir, "home", "index.tsx"), PAGE)
		await fs.writeFile(
			path.join(pagesDir, "home", "meta.json"),
			JSON.stringify({ id: "home", title: "Home", type: "page", states: [], tags: ["landing"] }),
		)
	})

	afterEach(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	it("copies the page N times with variant metas, and refuses a second concurrent set", async () => {
		const set = await createVariantSet(workspace, "home", "make it feel premium")
		set.variants.should.have.length(VARIANT_COUNT)

		for (const [i, variant] of set.variants.entries()) {
			variant.status.should.equal("working")
			const source = await fs.readFile(path.join(pagesDir, variant.id, "index.tsx"), "utf-8")
			source.should.equal(PAGE)
			const meta = JSON.parse(await fs.readFile(path.join(pagesDir, variant.id, "meta.json"), "utf-8"))
			meta.variantOf.should.equal("home")
			meta.id.should.equal(variant.id)
			meta.title.should.containEql(`take ${i + 1}`)
		}

		await createVariantSet(workspace, "home", "again").should.be.rejectedWith(/already open/)
	})

	it("applying a take replaces the original's source, keeps its meta identity, and cleans everything up", async () => {
		const set = await createVariantSet(workspace, "home", "bolder")
		const chosen = set.variants[1]
		await fs.writeFile(
			path.join(pagesDir, chosen.id, "index.tsx"),
			`export default function Home() { return <h1>Take two</h1> }`,
		)
		await updateVariantStatus(workspace, chosen.id, "ready")

		await applyVariantChoice(workspace, chosen.id)

		const source = await fs.readFile(path.join(pagesDir, "home", "index.tsx"), "utf-8")
		source.should.containEql("Take two")
		const meta = JSON.parse(await fs.readFile(path.join(pagesDir, "home", "meta.json"), "utf-8"))
		meta.id.should.equal("home")
		meta.title.should.equal("Home")
		should(meta.variantOf).be.undefined()

		for (const variant of set.variants) {
			await fs
				.access(path.join(pagesDir, variant.id))
				.then(() => {
					throw new Error(`${variant.id} should have been removed`)
				})
				.catch(() => {})
		}
		should(await readVariantSet(workspace)).be.null()
	})

	it("discard removes every take and the scratch, leaving the original untouched", async () => {
		const set = await createVariantSet(workspace, "home", "anything")
		await discardVariantSet(workspace)

		;(await fs.readFile(path.join(pagesDir, "home", "index.tsx"), "utf-8")).should.equal(PAGE)
		should(await readVariantSet(workspace)).be.null()
		const remaining = await fs.readdir(pagesDir)
		remaining.should.eql(["home"])
		set.variants.should.have.length(VARIANT_COUNT)
	})

	it("registers external takes only when every named page actually exists", async () => {
		await fs.mkdir(path.join(pagesDir, "home--v1"), { recursive: true })
		await fs.writeFile(path.join(pagesDir, "home--v1", "index.tsx"), PAGE)

		await registerExternalVariants(workspace, "home", ["home--v1", "home--v2"], "explore").should.be.rejected()

		await fs.mkdir(path.join(pagesDir, "home--v2"), { recursive: true })
		await fs.writeFile(path.join(pagesDir, "home--v2", "index.tsx"), PAGE)
		const set = await registerExternalVariants(workspace, "home", ["home--v1", "home--v2"], "explore")
		set.source.should.equal("external")
		set.variants.every((v) => v.status === "ready").should.be.true()
	})

	it("records take failures without disturbing the others", async () => {
		const set = await createVariantSet(workspace, "home", "x")
		await updateVariantStatus(workspace, set.variants[0].id, "failed", "model refused")
		await updateVariantStatus(workspace, set.variants[1].id, "ready")

		const stored = await readVariantSet(workspace)
		stored?.variants[0].status.should.equal("failed")
		stored?.variants[0].error?.should.equal("model refused")
		stored?.variants[1].status.should.equal("ready")
		stored?.variants[2].status.should.equal("working")
	})
})

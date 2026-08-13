import { execFileSync } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import "should"

import { captureUndoStep, listUndoSteps, undoLastStep } from "../design-undo"

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" })
}

describe("design undo — one stack for every design-layer actor", () => {
	let dir: string
	let pagePath: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "design-undo-"))
		git(dir, "init", "-q")
		git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root")
		await fs.mkdir(path.join(dir, ".caret", "pages", "home"), { recursive: true })
		pagePath = path.join(dir, ".caret", "pages", "home", "index.tsx")
		await fs.writeFile(pagePath, `<h1 data-caret-id="t">Original</h1>\n`)
	})
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("undoes the last edit, restoring exactly the changed file", async () => {
		await captureUndoStep(dir, "text edit on t")
		await fs.writeFile(pagePath, `<h1 data-caret-id="t">Changed</h1>\n`)

		const result = await undoLastStep(dir)
		result.undone.should.be.true()
		result.label?.should.equal("text edit on t")
		result.changed.should.containEql(".caret/pages/home/index.tsx")
		;(await fs.readFile(pagePath, "utf-8")).should.containEql("Original")
	})

	it("an undo is itself undoable — redo through the same stack", async () => {
		await captureUndoStep(dir, "text edit on t")
		await fs.writeFile(pagePath, `<h1 data-caret-id="t">Changed</h1>\n`)

		;(await undoLastStep(dir)).undone.should.be.true()
		;(await fs.readFile(pagePath, "utf-8")).should.containEql("Original")

		const redo = await undoLastStep(dir)
		redo.undone.should.be.true()
		redo.label?.should.containEql('undo of "text edit on t"')
		;(await fs.readFile(pagePath, "utf-8")).should.containEql("Changed")
	})

	it("removes files the step's edit created", async () => {
		await captureUndoStep(dir, "agent turn: add an about page", "agent")
		const created = path.join(dir, ".caret", "pages", "about")
		await fs.mkdir(created, { recursive: true })
		await fs.writeFile(path.join(created, "index.tsx"), "<p>About</p>\n")

		const result = await undoLastStep(dir)
		result.undone.should.be.true()
		const gone = await fs
			.access(path.join(created, "index.tsx"))
			.then(() => false)
			.catch(() => true)
		gone.should.be.true()
	})

	it("coalesces no-op boundaries instead of stuttering the stack", async () => {
		await captureUndoStep(dir, "first")
		await captureUndoStep(dir, "second (nothing changed since first)")
		const steps = await listUndoSteps(dir)
		steps.length.should.equal(1)
		steps[0].label.should.equal("first")
	})

	it("pops a step whose edit never landed, and says nothing was undone", async () => {
		await captureUndoStep(dir, "an edit that then failed")
		const result = await undoLastStep(dir)
		result.undone.should.be.false()
		result.error?.should.containEql("Nothing to undo")
		;(await listUndoSteps(dir)).length.should.equal(0)
	})

	it("outside a git repo, capture is a no-op and undo refuses honestly", async () => {
		const bare = await fs.mkdtemp(path.join(os.tmpdir(), "design-undo-nogit-"))
		try {
			await fs.mkdir(path.join(bare, ".caret"), { recursive: true })
			await captureUndoStep(bare, "hopeful")
			const result = await undoLastStep(bare)
			result.undone.should.be.false()
		} finally {
			await fs.rm(bare, { recursive: true, force: true })
		}
	})

	it("works when .caret/.gitignore ignores the journal — the shape every scaffolded project has", async () => {
		// Regression: the capture used to name the journal as an :(exclude)
		// pathspec, and git REFUSES a pathspec that names a gitignored file —
		// so in every real project (where scaffold gitignores the journal)
		// capture failed and undo reported "could not read the design layer".
		await fs.writeFile(path.join(dir, ".caret", ".gitignore"), ".undo-journal.json\nnode_modules/\n")
		await captureUndoStep(dir, "text edit on t")
		await fs.writeFile(pagePath, `<h1 data-caret-id="t">Changed</h1>\n`)

		const result = await undoLastStep(dir)
		result.undone.should.be.true()
		;(await fs.readFile(pagePath, "utf-8")).should.containEql("Original")
	})

	it("never touches app files outside .caret/", async () => {
		const appFile = path.join(dir, "src-app.txt")
		await fs.writeFile(appFile, "app v1")
		await captureUndoStep(dir, "design edit")
		await fs.writeFile(pagePath, `<h1 data-caret-id="t">Changed</h1>\n`)
		await fs.writeFile(appFile, "app v2 — must survive the undo")

		const result = await undoLastStep(dir)
		result.undone.should.be.true()
		;(await fs.readFile(appFile, "utf-8")).should.equal("app v2 — must survive the undo")
	})
})

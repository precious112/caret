import { expect } from "chai"
import { parseDesignChangedFiles } from "@/utils/git"
import { buildSyncPrompt } from "../sync-prompt"

describe("parseDesignChangedFiles", () => {
	it("parses name-status lines into path + status, mapping status codes", () => {
		const raw = ["M\t.caret/pages/landing/index.tsx", "A\t.caret/components/Nav.tsx", "D\t.caret/pages/old/index.tsx"].join(
			"\n",
		)
		const files = parseDesignChangedFiles(raw)
		expect(files).to.deep.equal([
			{ path: ".caret/pages/landing/index.tsx", status: "modified" },
			{ path: ".caret/components/Nav.tsx", status: "added" },
			{ path: ".caret/pages/old/index.tsx", status: "deleted" },
		])
	})

	it("drops binary image assets but keeps non-binary asset files", () => {
		const raw = [
			"A\t.caret/assets/Screenshot_2026-06-09.png",
			"M\t.caret/assets/photo.JPG",
			"A\t.caret/assets/icon.svg",
			"M\t.caret/pages/home/index.tsx",
		].join("\n")
		const files = parseDesignChangedFiles(raw)
		const paths = files.map((f) => f.path)
		expect(paths).to.not.include(".caret/assets/Screenshot_2026-06-09.png")
		expect(paths).to.not.include(".caret/assets/photo.JPG")
		expect(paths).to.include(".caret/assets/icon.svg")
		expect(paths).to.include(".caret/pages/home/index.tsx")
	})

	it("uses the new path for renames (last tab-separated field)", () => {
		const raw = "R100\t.caret/pages/a/index.tsx\t.caret/pages/b/index.tsx"
		const files = parseDesignChangedFiles(raw)
		expect(files).to.deep.equal([{ path: ".caret/pages/b/index.tsx", status: "renamed" }])
	})

	it("ignores blank lines and empty input", () => {
		expect(parseDesignChangedFiles("")).to.deep.equal([])
		expect(parseDesignChangedFiles("\n\n")).to.deep.equal([])
	})
})

describe("buildSyncPrompt", () => {
	// A cwd with no .caret/ — buildInventory degrades gracefully to "(none)".
	const cwd = "/tmp/does-not-exist-caret-sync-test"

	it("contains no inlined file/diff content and instructs reading the current source", async () => {
		const prompt = await buildSyncPrompt(cwd, {
			syncId: "test-sync",
			changedFiles: [{ path: ".caret/pages/landing/index.tsx", status: "modified" }],
			isFirstSync: false,
		})
		expect(prompt).to.include("SINGLE SOURCE OF TRUTH")
		expect(prompt).to.include("READ the current .caret/ source")
		// Instructs stripping caret-ids (editor metadata) from app code.
		expect(prompt).to.include("data-caret-id")
		expect(prompt).to.include("do NOT copy them into the application code")
		// No diff hunks.
		expect(prompt).to.not.include("@@")
		expect(prompt).to.not.include("diff --git")
	})

	it("renders a grouped worklist: pages by id, shared design separately", async () => {
		const prompt = await buildSyncPrompt(cwd, {
			syncId: "test-sync",
			changedFiles: [
				{ path: ".caret/pages/landing/index.tsx", status: "modified" },
				{ path: ".caret/pages/landing/meta.json", status: "modified" },
				{ path: ".caret/components/Nav.tsx", status: "added" },
				{ path: ".caret/tokens/foundation.json", status: "modified" },
			],
			isFirstSync: false,
		})
		expect(prompt).to.include("Pages")
		// Page collapses both its files into one id entry.
		expect(prompt).to.include(" - landing (modified)")
		expect(prompt).to.include("Shared design")
		expect(prompt).to.include(" - .caret/components/Nav.tsx (added)")
		expect(prompt).to.include(" - .caret/tokens/foundation.json (modified)")
	})

	it("marks the intent log as context-only when provided", async () => {
		const prompt = await buildSyncPrompt(cwd, {
			syncId: "test-sync",
			changedFiles: [{ path: ".caret/pages/home/index.tsx", status: "modified" }],
			isFirstSync: false,
			intentLog: "abc123 redesign hero\ndef456 revert hero",
		})
		expect(prompt).to.include("context only")
		expect(prompt).to.include("abc123 redesign hero")
	})

	it("handles an empty worklist (first sync) by telling the AI to reconcile the full design", async () => {
		const prompt = await buildSyncPrompt(cwd, { syncId: "test-sync", changedFiles: [], isFirstSync: true })
		expect(prompt).to.include("first sync")
		expect(prompt).to.include("ENTIRE current design layer")
	})
})

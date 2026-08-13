/**
 * Unified undo for the design layer — Phase 8.7.
 *
 * One stack for every actor that writes `.caret/`: an inline splice, a panel
 * param edit, a bulk edit, an agent edit-lane turn. Each undoable boundary
 * captures the design layer as a REAL COMMIT OBJECT (the sync-snapshot
 * technique with the inverse pathspec: only `.caret/`, never app code), so a
 * step survives process restarts and git gc, and restore is scoped to exactly
 * the paths the step changed — the same restraint "Undo sync" has.
 *
 * The stack is a bounded journal beside the refs. Undo pops the last step,
 * captures the pre-undo state first (so an undo is itself undoable), diffs,
 * and writes back only what differs. No worktree-wide checkout, no touching
 * the user's index or HEAD, no app files.
 */
import { execFile } from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { promisify } from "util"

import { Logger } from "@/shared/services/Logger"

import { runExclusive } from "../file-mutation-queue"
import { parseNameStatusZ } from "../sync/sync-snapshot"

const exec = promisify(execFile)

/** Undo history depth. Beyond this, the oldest step's ref is dropped. */
const MAX_STEPS = 50

/** Journal beside the design layer, never inside a snapshot of it. */
const JOURNAL_FILE = ".undo-journal.json"

const ONLY_CARET = ".caret/"
const EXCLUDE_JOURNAL = `:(exclude).caret/${JOURNAL_FILE}`

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
	const { stdout } = await exec("git", args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		maxBuffer: 1024 * 1024 * 50,
	})
	return stdout
}

export interface UndoStep {
	/** Monotonic sequence, also the ref suffix (refs/caret/undo/<seq>). */
	seq: number
	/** Human label: "text edit on hero-subtitle", "agent turn: make it warmer". */
	label: string
	/** The actor that made the change this step precedes. */
	actor: "inline" | "agent" | "undo"
	commit: string
	at: string
}

interface Journal {
	steps: UndoStep[]
	nextSeq: number
}

function journalPath(cwd: string): string {
	return path.join(cwd, ".caret", JOURNAL_FILE)
}

async function readJournal(cwd: string): Promise<Journal> {
	try {
		const parsed = JSON.parse(await fs.readFile(journalPath(cwd), "utf-8"))
		if (Array.isArray(parsed.steps) && typeof parsed.nextSeq === "number") return parsed
	} catch {
		// Missing or corrupt journal: start clean. The refs of any orphaned
		// steps are unreachable from here and will simply age out.
	}
	return { steps: [], nextSeq: 1 }
}

async function writeJournal(cwd: string, journal: Journal): Promise<void> {
	await fs.writeFile(journalPath(cwd), JSON.stringify(journal, null, 2))
}

/** The last capture failure, verbatim — surfaced in undo results so a broken
 * environment names itself instead of hiding behind a generic message. */
let lastCaptureError = ""

/** The design layer as a tree-ish, via a throwaway index. */
async function captureCaretTree(cwd: string): Promise<string | null> {
	const tmpIndex = path.join(os.tmpdir(), `caret-undo-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
	try {
		const env = { GIT_INDEX_FILE: tmpIndex }
		// The journal must NOT be named in the add pathspec, not even as an
		// exclude: a pathspec that names a gitignored file makes `git add`
		// refuse outright ("use -f"), which broke capture in every scaffolded
		// project (they gitignore the journal). Stage everything, then drop the
		// journal from the throwaway index — rm --cached has no such rule.
		await git(cwd, ["add", "-A", "--", ONLY_CARET], env)
		await git(cwd, ["rm", "--cached", "-q", "--ignore-unmatch", `.caret/${JOURNAL_FILE}`], env).catch(() => {})
		return (await git(cwd, ["write-tree"], env)).trim()
	} catch (err) {
		lastCaptureError = err instanceof Error ? err.message : String(err)
		Logger.warn(`[design-undo] could not capture the design layer: ${err}`)
		return null
	} finally {
		await fs.rm(tmpIndex, { force: true }).catch(() => {})
	}
}

/**
 * Captures the design layer BEFORE a change, as one undoable step.
 * Best-effort by design: a workspace that is not a git repo (or has no HEAD)
 * gets no undo, and the edit proceeds — undo is a convenience, never a gate.
 */
export async function captureUndoStep(cwd: string, label: string, actor: UndoStep["actor"] = "inline"): Promise<void> {
	await runExclusive(`undo-journal:${cwd}`, async () => {
		const tree = await captureCaretTree(cwd)
		if (!tree) return

		const journal = await readJournal(cwd)

		// Coalesce no-op boundaries: if nothing changed since the last step's
		// snapshot, a new step would make undo a frustrating stutter.
		const last = journal.steps[journal.steps.length - 1]
		if (last) {
			try {
				const lastTree = (await git(cwd, ["rev-parse", `${last.commit}^{tree}`])).trim()
				if (lastTree === tree) return
			} catch {
				// The last step's commit is gone (gc, clone) — proceed.
			}
		}

		let commit: string
		try {
			commit = (await git(cwd, ["commit-tree", tree, "-m", `caret undo step: ${label}`])).trim()
			await git(cwd, ["update-ref", `refs/caret/undo/${journal.nextSeq}`, commit])
		} catch (err) {
			Logger.warn(`[design-undo] could not write the step commit: ${err}`)
			return
		}

		journal.steps.push({ seq: journal.nextSeq, label, actor, commit, at: new Date().toISOString() })
		journal.nextSeq++

		while (journal.steps.length > MAX_STEPS) {
			const dropped = journal.steps.shift()
			if (dropped) await git(cwd, ["update-ref", "-d", `refs/caret/undo/${dropped.seq}`]).catch(() => {})
		}
		await writeJournal(cwd, journal)
	})
}

export interface UndoResult {
	undone: boolean
	label?: string
	/** Design-layer paths written back or removed. */
	changed: string[]
	error?: string
}

/**
 * Restores the design layer to the most recent step and pops it. The pre-undo
 * state is captured as its own step first, so undo is re-undoable (redo is an
 * undo of the undo).
 */
export async function undoLastStep(cwd: string): Promise<UndoResult> {
	return runExclusive(`undo-journal:${cwd}`, async () => {
		const result: UndoResult = { undone: false, changed: [] }

		const journal = await readJournal(cwd)
		const step = journal.steps[journal.steps.length - 1]
		if (!step) {
			result.error = "Nothing to undo."
			return result
		}

		const now = await captureCaretTree(cwd)
		if (!now) {
			result.error = `Could not read the design layer: ${lastCaptureError || "unknown"}`
			return result
		}

		let raw: string
		try {
			raw = await git(cwd, [
				"--no-pager",
				"diff",
				"--name-status",
				"-z",
				step.commit,
				now,
				"--",
				ONLY_CARET,
				EXCLUDE_JOURNAL,
			])
		} catch (err) {
			result.error = `Could not compare against the undo step: ${err}`
			return result
		}

		const changes = parseNameStatusZ(raw)
		if (changes.length === 0) {
			// The step is a no-op from here (e.g. the edit it preceded failed).
			// Pop it and report honestly rather than pretending a restore.
			journal.steps.pop()
			await git(cwd, ["update-ref", "-d", `refs/caret/undo/${step.seq}`]).catch(() => {})
			await writeJournal(cwd, journal)
			result.error = "Nothing to undo."
			return result
		}

		// The pre-undo state becomes a step of its own: undoing an undo redoes.
		let redoCommit: string | null = null
		try {
			redoCommit = (await git(cwd, ["commit-tree", now, "-m", `caret undo step: before undo of "${step.label}"`])).trim()
		} catch {
			redoCommit = null
		}

		for (const change of changes) {
			try {
				if (change.status === "A") {
					await fs.rm(path.join(cwd, change.path), { force: true })
					result.changed.push(change.path)
				} else if (change.status === "R" && change.oldPath) {
					await fs.rm(path.join(cwd, change.path), { force: true })
					result.changed.push(change.path)
					await git(cwd, ["checkout", step.commit, "--", change.oldPath])
					result.changed.push(change.oldPath)
				} else {
					await git(cwd, ["checkout", step.commit, "--", change.path])
					result.changed.push(change.path)
				}
			} catch (err) {
				Logger.error(`[design-undo] could not restore ${change.path}:`, err)
			}
		}

		journal.steps.pop()
		await git(cwd, ["update-ref", "-d", `refs/caret/undo/${step.seq}`]).catch(() => {})
		if (redoCommit) {
			journal.steps.push({
				seq: journal.nextSeq,
				label: `undo of "${step.label}"`,
				actor: "undo",
				commit: redoCommit,
				at: new Date().toISOString(),
			})
			await git(cwd, ["update-ref", `refs/caret/undo/${journal.nextSeq}`, redoCommit]).catch(() => {})
			journal.nextSeq++
		}
		await writeJournal(cwd, journal)

		result.undone = true
		result.label = step.label
		Logger.info(`[design-undo] restored ${result.changed.length} path(s) for "${step.label}"`)
		return result
	})
}

/** The visible history, most recent last. */
export async function listUndoSteps(cwd: string): Promise<UndoStep[]> {
	return (await readJournal(cwd)).steps
}

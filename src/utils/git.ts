import { exec } from "child_process"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execAsync = promisify(exec)
const GIT_OUTPUT_LINE_LIMIT = 500

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

async function checkGitRepo(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse --git-dir", { cwd })
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitInstalled(): Promise<boolean> {
	try {
		await execAsync("git --version")
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitRepoHasCommits(cwd: string): Promise<boolean> {
	try {
		await execAsync("git rev-parse HEAD", { cwd })
		return true
	} catch (_error) {
		return false
	}
}

export async function searchCommits(query: string, cwd: string): Promise<GitCommit[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			Logger.error("Git is not installed")
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			Logger.error("Not a git repository")
			return []
		}

		// Check if repo has any commits
		if (!(await checkGitRepoHasCommits(cwd))) {
			// No commits yet in the repository
			return []
		}

		// Search commits by hash or message, limiting to 10 results
		const { stdout } = await execAsync(
			`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--grep="${query}" --regexp-ignore-case`,
			{ cwd },
		)

		let output = stdout
		if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
			// If no results from grep search and query looks like a hash, try searching by hash
			const { stdout: hashStdout } = await execAsync(
				`git log -n 10 --format="%H%n%h%n%s%n%an%n%ad" --date=short ` + `--author-date-order ${query}`,
				{ cwd },
			).catch(() => ({ stdout: "" }))

			if (!hashStdout.trim()) {
				return []
			}

			output = hashStdout
		}

		const commits: GitCommit[] = []
		const lines = output
			.trim()
			.split("\n")
			.filter((line) => line !== "--")

		for (let i = 0; i < lines.length; i += 5) {
			commits.push({
				hash: lines[i],
				shortHash: lines[i + 1],
				subject: lines[i + 2],
				author: lines[i + 3],
				date: lines[i + 4],
			})
		}

		return commits
	} catch (error) {
		Logger.error("Error searching commits:", error)
		return []
	}
}

export async function getCommitInfo(hash: string, cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Check if repo has any commits
		if (!(await checkGitRepoHasCommits(cwd))) {
			return "Repository has no commits yet"
		}

		// Get commit info, stats, and diff separately
		const { stdout: info } = await execAsync(`git show --format="%H%n%h%n%s%n%an%n%ad%n%b" --no-patch ${hash}`, {
			cwd,
		})
		const [fullHash, shortHash, subject, author, date, body] = info.trim().split("\n")

		const { stdout: stats } = await execAsync(`git show --stat --format="" ${hash}`, { cwd })

		const { stdout: diff } = await execAsync(`git show --format="" ${hash}`, { cwd })

		const summary = [
			`Commit: ${shortHash} (${fullHash})`,
			`Author: ${author}`,
			`Date: ${date}`,
			`\nMessage: ${subject}`,
			body ? `\nDescription:\n${body}` : "",
			"\nFiles Changed:",
			stats.trim(),
			"\nFull Changes:",
		].join("\n")

		const output = summary + "\n\n" + diff.trim()
		return truncateOutput(output)
	} catch (error) {
		Logger.error("Error getting commit info:", error)
		return `Failed to get commit info: ${error instanceof Error ? error.message : String(error)}`
	}
}

export async function getWorkingState(cwd: string): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return "Git is not installed"
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return "Not a git repository"
		}

		// Get status of working directory
		const { stdout: status } = await execAsync("git status --short", { cwd })
		if (!status.trim()) {
			return "No changes in working directory"
		}

		// Check if repo has any commits before trying to diff against HEAD
		let diff = ""
		if (await checkGitRepoHasCommits(cwd)) {
			// Only run git diff if there are commits
			const { stdout: diffOutput } = await execAsync("git diff HEAD", { cwd })
			diff = diffOutput
		} else {
			// No commits yet, use status output only
			return `Working directory changes (new repository):\n\n${status}`
		}
		const output = `Working directory changes:\n\n${status}\n\n${diff}`.trim()
		return truncateOutput(output)
	} catch (error) {
		Logger.error("Error getting working state:", error)
		return `Failed to get working state: ${error instanceof Error ? error.message : String(error)}`
	}
}

export async function getGitDiff(cwd: string, stagedOnly = false): Promise<string> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			throw new Error("Git is not installed")
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			throw new Error("Not a git repository")
		}

		let diff = ""
		let command = "git --no-pager diff --staged --diff-filter=d"
		if (await checkGitRepoHasCommits(cwd)) {
			// Only run git diff if there are commits
			const { stdout: staged } = await execAsync(command, { cwd })
			diff = staged.trim()
		}

		if (!stagedOnly && !diff) {
			command = "git --no-pager diff HEAD --diff-filter=d"
			const { stdout: unstaged } = await execAsync(command, { cwd })
			diff = unstaged.trim()
		}

		if (!diff) {
			throw new Error("No changes in workspace for commit message")
		}

		return truncateOutput(`'${command}' Output:\n\n${diff}`.trim())
	} catch (error) {
		throw error
	}
}

export async function getGitRemoteUrls(cwd: string): Promise<string[]> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return []
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return []
		}

		const { stdout } = await execAsync("git remote -v", { cwd })
		if (!stdout.trim()) {
			return []
		}

		// Parse output to extract unique URLs
		// git remote -v output format: "remoteName remoteUrl (fetch|push)"
		const remotes = stdout
			.trim()
			.split("\n")
			.filter((line) => line.includes("(fetch)")) // Only fetch URLs to avoid duplicates
			.map((line) => {
				const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
				return match ? { name: match[1], url: match[2] } : null
			})
			.filter((remote): remote is { name: string; url: string } => remote !== null)

		return remotes.map((remote) => `${remote.name}: ${remote.url}`)
	} catch (error) {
		Logger.error("Error getting git remotes:", error)
		return []
	}
}

export async function getLatestGitCommitHash(cwd: string): Promise<string | null> {
	try {
		const isInstalled = await checkGitInstalled()
		if (!isInstalled) {
			return null
		}

		const isRepo = await checkGitRepo(cwd)
		if (!isRepo) {
			return null
		}

		const { stdout } = await execAsync("git rev-parse HEAD", { cwd })
		return stdout.trim() || null
	} catch (error) {
		Logger.error("Error getting latest git commit hash:", error)
		return null
	}
}

// Well-known hash of git's empty tree. Diffing against it makes the entire
// current .caret/ show up as additions — the uniform code path for a first sync.
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const CARET_PATHSPEC = "-- .caret/"

export interface DesignFileDiff {
	/** Repo-relative path, e.g. `.caret/pages/checkout/index.tsx`. */
	path: string
	/** The per-file `diff --git …` hunk text. */
	hunk: string
	/** Count of added/removed lines (diff body, excluding the +++/--- headers). */
	changedLines: number
}

export interface DesignLayerDiff {
	/** True when there is no prior sync bookmark — the whole design layer is "new". */
	isFirstSync: boolean
	/** `git diff --stat` for the full changed set — always complete, never truncated. */
	stat: string
	/** Per-file diffs, so callers can budget/pack them without losing scope. */
	files: DesignFileDiff[]
}

/**
 * Returns the design-layer (`.caret/`) changes since `sinceCommit` as structured
 * per-file diffs plus a complete `--stat`. Output is intentionally NOT truncated
 * here — the sync budget packer decides what to inline vs. summarize.
 *
 * @param sinceCommit last-synced commit hash, or null for a first-ever sync.
 */
export async function getDesignLayerDiffSince(cwd: string, sinceCommit: string | null): Promise<DesignLayerDiff> {
	if (!(await checkGitInstalled()) || !(await checkGitRepo(cwd)) || !(await checkGitRepoHasCommits(cwd))) {
		return { isFirstSync: sinceCommit === null, stat: "", files: [] }
	}

	// Stale-bookmark guard: if the bookmark commit no longer resolves (history
	// rebased/squashed/gc'd), degrade to a full resync (empty-tree base → whole
	// design treated as new) instead of letting `git diff` error into a silent
	// empty diff. Safe-failure direction: re-sync everything, never skip.
	let base = sinceCommit ?? EMPTY_TREE_HASH
	let isFirstSync = sinceCommit === null
	if (sinceCommit !== null && !(await commitExists(cwd, sinceCommit))) {
		Logger.warn(`[sync] bookmark commit ${sinceCommit.slice(0, 8)} no longer resolves — falling back to a full resync`)
		base = EMPTY_TREE_HASH
		isFirstSync = true
	}

	const empty: DesignLayerDiff = { isFirstSync, stat: "", files: [] }

	try {
		const { stdout: stat } = await execAsync(`git --no-pager diff --stat ${base} HEAD ${CARET_PATHSPEC}`, {
			cwd,
			maxBuffer: 1024 * 1024 * 50,
		})
		const { stdout: raw } = await execAsync(`git --no-pager diff ${base} HEAD ${CARET_PATHSPEC}`, {
			cwd,
			maxBuffer: 1024 * 1024 * 50,
		})
		return { isFirstSync, stat: stat.trim(), files: parseDiffByFile(raw) }
	} catch (error) {
		Logger.error("Error computing design-layer diff:", error)
		return empty
	}
}

/**
 * Cheap check for the watcher: are there unsynced `.caret/` changes since
 * `sinceCommit`? `git diff --quiet` exits non-zero when differences exist.
 */
export async function hasDesignChangesSince(cwd: string, sinceCommit: string | null): Promise<boolean> {
	const base = sinceCommit ?? EMPTY_TREE_HASH
	if (!(await checkGitInstalled()) || !(await checkGitRepo(cwd)) || !(await checkGitRepoHasCommits(cwd))) {
		return false
	}
	try {
		await execAsync(`git --no-pager diff --quiet ${base} HEAD ${CARET_PATHSPEC}`, { cwd })
		return false // exit 0 → no differences
	} catch {
		return true // non-zero exit → differences exist
	}
}

/**
 * Compact commit-message narrative for the design-layer changes in a range —
 * the "why" the net diff can't show. Returns subject lines (capped), or "" for
 * a first sync / unresolvable base (no meaningful range).
 */
export async function getDesignLayerLog(cwd: string, sinceCommit: string | null): Promise<string> {
	if (sinceCommit === null) {
		return ""
	}
	if (!(await checkGitInstalled()) || !(await checkGitRepo(cwd)) || !(await commitExists(cwd, sinceCommit))) {
		return ""
	}
	try {
		const { stdout } = await execAsync(`git --no-pager log --oneline -n 20 ${sinceCommit}..HEAD ${CARET_PATHSPEC}`, {
			cwd,
		})
		return stdout.trim()
	} catch (error) {
		Logger.error("Error reading design-layer log:", error)
		return ""
	}
}

/**
 * Sync-readiness of the workspace's git state, in the order that determines the
 * fix: not-installed (hard stop) → no-repo / no-commits (offer init+commit) →
 * dirty-design (offer commit) → ready.
 */
export async function assessSyncGitState(
	cwd: string,
): Promise<"not-installed" | "no-repo" | "no-commits" | "dirty-design" | "ready"> {
	if (!(await checkGitInstalled())) {
		return "not-installed"
	}
	if (!(await checkGitRepo(cwd))) {
		return "no-repo"
	}
	if (!(await checkGitRepoHasCommits(cwd))) {
		return "no-commits"
	}
	if (await hasUncommittedDesignChanges(cwd)) {
		return "dirty-design"
	}
	return "ready"
}

/**
 * True when `.caret/` has uncommitted changes — modified OR untracked (new
 * pages). `git status --porcelain` lists both; `git diff --quiet` alone would
 * miss untracked files.
 */
export async function hasUncommittedDesignChanges(cwd: string): Promise<boolean> {
	if (!(await checkGitInstalled()) || !(await checkGitRepo(cwd))) {
		return false
	}
	try {
		const { stdout } = await execAsync(`git status --porcelain ${CARET_PATHSPEC}`, { cwd })
		return stdout.trim().length > 0
	} catch (error) {
		Logger.error("Error checking uncommitted design changes:", error)
		return false
	}
}

/** Whether `ref` resolves to a commit object in this repo. */
async function commitExists(cwd: string, ref: string): Promise<boolean> {
	try {
		await execAsync(`git rev-parse --verify --quiet ${ref}^{commit}`, { cwd })
		return true
	} catch {
		return false
	}
}

/** Splits a combined `git diff` into per-file entries on `diff --git` boundaries. */
function parseDiffByFile(raw: string): DesignFileDiff[] {
	const trimmed = raw.trim()
	if (!trimmed) {
		return []
	}
	const files: DesignFileDiff[] = []
	// Split on the start of each file header, keeping the marker.
	const chunks = trimmed.split(/(?=^diff --git )/m).filter((c) => c.startsWith("diff --git "))
	for (const hunk of chunks) {
		const header = hunk.split("\n", 1)[0]
		// `diff --git a/<path> b/<path>` — prefer the b/ (new) path.
		const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/)
		const path = match ? match[2] : header.replace(/^diff --git /, "")
		const changedLines = hunk
			.split("\n")
			.filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")).length
		files.push({ path, hunk: hunk.trimEnd(), changedLines })
	}
	return files
}

function truncateOutput(content: string): string {
	if (!GIT_OUTPUT_LINE_LIMIT) {
		return content
	}

	const lines = content.split("\n")
	if (lines.length <= GIT_OUTPUT_LINE_LIMIT) {
		return content
	}

	const beforeLimit = Math.floor(GIT_OUTPUT_LINE_LIMIT * 0.2) // 20% of lines before
	const afterLimit = GIT_OUTPUT_LINE_LIMIT - beforeLimit // remaining 80% after
	return [
		...lines.slice(0, beforeLimit),
		`\n[...${lines.length - GIT_OUTPUT_LINE_LIMIT} lines omitted...]\n`,
		...lines.slice(-afterLimit),
	].join("\n")
}

// NEW: Additional functions for Stage 3 multi-workspace support
// These are the ONLY new additions needed for workspace detection

/**
 * Check if a directory is a Git repository (Stage 3 requirement)
 * @param dirPath - The directory path to check
 * @returns True if it's a Git repository
 */
export async function isGitRepository(dirPath: string): Promise<boolean> {
	return await checkGitRepo(dirPath)
}

import { execFile } from "child_process"
import { promisify } from "util"
import { Logger } from "@/shared/services/Logger"

const execFileAsync = promisify(execFile)
const GIT_OUTPUT_LINE_LIMIT = 500

/**
 * Runs git via execFile — argument array, no shell. On Windows a shell would be
 * cmd.exe, which expands `%…%` pairs inside the `--format="%H%n…"` strings and
 * applies its own quoting rules to user-supplied query text; execFile hands git
 * the arguments untouched on every platform.
 */
async function execGit(args: string[], options?: { cwd?: string; maxBuffer?: number }): Promise<{ stdout: string }> {
	const { stdout } = await execFileAsync("git", args, { ...options, encoding: "utf8" })
	return { stdout }
}

/** Git output on Windows can carry \r\n; a bare split("\n") leaves \r in every field. */
function splitLines(text: string): string[] {
	return text.split(/\r?\n/)
}

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

async function checkGitRepo(cwd: string): Promise<boolean> {
	try {
		await execGit(["rev-parse", "--git-dir"], { cwd })
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitInstalled(): Promise<boolean> {
	try {
		await execGit(["--version"])
		return true
	} catch (_error) {
		return false
	}
}

async function checkGitRepoHasCommits(cwd: string): Promise<boolean> {
	try {
		await execGit(["rev-parse", "HEAD"], { cwd })
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
		const { stdout } = await execGit(
			["log", "-n", "10", "--format=%H%n%h%n%s%n%an%n%ad", "--date=short", `--grep=${query}`, "--regexp-ignore-case"],
			{ cwd },
		)

		let output = stdout
		if (!output.trim() && /^[a-f0-9]+$/i.test(query)) {
			// If no results from grep search and query looks like a hash, try searching by hash
			const { stdout: hashStdout } = await execGit(
				["log", "-n", "10", "--format=%H%n%h%n%s%n%an%n%ad", "--date=short", "--author-date-order", query],
				{ cwd },
			).catch(() => ({ stdout: "" }))

			if (!hashStdout.trim()) {
				return []
			}

			output = hashStdout
		}

		const commits: GitCommit[] = []
		const lines = splitLines(output.trim()).filter((line) => line !== "--")

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
		const { stdout: info } = await execGit(["show", "--format=%H%n%h%n%s%n%an%n%ad%n%b", "--no-patch", hash], {
			cwd,
		})
		const [fullHash, shortHash, subject, author, date, body] = splitLines(info.trim())

		const { stdout: stats } = await execGit(["show", "--stat", "--format=", hash], { cwd })

		const { stdout: diff } = await execGit(["show", "--format=", hash], { cwd })

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
		const { stdout: status } = await execGit(["status", "--short"], { cwd })
		if (!status.trim()) {
			return "No changes in working directory"
		}

		// Check if repo has any commits before trying to diff against HEAD
		let diff = ""
		if (await checkGitRepoHasCommits(cwd)) {
			// Only run git diff if there are commits
			const { stdout: diffOutput } = await execGit(["diff", "HEAD"], { cwd })
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
			const { stdout: staged } = await execGit(["--no-pager", "diff", "--staged", "--diff-filter=d"], { cwd })
			diff = staged.trim()
		}

		if (!stagedOnly && !diff) {
			command = "git --no-pager diff HEAD --diff-filter=d"
			const { stdout: unstaged } = await execGit(["--no-pager", "diff", "HEAD", "--diff-filter=d"], { cwd })
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

		const { stdout } = await execGit(["remote", "-v"], { cwd })
		if (!stdout.trim()) {
			return []
		}

		// Parse output to extract unique URLs
		// git remote -v output format: "remoteName remoteUrl (fetch|push)"
		const remotes = splitLines(stdout.trim())
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

		const { stdout } = await execGit(["rev-parse", "HEAD"], { cwd })
		return stdout.trim() || null
	} catch (error) {
		Logger.error("Error getting latest git commit hash:", error)
		return null
	}
}

// Well-known hash of git's empty tree. Diffing against it makes the entire
// current .caret/ show up as additions — the uniform code path for a first sync.
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
// Sync only cares about actual DESIGN CONTENT, not Caret's regenerable rendering
// shell. Allowlist the content dirs (pages/components/layouts/tokens/flows/assets)
// so machinery (lib/, main.tsx, index.html, global.css, vite.config.js,
// package*.json, thumbnails/, canvas-layout.json) and internal state
// (sync-state.json, .sync-pending.json) never pollute the diff / change detection.
// An allowlist also keeps any future generated file out automatically.
const DESIGN_CONTENT_DIRS = [
	".caret/pages/",
	".caret/components/",
	".caret/layouts/",
	".caret/tokens/",
	".caret/flows/",
	".caret/assets/",
]

export type DesignChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "changed"

export interface DesignChangedFile {
	/** Repo-relative path, e.g. `.caret/pages/checkout/index.tsx` (the new path for renames). */
	path: string
	status: DesignChangeStatus
}

// Binary image assets carry no readable signal for the AI (it can't read a PNG)
// and the page source that references them already conveys the intent — so they
// are dropped from the sync worklist as noise. A future text/SVG asset still
// flows through.
const BINARY_ASSET_EXT = /\.(png|jpe?g|gif|webp|ico|avif|bmp|tiff?)$/i

function designChangeStatusFromCode(code: string): DesignChangeStatus {
	switch (code[0]) {
		case "A":
			return "added"
		case "M":
			return "modified"
		case "D":
			return "deleted"
		case "R":
			return "renamed"
		case "C":
			return "copied"
		default:
			return "changed"
	}
}

/**
 * Parses `git diff --name-status` output into the design sync worklist, dropping
 * binary image assets. Pure (no git) so it's unit-testable on its own.
 */
export function parseDesignChangedFiles(raw: string): DesignChangedFile[] {
	const out: DesignChangedFile[] = []
	for (const line of raw.split("\n")) {
		const trimmed = line.replace(/\r$/, "")
		if (!trimmed.trim()) continue
		const parts = trimmed.split("\t")
		if (parts.length < 2) continue
		// Rename/copy lines are `R100\told\tnew` — the new path is always last.
		const path = parts[parts.length - 1]
		if (path.startsWith(".caret/assets/") && BINARY_ASSET_EXT.test(path)) continue
		out.push({ path, status: designChangeStatusFromCode(parts[0]) })
	}
	return out
}

/**
 * The design-layer (`.caret/`) files that changed since `sinceCommit`, as a net
 * cumulative `git diff --name-status <base> HEAD` worklist — NOT a per-commit
 * walk. A file changed-then-reverted across commits nets to "unchanged" and is
 * omitted; a file touched in several commits appears once at its final state.
 * No file content is read here: the sync prompt hands this list to the AI, which
 * reads the current sources itself.
 *
 * @param sinceCommit last-synced commit hash, or null for a first-ever sync.
 */
export async function getDesignLayerChangedFiles(cwd: string, sinceCommit: string | null): Promise<DesignChangedFile[]> {
	if (!(await checkGitInstalled()) || !(await checkGitRepo(cwd)) || !(await checkGitRepoHasCommits(cwd))) {
		return []
	}

	// Stale-bookmark guard: if the bookmark commit no longer resolves (history
	// rebased/squashed/gc'd), degrade to a full resync (empty-tree base → whole
	// design treated as new) rather than erroring into a silent empty list.
	let base = sinceCommit ?? EMPTY_TREE_HASH
	if (sinceCommit !== null && !(await commitExists(cwd, sinceCommit))) {
		Logger.warn(`[sync] bookmark commit ${sinceCommit.slice(0, 8)} no longer resolves — falling back to a full resync`)
		base = EMPTY_TREE_HASH
	}

	try {
		const { stdout } = await execGit(["--no-pager", "diff", "--name-status", base, "HEAD", "--", ...DESIGN_CONTENT_DIRS], {
			cwd,
			maxBuffer: 1024 * 1024 * 50,
		})
		return parseDesignChangedFiles(stdout)
	} catch (error) {
		Logger.error("Error computing design-layer changed files:", error)
		return []
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
		await execGit(["--no-pager", "diff", "--quiet", base, "HEAD", "--", ...DESIGN_CONTENT_DIRS], { cwd })
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
		const { stdout } = await execGit(
			["--no-pager", "log", "--oneline", "-n", "20", `${sinceCommit}..HEAD`, "--", ...DESIGN_CONTENT_DIRS],
			{ cwd },
		)
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
		const { stdout } = await execGit(["status", "--porcelain", "--", ...DESIGN_CONTENT_DIRS], { cwd })
		return stdout.trim().length > 0
	} catch (error) {
		Logger.error("Error checking uncommitted design changes:", error)
		return false
	}
}

/** Whether `ref` resolves to a commit object in this repo. */
async function commitExists(cwd: string, ref: string): Promise<boolean> {
	try {
		await execGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd })
		return true
	} catch {
		return false
	}
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

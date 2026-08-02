/**
 * Watches `.caret/` and heals whatever lands in it.
 *
 * Caret exposes MCP write tools, and nothing makes an agent use them. Claude
 * Code will edit `.caret/pages/*` with its own `Edit` tool; a user will open the
 * file in their editor; a script will generate one. All of those bypass the
 * mutation queue, the atomic writes and the validation that the MCP path gets
 * for free.
 *
 * So direct writing is treated as the **primary** path rather than an
 * exception. Anything that appears under `.caret/` gets the caret-id codemod and
 * validation run over it, whoever wrote it. That makes the reliability story
 * independent of agent cooperation, which is the only way it can hold for agents
 * Caret does not own.
 *
 * The codemod is append-only and idempotent: an id already in source is never
 * rewritten, so a heal that finds nothing to do writes nothing, triggers no HMR,
 * and cannot feed itself.
 */
import chokidar, { type FSWatcher } from "chokidar"
import * as path from "path"

import { assetIndexPath, reindexAssets } from "../../src/core/design"
import { precomputeAndApply } from "../../src/core/design/visual-editing/post-generation-hook"
import { Logger } from "../../src/shared/services/Logger"
import { recordEdit } from "./provenance"
import { regenerateRulesFiles } from "./rules/generate"

/**
 * Long enough that an agent writing a file in several chunks settles first, short
 * enough that the heal lands before the user clicks the element.
 */
const HEAL_DEBOUNCE_MS = 400

/** Files Caret itself owns and regenerates. Healing them would be circular. */
const IGNORED = [
	"**/node_modules/**",
	"**/.caret/lib/**",
	"**/.caret/thumbnails/**",
	"**/.caret/vite.log",
	"**/.caret/canvas-layout.json",
	"**/.caret/.sync-pending.json",
	"**/.caret/.provenance.jsonl",
	"**/.caret/.mcp.json",
	"**/*.tmp",
]

export interface WatchAndHealOptions {
	projectPath: string
	/** Called after a heal actually changed a file, so the canvas can be told. */
	onHealed?(filePath: string): void
	/** Called when foundation tokens change, after the rules files are rewritten. */
	onTokensChanged?(): void
	/** Called after the asset index changed, so the library surface can refresh. */
	onAssetsChanged?(): void
}

export class WatchAndHeal {
	private watcher: FSWatcher | null = null
	private timers = new Map<string, NodeJS.Timeout>()
	/**
	 * Files this process just wrote. A heal writes the file it is healing, which
	 * the watcher then reports back — without this the codemod would re-enter
	 * itself once per write. It terminates anyway because the codemod is
	 * idempotent, but the wasted parse is avoidable.
	 */
	private selfWrites = new Set<string>()

	constructor(private readonly options: WatchAndHealOptions) {}

	start(): void {
		if (this.watcher) return
		const caretDir = path.join(this.options.projectPath, ".caret")

		this.watcher = chokidar.watch(caretDir, {
			ignored: IGNORED,
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
		})

		this.watcher.on("add", (file) => this.schedule(file, "create"))
		this.watcher.on("change", (file) => this.schedule(file, "write"))
		this.watcher.on("unlink", (file) => {
			void recordEdit(this.options.projectPath, { actor: "external", action: "delete", file })
		})

		Logger.info(`[heal] watching ${caretDir}`)
	}

	async stop(): Promise<void> {
		for (const timer of this.timers.values()) clearTimeout(timer)
		this.timers.clear()
		await this.watcher?.close()
		this.watcher = null
	}

	/** Marks a path as written by us, so the resulting event is not treated as external. */
	markSelfWrite(filePath: string): void {
		this.selfWrites.add(path.resolve(filePath))
	}

	private schedule(filePath: string, action: "create" | "write"): void {
		const existing = this.timers.get(filePath)
		if (existing) clearTimeout(existing)
		this.timers.set(
			filePath,
			setTimeout(() => {
				this.timers.delete(filePath)
				void this.handle(filePath, action)
			}, HEAL_DEBOUNCE_MS),
		)
	}

	private async handle(filePath: string, action: "create" | "write"): Promise<void> {
		const resolved = path.resolve(filePath)
		const wasSelfWrite = this.selfWrites.delete(resolved)

		if (isFoundationTokens(filePath)) {
			await this.onTokensChanged(filePath, action, wasSelfWrite)
			return
		}

		if (isAssetFile(filePath)) {
			await this.onAssetsChanged(filePath, action, wasSelfWrite)
			return
		}

		if (!isHealable(filePath)) {
			if (!wasSelfWrite && isDesignContent(filePath)) {
				await recordEdit(this.options.projectPath, { actor: "external", action, file: filePath })
			}
			return
		}

		if (!wasSelfWrite) {
			await recordEdit(this.options.projectPath, { actor: "external", action, file: filePath })
		}

		try {
			this.markSelfWrite(resolved)
			const result = await precomputeAndApply(resolved)
			if (result.modified) {
				await recordEdit(this.options.projectPath, {
					actor: "caret",
					action: "heal",
					file: filePath,
					note: "added caret-ids / converted inline styles",
				})
				this.options.onHealed?.(resolved)
			} else {
				// Nothing was written, so no event is coming back for it.
				this.selfWrites.delete(resolved)
			}
		} catch (err) {
			this.selfWrites.delete(resolved)
			// A file mid-save is routinely unparseable. That is not an error worth
			// showing the user — the next save will heal it.
			Logger.debug(`[heal] could not heal ${filePath}: ${err}`)
		}
	}

	/**
	 * Indexes an asset that appeared in `.caret/assets/`, whoever put it there.
	 *
	 * Dragging a file into the folder in Finder has to work as well as using the
	 * UI, for the same reason an agent's own `Edit` tool has to work on pages: the
	 * reliable path cannot be the one that depends on everybody choosing it.
	 *
	 * The index write comes back through this watcher, so it is marked as a
	 * self-write first. `reindexAssets` is also a no-op when nothing changed,
	 * which closes the loop from the other side.
	 */
	private async onAssetsChanged(filePath: string, action: "create" | "write", wasSelfWrite: boolean): Promise<void> {
		if (!wasSelfWrite) {
			await recordEdit(this.options.projectPath, { actor: "external", action, file: filePath })
		}

		try {
			this.markSelfWrite(path.resolve(assetIndexPath(this.options.projectPath)))
			const result = await reindexAssets(this.options.projectPath)

			for (const { file, reason } of result.skipped) {
				Logger.info(`[heal] not indexing ${file}: ${reason}`)
			}
			if (result.added.length || result.removed.length || result.updated.length) {
				await recordEdit(this.options.projectPath, {
					actor: "caret",
					action: "write",
					file: assetIndexPath(this.options.projectPath),
					note: `indexed assets (+${result.added.length} -${result.removed.length} ~${result.updated.length})`,
				})
				// The asset list is always-on context, so a stale rules file would
				// have an agent reaching for an asset that is gone or missing one
				// that just arrived.
				await regenerateRulesFiles(this.options.projectPath).catch((err) =>
					Logger.warn(`[heal] could not regenerate rules files: ${err}`),
				)
			}
			this.options.onAssetsChanged?.()
		} catch (err) {
			Logger.warn(`[heal] could not reindex assets: ${err}`)
		}
	}

	private async onTokensChanged(filePath: string, action: "create" | "write", wasSelfWrite: boolean): Promise<void> {
		if (!wasSelfWrite) {
			await recordEdit(this.options.projectPath, { actor: "external", action, file: filePath })
		}
		// A stale rules file is worse than none — it is confidently wrong about the
		// brand colour — so this must happen on every token change, not on request.
		await regenerateRulesFiles(this.options.projectPath).catch((err) =>
			Logger.warn(`[heal] could not regenerate rules files: ${err}`),
		)
		this.options.onTokensChanged?.()
	}
}

/** Page and component sources — the files the codemod knows how to fix. */
function isHealable(filePath: string): boolean {
	if (!/\.(tsx|jsx)$/.test(filePath)) return false
	const normalised = filePath.split(path.sep).join("/")
	return (
		normalised.includes("/.caret/pages/") ||
		normalised.includes("/.caret/components/") ||
		normalised.includes("/.caret/layouts/")
	)
}

function isFoundationTokens(filePath: string): boolean {
	return filePath.split(path.sep).join("/").endsWith("/.caret/tokens/foundation.json")
}

/**
 * Anything in `.caret/assets/` except the index itself.
 *
 * Excluding the index matters: reindexing writes it, and treating that write as
 * a reason to reindex again is a loop that only stops because the self-write set
 * happens to catch it.
 */
function isAssetFile(filePath: string): boolean {
	const normalised = filePath.split(path.sep).join("/")
	return normalised.includes("/.caret/assets/") && !normalised.endsWith("/.caret/assets/index.json")
}

/** Design *content* as opposed to Caret's own machinery — worth recording. */
function isDesignContent(filePath: string): boolean {
	const normalised = filePath.split(path.sep).join("/")
	return ["/pages/", "/components/", "/layouts/", "/tokens/", "/flows/", "/assets/"].some((dir) =>
		normalised.includes(`/.caret${dir}`),
	)
}

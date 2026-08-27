/**
 * The catalog's host half: consent, the bundled mirror's location, and the
 * auto-supply loop.
 *
 * Auto-supply is what makes the catalog usable without a tool call: the agent
 * (or a hand edit, or an external write — the healer routes them all here)
 * imports `../../components/catalog/<lib>/<component>`, and Caret makes the
 * import true. Consent is per library per project, asked once with real
 * buttons; the one-signature-per-page budget is enforced by NOT supplying the
 * excess — the broken import is visible in the canvas and the checker's
 * feedback loop tells the agent to remove it.
 */
import { app } from "electron"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as path from "path"

import {
	findCatalogLibrary,
	hostFor,
	type InstallResult,
	installCatalogComponent,
	planSupply,
	readCatalogLock,
} from "../../src/core/design"
import { Logger } from "../../src/shared/services/Logger"
import { getPrefs, setPref } from "./prefs"

export interface CatalogServiceOptions {
	projectPath: string
	/** Called after anything installed, so the rules index regenerates. */
	onInstalled?(): void
}

/**
 * The bundled mirror. In a packaged app `getAppPath()` is the asar root and
 * `assets/catalog` sits inside it (electron-builder `files`). Launched from
 * `out/main/index.js` in dev and in the verify harness, `getAppPath()` is
 * `out/main` and the mirror lives two levels up in the repo.
 */
export function resolveMirrorDir(): string {
	const base = app.getAppPath()
	for (const candidate of [path.join(base, "assets", "catalog"), path.join(base, "..", "..", "assets", "catalog")]) {
		if (fsSync.existsSync(path.join(candidate, "manifest.json"))) return candidate
	}
	// Fall through to the packaged-shape path; the engine reports the miss.
	return path.join(base, "assets", "catalog")
}

export class CatalogService {
	/** Libraries declined this session — asked once, not per file save. */
	private declinedThisSession = new Set<string>()
	/** Budget refusals already notified, keyed page::component. */
	private budgetNotified = new Set<string>()
	/**
	 * The one in-flight consent prompt per library. An agent turn writes several
	 * pages in quick succession and each write's supply pass asks independently —
	 * without this, one turn stacked the SAME question four times, and the user
	 * answered a wall of identical cards one by one.
	 */
	private pendingConsent = new Map<string, Promise<boolean>>()

	constructor(private readonly options: CatalogServiceOptions) {}

	private consentKey(libraryId: string): string {
		return `${this.options.projectPath}::${libraryId}`
	}

	private hasConsent(libraryId: string): Promise<boolean> {
		const pending = this.pendingConsent.get(libraryId)
		if (pending) return pending
		const ask = this.askConsent(libraryId).finally(() => this.pendingConsent.delete(libraryId))
		this.pendingConsent.set(libraryId, ask)
		return ask
	}

	private async askConsent(libraryId: string): Promise<boolean> {
		if (getPrefs().catalogAllowed.includes(this.consentKey(libraryId))) return true
		if (this.declinedThisSession.has(libraryId)) return false

		const library = findCatalogLibrary(libraryId)
		if (!library) return false

		// No "Not now" in the actions: the notification surface has its own
		// dismiss with that exact label, and offering it twice reads as a bug.
		const choice = await hostFor(this.options.projectPath).notify(
			"info",
			`This design uses ${library.name} (${library.licence}) from the component catalog. Install it into .caret?`,
			["Allow for this project", "Just this once"],
		)
		if (choice === "Allow for this project") {
			await setPref("catalogAllowed", [...new Set([...getPrefs().catalogAllowed, this.consentKey(libraryId)])])
			return true
		}
		if (choice === "Just this once") return true
		this.declinedThisSession.add(libraryId)
		return false
	}

	/** Direct install (the MCP tool, or a future UI). Consent still applies. */
	async install(libraryId: string, componentId: string): Promise<InstallResult> {
		if (!(await this.hasConsent(libraryId))) {
			return { ok: false, reason: `the user has not approved installing from ${libraryId} into this project` }
		}
		const result = await installCatalogComponent(this.options.projectPath, libraryId, componentId, {
			mirrorDir: resolveMirrorDir(),
		})
		if (result.ok && !result.alreadyInstalled) this.options.onInstalled?.()
		return result
	}

	/**
	 * The auto-supply pass for one page file. Called by the healer after any
	 * page write settles.
	 */
	async ensureSuppliedFor(pageFile: string): Promise<void> {
		let source: string
		try {
			source = await fs.readFile(pageFile, "utf-8")
		} catch {
			return
		}

		const lock = await readCatalogLock(this.options.projectPath)
		const plan = planSupply(source, lock)
		if (plan.install.length === 0 && plan.overBudget.length === 0) return

		for (const ref of plan.install) {
			if (!(await this.hasConsent(ref.libraryId))) continue
			const result = await installCatalogComponent(this.options.projectPath, ref.libraryId, ref.componentId, {
				mirrorDir: resolveMirrorDir(),
			})
			if (result.ok && !result.alreadyInstalled) {
				Logger.info(
					`[catalog] auto-supplied ${ref.libraryId}/${ref.componentId} for ${path.basename(path.dirname(pageFile))}`,
				)
				this.options.onInstalled?.()
			} else if (!result.ok) {
				void hostFor(this.options.projectPath).notify(
					"warn",
					`Couldn't install ${ref.libraryId}/${ref.componentId}: ${result.reason}`,
				)
			}
		}

		for (const ref of plan.overBudget) {
			const key = `${pageFile}::${ref.libraryId}/${ref.componentId}`
			if (this.budgetNotified.has(key)) continue
			this.budgetNotified.add(key)
			void hostFor(this.options.projectPath).notify(
				"warn",
				`${ref.libraryId}/${ref.componentId} was NOT installed: this page already carries a signature component, and the budget is one per page. Remove one, or move it to its own page.`,
			)
		}
	}
}

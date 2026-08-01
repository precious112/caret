/**
 * Owns one project's Vite dev server — the process that actually renders the
 * design layer.
 *
 * This used to be module-level singleton state, which was correct while Caret
 * was a VS Code extension serving a single workspace. The desktop app opens
 * several projects at once, so the shell became an instance: one per project
 * window, each with its own port and its own log.
 */
import * as child_process from "child_process"
import { createWriteStream, type WriteStream } from "fs"
import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import { generateEntryFiles } from "./entry-template"
import { generateViteConfig } from "./vite-config-template"

/**
 * Dependencies the design layer needs at runtime but that a hand-scaffolded (or
 * older) `.caret/package.json` may be missing. Checked on every boot so a project
 * created before a dependency was added heals itself rather than failing to render.
 */
const REQUIRED_DEPS: Record<string, string> = {
	"react-grab": "^0.1.37",
	tailwindcss: "^4.1.0",
	"@tailwindcss/vite": "^4.1.0",
	"modern-screenshot": "^4.6.0",
}

const VITE_BOOT_TIMEOUT_MS = 30_000

export class RenderingShell {
	private viteProcess: child_process.ChildProcess | null = null
	private port: number | null = null
	private stoppingIntentionally = false

	/**
	 * @param onUnexpectedExit called when Vite dies while the shell is still
	 *   meant to be running. The canvas has no signal of its own when this
	 *   happens — it just goes blank — so the host must surface it.
	 */
	constructor(
		private readonly workspacePath: string,
		private readonly onUnexpectedExit: () => void = () => {},
	) {}

	getPort(): number | null {
		return this.port
	}

	getUrl(): string | null {
		return this.port === null ? null : `http://localhost:${this.port}/`
	}

	isRunning(): boolean {
		return this.viteProcess !== null
	}

	/** Installs missing dependencies if needed, regenerates the shell, boots Vite. */
	async start(): Promise<number> {
		const caretDir = path.join(this.workspacePath, ".caret")

		if (await this.needsInstall(caretDir)) {
			Logger.info("[design] Installing .caret dependencies...")
			await runNpmInstall(caretDir)
		}

		await generateViteConfig(caretDir)
		await generateEntryFiles(caretDir)

		this.port = await this.spawnVite(caretDir)
		return this.port
	}

	stop(): void {
		if (!this.viteProcess) return
		this.stoppingIntentionally = true
		this.viteProcess.kill()
		this.viteProcess = null
		this.port = null
		Logger.info("[design] Rendering shell stopped")
	}

	/**
	 * True when `node_modules` is absent, or when `package.json` is missing a
	 * required dependency (in which case it is added first).
	 */
	private async needsInstall(caretDir: string): Promise<boolean> {
		const pkgPath = path.join(caretDir, "package.json")
		try {
			await fs.access(path.join(caretDir, "node_modules"))
			const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
			let added = false
			for (const [dep, version] of Object.entries(REQUIRED_DEPS)) {
				if (!pkg.dependencies?.[dep]) {
					pkg.dependencies = { ...pkg.dependencies, [dep]: version }
					added = true
				}
			}
			if (added) {
				await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))
			}
			return added
		} catch {
			return true
		}
	}

	private spawnVite(cwd: string): Promise<number> {
		return new Promise((resolve, reject) => {
			const viteBin = path.join(cwd, "node_modules", ".bin", "vite")
			const logStream: WriteStream = createWriteStream(path.join(cwd, "vite.log"), { flags: "w" })

			this.stoppingIntentionally = false
			// No --port: Vite auto-increments from 5173 when the port is taken, which
			// is what keeps several open projects from colliding. The chosen port is
			// read back from stdout below rather than assumed.
			const proc = child_process.spawn(viteBin, ["--host", "localhost"], {
				cwd,
				stdio: "pipe",
				shell: true,
			})
			this.viteProcess = proc

			let resolved = false
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true
					reject(new Error("Vite server did not start within 30 seconds"))
				}
			}, VITE_BOOT_TIMEOUT_MS)

			proc.stdout?.on("data", (data: Buffer) => {
				const output = data.toString()
				Logger.info(`[vite] ${output.trim()}`)
				logStream.write(output)

				const match = output.match(/Local:\s+http:\/\/localhost:(\d+)/)
				if (match && !resolved) {
					resolved = true
					clearTimeout(timeout)
					resolve(Number.parseInt(match[1], 10))
				}
			})

			proc.stderr?.on("data", (data: Buffer) => {
				const output = data.toString()
				Logger.warn(`[vite stderr] ${output.trim()}`)
				logStream.write(output)
			})

			proc.on("close", (code) => {
				logStream.end()
				const wasRunning = resolved
				if (!resolved) {
					resolved = true
					clearTimeout(timeout)
					reject(new Error(`Vite process exited with code ${code}`))
				}
				this.viteProcess = null
				this.port = null
				if (wasRunning && !this.stoppingIntentionally) {
					Logger.error(`[design] Vite dev server exited unexpectedly (code ${code})`)
					this.onUnexpectedExit()
				}
			})

			proc.on("error", (err) => {
				if (!resolved) {
					resolved = true
					clearTimeout(timeout)
					reject(err)
				}
			})
		})
	}
}

function runNpmInstall(cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn("npm", ["install"], { cwd, stdio: "pipe", shell: true })

		let stderr = ""
		proc.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		proc.on("close", (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`npm install failed (exit ${code}): ${stderr}`))
			}
		})
		proc.on("error", reject)
	})
}

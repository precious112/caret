import * as child_process from "child_process"
import { createWriteStream, type WriteStream } from "fs"
import * as fs from "fs/promises"
import * as path from "path"

import { Logger } from "@/shared/services/Logger"
import { generateEntryFiles } from "./entry-template"
import { generateViteConfig } from "./vite-config-template"

let viteProcess: child_process.ChildProcess | null = null
let currentPort: number | null = null

const REQUIRED_DEPS: Record<string, string> = {
	"react-grab": "^0.1.37",
	tailwindcss: "^4.1.0",
	"@tailwindcss/vite": "^4.1.0",
}

export async function startRenderingShell(workspacePath: string): Promise<{ port: number; dispose: () => void }> {
	const caretDir = path.join(workspacePath, ".caret")

	// Ensure package.json has all required deps, then install if needed
	const pkgPath = path.join(caretDir, "package.json")
	let needsInstall = false
	try {
		await fs.access(path.join(caretDir, "node_modules"))
		const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"))
		for (const [dep, version] of Object.entries(REQUIRED_DEPS)) {
			if (!pkg.dependencies?.[dep]) {
				pkg.dependencies = { ...pkg.dependencies, [dep]: version }
				needsInstall = true
			}
		}
		if (needsInstall) {
			await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2))
		}
	} catch {
		needsInstall = true
	}

	if (needsInstall) {
		Logger.info("Installing .caret dependencies...")
		await runNpmInstall(caretDir)
	}

	// Generate vite config and entry files
	await generateViteConfig(caretDir)
	await generateEntryFiles(caretDir)

	// Start Vite dev server
	const port = await spawnVite(caretDir)
	currentPort = port

	return {
		port,
		dispose: () => stopRenderingShell(),
	}
}

export function stopRenderingShell(): void {
	if (viteProcess) {
		viteProcess.kill()
		viteProcess = null
		currentPort = null
		Logger.info("Rendering shell stopped")
	}
}

export function getRenderingShellPort(): number | null {
	return currentPort
}

async function runNpmInstall(cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn("npm", ["install"], {
			cwd,
			stdio: "pipe",
			shell: true,
		})

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

async function spawnVite(cwd: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const viteBin = path.join(cwd, "node_modules", ".bin", "vite")
		const logStream: WriteStream = createWriteStream(path.join(cwd, "vite.log"), { flags: "w" })

		viteProcess = child_process.spawn(viteBin, ["--host", "localhost"], {
			cwd,
			stdio: "pipe",
			shell: true,
		})

		let resolved = false
		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true
				reject(new Error("Vite server did not start within 30 seconds"))
			}
		}, 30000)

		viteProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString()
			Logger.info(`[vite] ${output.trim()}`)
			logStream.write(output)

			// Parse port from Vite's stdout: "Local: http://localhost:5173/"
			const match = output.match(/Local:\s+http:\/\/localhost:(\d+)/)
			if (match && !resolved) {
				resolved = true
				clearTimeout(timeout)
				resolve(Number.parseInt(match[1], 10))
			}
		})

		viteProcess.stderr?.on("data", (data: Buffer) => {
			const output = data.toString()
			Logger.warn(`[vite stderr] ${output.trim()}`)
			logStream.write(output)
		})

		viteProcess.on("close", (code) => {
			logStream.end()
			if (!resolved) {
				resolved = true
				clearTimeout(timeout)
				reject(new Error(`Vite process exited with code ${code}`))
			}
			viteProcess = null
			currentPort = null
		})

		viteProcess.on("error", (err) => {
			if (!resolved) {
				resolved = true
				clearTimeout(timeout)
				reject(err)
			}
		})
	})
}

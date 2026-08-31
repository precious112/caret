/**
 * Runs the REAL matte worker — the same source string the app writes, spawned
 * the same way (Caret's binary, ELECTRON_RUN_AS_NODE) — over a raw RGBA dump.
 *
 * Exists because the in-process version crashed the app in the field while
 * every probe passed: the probes ran under plain node, the app under
 * Electron's allocator. This one exercises the exact deployment shape.
 *
 *   npx tsx scripts/probe-matte-worker.ts in.rgba out.rgba WIDTH HEIGHT
 */
import { spawn } from "child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "fs"
import { createRequire } from "module"
import { homedir, tmpdir } from "os"
import * as path from "path"

import { MATTE_WORKER_SOURCE } from "../desktop/main/matte-worker-source"
import { applyMatte, MATTE_MODEL, matteInputTensor } from "../src/core/design"

const nativeRequire = createRequire(import.meta.url)

async function main() {
	const [, , input, output, w, h] = process.argv
	const width = Number(w)
	const height = Number(h)
	const image = { data: new Uint8Array(readFileSync(input)), width, height, order: "rgba" as const }

	const scratch = mkdtempSync(path.join(tmpdir(), "matte-probe-"))
	const workerPath = path.join(scratch, "matte-worker.cjs")
	writeFileSync(workerPath, MATTE_WORKER_SOURCE)

	const electron = nativeRequire("electron") as unknown as string
	const child = spawn(electron, [workerPath], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		stdio: ["pipe", "pipe", "inherit"],
	})

	const side = MATTE_MODEL.input
	const tensor = matteInputTensor(image, side)
	const tensorFile = path.join(scratch, "job.in")
	const maskFile = path.join(scratch, "job.out")
	writeFileSync(tensorFile, Buffer.from(tensor.buffer, tensor.byteOffset, tensor.byteLength))

	const started = Date.now()
	const reply = await new Promise<{ ok: boolean; stage?: string; reason?: string }>((resolve) => {
		let buffered = ""
		child.stdout.on("data", (chunk: Buffer) => {
			buffered += chunk.toString()
			const cut = buffered.indexOf("\n")
			if (cut >= 0) resolve(JSON.parse(buffered.slice(0, cut)))
		})
		child.stdin.write(
			`${JSON.stringify({
				id: "probe",
				ortPath: nativeRequire.resolve("onnxruntime-node"),
				modelPath: path.join(homedir(), "Library", "Application Support", "Caret", "models", MATTE_MODEL.name),
				tensorFile,
				maskFile,
				side,
			})}\n`,
		)
	})
	console.log(`worker replied in ${((Date.now() - started) / 1000).toFixed(1)}s:`, JSON.stringify(reply))
	if (!reply.ok) process.exit(1)

	const raw = readFileSync(maskFile)
	const mask = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length))
	const result = applyMatte(image, mask, side)
	child.stdin.end()
	if (!result.ok) {
		console.error("REFUSED:", result.reason)
		process.exit(1)
	}
	writeFileSync(output, Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength))
	console.log(`ACCEPTED — cut ${(result.cut * 100).toFixed(1)}% of the frame`)
	process.exit(0)
}

void main()

/**
 * The cutout model's worker: plain CJS, run by Caret's own binary with
 * ELECTRON_RUN_AS_NODE, written to userData at boot like the MCP bridge.
 *
 * It exists because inference CANNOT run in the Electron main process:
 * ORT's arena growth (BFCArena::Extend) allocates through Electron's
 * PartitionAlloc shim, which SIGTRAPs on it and takes the whole app down —
 * field crash 2026-08-31, one crash per keyed variant. The same binary in
 * plain node mode uses the system allocator and runs the same inference
 * clean (measured: open 3.3s, run 16.9s).
 *
 * The division of labour keeps this file dependency-free except the ORT
 * runtime itself, which arrives as an absolute path in the job (resolved by
 * the main process, so cwd never matters): the worker only runs the network
 * — float32 tensor file in, float32 mask file out. Every tested piece of
 * the cutout (tensor prep, mask application, unmixing, honesty gates) stays
 * in the bundle where its unit tests live.
 *
 * Jobs arrive one JSON per stdin line; one JSON reply per stdout line,
 * matched by id. The session opens once and is reused — that is the whole
 * point of the worker being resident. When stdin closes (the app died or
 * quit), the worker SIGKILLs itself: ORT's global teardown crashes with a
 * mutex error on this platform, and a worker with no work left has nothing
 * to flush that matters.
 */
export const MATTE_WORKER_SOURCE = `"use strict"
const fs = require("fs")
const readline = require("readline")

let ort = null
let session = null
let sessionModel = ""

const rl = readline.createInterface({ input: process.stdin })
let chain = Promise.resolve()
rl.on("line", (line) => {
	chain = chain.then(() => handle(line)).catch(() => {})
})
rl.on("close", () => {
	// Skip ORT's global teardown, which aborts with "mutex lock failed" on
	// this platform. Nothing here has state worth flushing.
	process.kill(process.pid, "SIGKILL")
})

async function handle(line) {
	let job = null
	try {
		job = JSON.parse(line)
	} catch {
		return
	}
	const reply = { id: job.id, ok: false, stage: "require", reason: "" }
	try {
		if (!ort) ort = require(job.ortPath)
		reply.stage = "open"
		if (!session || sessionModel !== job.modelPath) {
			// "basic" is load-bearing: this export's broken external-tensor
			// metadata fails shape inference under "all" AND "disabled".
			session = await ort.InferenceSession.create(job.modelPath, { graphOptimizationLevel: "basic" })
			sessionModel = job.modelPath
		}
		reply.stage = "run"
		const raw = fs.readFileSync(job.tensorFile)
		const aligned = raw.byteOffset % 4 === 0 ? raw : Buffer.from(raw)
		const tensor = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4)
		const feeds = {}
		feeds[session.inputNames[0]] = new ort.Tensor("float32", tensor, [1, 3, job.side, job.side])
		const results = await session.run(feeds)
		const mask = results[session.outputNames[0]].data
		fs.writeFileSync(job.maskFile, Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength))
		reply.ok = true
		reply.length = mask.length
	} catch (error) {
		reply.reason = error && error.message ? error.message : String(error)
	}
	process.stdout.write(JSON.stringify(reply) + "\\n")
}
`

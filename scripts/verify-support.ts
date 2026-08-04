/**
 * Which backend and model the certification suites are allowed to spend.
 *
 * Two rules, and the second one is the important one:
 *
 * 1. **`CARET_VERIFY_BACKEND` and `CARET_VERIFY_MODEL` win.** Once you have an
 *    OpenCode Go or Codex subscription, that is how you point the suites at it —
 *    deliberately, by setting variables, in the backend's own naming.
 *    `CARET_VERIFY_EFFORT` goes with them.
 * 2. **Nothing paid is ever spent by accident.** A test run must not quietly
 *    bill someone's subscription because it happened to find one signed in. So
 *    without that variable the suites use a zero-cost model if the backend
 *    offers one, and otherwise **skip** the scenarios that need inference.
 *
 * Skipping rather than failing matters because a Caret with no backend is a
 * *supported* state, not a broken one — every feature refuses with a named fix,
 * and that refusal is itself certified. A red suite on a machine with no
 * credentials would say Caret is broken when it is behaving exactly as designed.
 */
import type { BackendId, CodingBackend, ReasoningEffort } from "../src/core/design/agent/backend"
import { CARET_SERVER_CONFIG } from "../src/core/design/agent/opencode"
import { request } from "../src/core/design/agent/opencode/http"
import type { OpencodeProvidersResponse } from "../src/core/design/agent/opencode/protocol"
import { ensureOpencodeServer } from "../src/core/design/agent/opencode/server"
import { getBackend } from "../src/core/design/agent/registry"

export interface VerifyModel {
	/** In the backend's own namespace, e.g. `anthropic/claude-sonnet-5`. */
	id: string
	/** Which backend to run it on. */
	backendId: BackendId
	backend: CodingBackend
	effort?: ReasoningEffort
	/** Where it came from, for the scenario's detail line. */
	source: "env" | "free"
}

const BACKEND_IDS = new Set<string>(["opencode", "claude", "codex", "kimi"])
const EFFORTS = new Set<string>(["minimal", "low", "medium", "high", "xhigh"])

/** Null means: no model this suite is allowed to use. Skip, do not fail. */
export async function resolveVerifyModel(): Promise<VerifyModel | null> {
	const effort = process.env.CARET_VERIFY_EFFORT?.trim()
	if (effort && !EFFORTS.has(effort)) {
		// Loudly, not silently: a typo here would otherwise run the whole suite at
		// the wrong effort and the results would look like a model regression.
		throw new Error(`CARET_VERIFY_EFFORT="${effort}" is not one of ${[...EFFORTS].join(", ")}`)
	}
	const chosenEffort = effort as ReasoningEffort | undefined

	const fromEnv = process.env.CARET_VERIFY_MODEL?.trim()
	const backendId = process.env.CARET_VERIFY_BACKEND?.trim() ?? "opencode"
	if (!BACKEND_IDS.has(backendId)) {
		throw new Error(`CARET_VERIFY_BACKEND="${backendId}" is not one of ${[...BACKEND_IDS].join(", ")}`)
	}

	const backend = getBackend(backendId as BackendId)

	if (fromEnv) {
		// A named backend still has to be usable. Reporting "not ready" here beats
		// a turn that fails minutes later for a reason nobody connects to auth.
		const report = await backend.availability().catch(() => null)
		if (!report?.ready) return null
		return { id: fromEnv, backendId: backendId as BackendId, backend, effort: chosenEffort, source: "env" }
	}

	if (backendId !== "opencode") return null

	const report = await backend.availability().catch(() => null)
	if (!report?.ready) return null

	const free = await freeModel().catch(() => null)
	return free ? { id: free, backendId: "opencode", backend, effort: chosenEffort, source: "free" } : null
}

/**
 * Zero-cost models that have actually been watched doing agentic work here,
 * best first.
 *
 * A preference, not a requirement — see {@link freeModel}. The ones left out
 * were left out for reasons: some refuse a forced tool choice, and at least one
 * provider's speculative decoding has no grammar support at all, so they fail
 * schema-constrained requests in ways that look like Caret's bug.
 */
const PREFERRED_FREE_MODELS = ["opencode/ling-3.0-flash-free", "opencode/mimo-v2.5-free"]

/**
 * A zero-cost model the backend offers, or null.
 *
 * Preferred-then-discovered rather than pinned: a free tier's catalogue is
 * somebody else's to change, and a hardcoded id that quietly disappears fails
 * as "the backend is broken" instead of "that model is gone". Taking the first
 * zero-cost entry on its own would be worse — the order is arbitrary, so the
 * suite would silently swap models between runs and its results would stop
 * being comparable.
 */
async function freeModel(): Promise<string | null> {
	const server = await ensureOpencodeServer(CARET_SERVER_CONFIG)
	const providers = await request<OpencodeProvidersResponse>(server, "/config/providers")

	const free: string[] = []
	for (const provider of providers.providers) {
		for (const [id, model] of Object.entries(provider.models ?? {})) {
			const cost = model.cost
			if (cost && cost.input === 0 && cost.output === 0) free.push(`${provider.id}/${id}`)
		}
	}

	return PREFERRED_FREE_MODELS.find((preferred) => free.includes(preferred)) ?? free[0] ?? null
}

/** One line explaining what was skipped and how to run it for real. */
export const NO_MODEL_REASON =
	"no model this suite may spend — set CARET_VERIFY_BACKEND=<id> CARET_VERIFY_MODEL=<model> to run it against your own subscription"

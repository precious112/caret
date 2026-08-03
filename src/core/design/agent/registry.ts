/**
 * Which backends exist, and one instance of each.
 *
 * Instances are cached per process rather than per project: adapters own a
 * server process or a CLI handle, and a second project must not start a second
 * copy of either.
 */
import type { AvailabilityReport, BackendId, CodingBackend } from "./backend"
import { ClaudeBackend } from "./claude"
import { CodexBackend } from "./codex"
import { KimiBackend } from "./kimi"
import { OpencodeBackend } from "./opencode"

/** Order is the order the setup screen offers them in: bundled first. */
export const BACKEND_IDS: BackendId[] = ["opencode", "claude", "codex", "kimi"]

const instances = new Map<BackendId, CodingBackend>()

export function getBackend(id: BackendId): CodingBackend {
	let backend = instances.get(id)
	if (!backend) {
		backend = construct(id)
		instances.set(id, backend)
	}
	return backend
}

function construct(id: BackendId): CodingBackend {
	switch (id) {
		case "opencode":
			return new OpencodeBackend()
		case "claude":
			return new ClaudeBackend()
		case "codex":
			return new CodexBackend()
		case "kimi":
			return new KimiBackend()
	}
}

/**
 * Availability of every backend, for the setup screen.
 *
 * Probed in parallel and never allowed to throw: one adapter whose CLI misbehaves
 * must not blank the whole screen, so a failure becomes that row's own "not
 * ready" reason.
 */
export async function probeBackends(): Promise<AvailabilityReport[]> {
	return Promise.all(
		BACKEND_IDS.map(async (id) => {
			const backend = getBackend(id)
			try {
				return await backend.availability()
			} catch (err) {
				return {
					id,
					displayName: backend.displayName,
					installed: false,
					authenticated: false,
					ready: false,
					detail: err instanceof Error ? err.message : String(err),
				}
			}
		}),
	)
}

/** Shuts every constructed backend down. Called when the app quits. */
export async function disposeBackends(): Promise<void> {
	await Promise.allSettled([...instances.values()].map((backend) => backend.dispose?.()))
	instances.clear()
}

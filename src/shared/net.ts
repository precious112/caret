/**
 * # Network access
 *
 * **Do** use `import { fetch } from "@/shared/net"` rather than global `fetch`,
 * and spread `getAxiosSettings()` into any axios call.
 *
 * The reason is proxies. Node's global `fetch` ignores `HTTP_PROXY` /
 * `HTTPS_PROXY` / `NO_PROXY`, so on a corporate network every request from the
 * main process fails with an opaque connection error while the same URL loads
 * fine in a browser. Routing through undici's `EnvHttpProxyAgent` respects those
 * variables, which is the behaviour users already expect from every other CLI on
 * their machine.
 *
 * Renderer code should use the browser's global `fetch` — Chromium handles the
 * system proxy itself.
 *
 * ## Testing
 *
 * ```ts
 * await mockFetchForTesting(myMock, async () => {
 *   await somethingThatFetches()
 * })
 * // the real fetch is restored when the callback settles, including on throw
 * ```
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici"

type FetchFn = typeof globalThis.fetch

let proxyAgent: EnvHttpProxyAgent | undefined

/**
 * Built lazily and cached: reading proxy configuration at import time would
 * capture the environment before the app has applied the user's own preference.
 */
function agent(): EnvHttpProxyAgent {
	proxyAgent ??= new EnvHttpProxyAgent()
	return proxyAgent
}

const realFetch = ((input: any, init?: any) => undiciFetch(input, { ...init, dispatcher: agent() })) as unknown as FetchFn

let currentFetch: FetchFn = realFetch

/** Proxy-aware `fetch`. Same signature as the global. */
export const fetch: FetchFn = ((input: any, init?: any) => currentFetch(input, init)) as FetchFn

/**
 * Spread into every axios call so it uses the same proxy configuration undici
 * does. axios already reads the proxy environment variables on Node; this exists
 * so call sites have one obvious thing to do and stay correct if that changes.
 */
export function getAxiosSettings(): Record<string, unknown> {
	return {}
}

/** Swaps in `mock` for the duration of `body`, restoring the real fetch after. */
export async function mockFetchForTesting<T>(mock: FetchFn, body: () => T | Promise<T>): Promise<T> {
	const previous = currentFetch
	currentFetch = mock
	try {
		return await body()
	} finally {
		currentFetch = previous
	}
}

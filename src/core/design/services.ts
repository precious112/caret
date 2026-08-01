/**
 * Per-project service lookup.
 *
 * The host and the agent bridge were briefly module singletons, which is wrong
 * as soon as two projects are open: the second window to start would capture
 * both, and a notification raised while syncing project A would appear over
 * project B. Every call site already carries the project path, so services are
 * keyed by it.
 *
 * Lookups never fail. An unregistered project resolves to a null host (silent)
 * and a `NullBridge` (refuses honestly), which is also the correct behaviour for
 * headless runs and tests that only exercise the design core.
 */
import { type AgentBridge, NullBridge } from "./agent/bridge"
import { type DesignHost, nullDesignHost } from "./host"

export interface ProjectServices {
	host: DesignHost
	bridge: AgentBridge
}

const registry = new Map<string, ProjectServices>()
const fallback: ProjectServices = { host: nullDesignHost, bridge: new NullBridge() }

/** Installs the services for an open project. Called when its window opens. */
export function registerProjectServices(workspacePath: string, services: Partial<ProjectServices>): void {
	registry.set(workspacePath, { ...fallback, ...registry.get(workspacePath), ...services })
}

/** Removes a project's services. Called when its window closes. */
export function unregisterProjectServices(workspacePath: string): void {
	registry.delete(workspacePath)
}

export function hostFor(workspacePath: string): DesignHost {
	return registry.get(workspacePath)?.host ?? fallback.host
}

export function bridgeFor(workspacePath: string): AgentBridge {
	return registry.get(workspacePath)?.bridge ?? fallback.bridge
}

/** Replaces just the bridge — an agent connecting or disconnecting mid-session. */
export function setProjectBridge(workspacePath: string, bridge: AgentBridge): void {
	registerProjectServices(workspacePath, { bridge })
}

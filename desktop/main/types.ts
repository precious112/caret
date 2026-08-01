/**
 * Types the main process shares with the renderer.
 *
 * The design-core message types are re-exported here so main code has one place
 * to import from. The renderer deliberately cannot reach these — it uses the
 * structural mirrors in `desktop/shared/ipc.ts` instead, so that a renderer
 * import of main-process code is a compile error rather than a convention.
 */
export type { DesignInboundMessage, DesignOutboundMessage } from "../../src/core/design"
export type {
	AgentClientConfig,
	NotificationLevel,
	NotificationRequest,
	ProjectState,
	ProjectSummary,
} from "../shared/ipc"

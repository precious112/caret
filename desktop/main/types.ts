/**
 * Types the main process shares with the renderer.
 *
 * The design-core message types are re-exported here so main code has one place
 * to import from. The renderer deliberately cannot reach these — it uses the
 * structural mirrors in `desktop/shared/ipc.ts` instead, so that a renderer
 * import of main-process code is a compile error rather than a convention.
 */
export type { DesignInboundMessage, DesignOutboundMessage } from "../../src/core/design"

/**
 * A page capture, or a stated reason it could not happen.
 *
 * Deliberately not `string | null`. The only consumer is an agent, and a bare
 * null forces the caller to invent a cause — which is how `get_screenshot` came
 * to answer "is the canvas running?" for every possible failure, including the
 * ones where it plainly was.
 */
export type ScreenshotResult =
	| {
			ok: true
			dataUrl: string
			/**
			 * Set only for measured failures — an image that completed with zero
			 * pixels (404/decode error). Without it, a page with a broken asset
			 * screenshots as clean evidence that the asset "isn't showing".
			 * Never speculation: no "still loading" guesses, which misfire on
			 * lazy content that is not meant to load.
			 */
			warning?: string
	  }
	| { ok: false; reason: string }
export type {
	AgentClientConfig,
	NotificationLevel,
	NotificationRequest,
	ProjectState,
	ProjectSummary,
} from "../shared/ipc"

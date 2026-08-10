export interface ElementSelectedPayload {
	filePath: string
	lineNumber: number
	componentName: string
	tagName: string
	props: Record<string, unknown>
}

export interface OpenFilePayload {
	filePath: string
	lineNumber?: number
}

export interface InlineEditPayload {
	editType: "text" | "color" | "image"
	filePath: string
	lineNumber: number
	oldValue: string
	newValue: string
	tagName?: string
	imageData?: string
	caretId?: string
}

export interface AiEditRequestPayload {
	instruction: string
	filePath: string
	lineNumber: number
	columnNumber: number
	componentName: string
	caretId: string
	componentStack: string
	/**
	 * The rendered size of the target, in CSS pixels.
	 *
	 * Only used to judge whether a referenced asset fits the space it is going
	 * into. Optional because it is a courtesy, not a contract: an older canvas,
	 * or an element with no box, still sends a usable instruction.
	 */
	box?: { width: number; height: number }
}

export interface EditResultPayload {
	success: boolean
	error?: string
	suggestAiEdit?: boolean
	/**
	 * A colour edit replaced this foundation token class (`brand-500`) with an
	 * arbitrary value — the element detached from the token. The canvas offers
	 * the alternative: change the token itself, reaching `tokenUses` places.
	 */
	detachedFrom?: string
	/** How many colour-utility uses of `detachedFrom` exist across the design layer. */
	tokenUses?: number
	/** The picked colour exactly matched this token, so the edit bound to it instead of detaching. */
	boundTo?: string
	/** Echoed element address so the promote action can re-bind the same element. */
	editTarget?: { filePath: string; lineNumber: number; caretId?: string }
}

export interface PromoteTokenPayload {
	/** The foundation token to repoint (`brand-500`, `neutral-200`, `success`, `brand`). */
	token: string
	/** The picked colour the token should now resolve to. */
	hex: string
	/** The element that detached — re-bound to the token class as part of the promote. */
	filePath: string
	lineNumber: number
	caretId?: string
}

export interface OverlayEditPayload {
	instruction: string
	screenshotDataUrl: string
	regionBounds: { x: number; y: number; width: number; height: number }
	filePath?: string
}

export interface LogPayload {
	level: "info" | "error"
	message: string
}

export interface PageFocusedPayload {
	filePath: string
}

export interface PrecomputeResultPayload {
	filePath: string
	dynamicRanges: Array<{
		startLine: number
		startCol: number
		endLine: number
		endCol: number
		diagnostics: string[]
	}>
}

export interface FlowEdgeCreatePayload {
	flowId: string
	fromPage: string
	toPage: string
}

export interface FlowEdgeDeletePayload {
	flowId: string
	fromPage: string
	toPage: string
	isError?: boolean
}

export interface FlowEdgeUpdatePayload {
	flowId: string
	fromPage: string
	oldToPage: string
	newToPage: string
	isError?: boolean
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/**
 * Required-field checks for payloads arriving from the preview iframe. The
 * iframe runs generated + user code, so payloads are untrusted input: a
 * malformed message must be ignored, never crash a handler or produce a
 * mangled file path.
 */
const PAYLOAD_VALIDATORS: Record<string, (p: Record<string, unknown>) => boolean> = {
	"element-selected": (p) => isStr(p.filePath),
	"open-file": (p) => isStr(p.filePath),
	"inline-edit": (p) =>
		(p.editType === "text" || p.editType === "color" || p.editType === "image") &&
		isStr(p.filePath) &&
		isNum(p.lineNumber) &&
		typeof p.newValue === "string",
	"ai-edit-request": (p) => isStr(p.instruction) && isStr(p.filePath),
	"overlay-edit": (p) => isStr(p.instruction),
	"edit-cancel": () => true,
	"edit-permission": (p) =>
		isStr(p.requestId) && (p.decision === "allow" || p.decision === "deny" || p.decision === "allow-always"),
	"page-focused": (p) => isStr(p.filePath),
	"flow-edge-create": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.toPage),
	"flow-edge-delete": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.toPage),
	"flow-edge-update": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.oldToPage) && isStr(p.newToPage),
	"design-sync-now": () => true,
	"promote-token": (p) => isStr(p.token) && isStr(p.hex) && isStr(p.filePath) && isNum(p.lineNumber),
	log: () => true,
}

export function isValidDesignMessagePayload(type: string, payload: unknown): boolean {
	const validator = PAYLOAD_VALIDATORS[type]
	if (!validator) return true // unknown types are handled (ignored) downstream
	if (!payload || typeof payload !== "object") return false
	return validator(payload as Record<string, unknown>)
}

/** Canvas → host. Untrusted: the canvas runs generated and user-authored code. */
export type DesignInboundMessage =
	| { source: "caret-vite"; type: "element-selected"; payload: ElementSelectedPayload }
	| { source: "caret-vite"; type: "open-file"; payload: OpenFilePayload }
	| { source: "caret-vite"; type: "inline-edit"; payload: InlineEditPayload }
	| { source: "caret-vite"; type: "ai-edit-request"; payload: AiEditRequestPayload }
	| { source: "caret-vite"; type: "overlay-edit"; payload: OverlayEditPayload }
	| { source: "caret-vite"; type: "log"; payload: LogPayload }
	| { source: "caret-vite"; type: "page-focused"; payload: PageFocusedPayload }
	| { source: "caret-vite"; type: "flow-edge-create"; payload: FlowEdgeCreatePayload }
	| { source: "caret-vite"; type: "flow-edge-delete"; payload: FlowEdgeDeletePayload }
	| { source: "caret-vite"; type: "flow-edge-update"; payload: FlowEdgeUpdatePayload }
	| { source: "caret-vite"; type: "design-sync-now"; payload: Record<string, never> }
	| { source: "caret-vite"; type: "promote-token"; payload: PromoteTokenPayload }
	// The edit pill's controls: cancel the in-flight edit, answer its permission.
	| { source: "caret-vite"; type: "edit-cancel"; payload: Record<string, never> }
	| {
			source: "caret-vite"
			type: "edit-permission"
			payload: { requestId: string; decision: "allow" | "deny" | "allow-always" }
	  }

/** Live narration of a canvas-initiated AI edit, rendered by the pill. */
export interface EditStatusPayload {
	phase: "working" | "needs-permission" | "done" | "failed" | "cancelled"
	instruction?: string
	detail?: string
	permission?: { requestId: string; summary: string }
	error?: string
}

/** Host → canvas. */
export type DesignOutboundMessage =
	| { source: "caret-host"; type: "edit-result"; payload: EditResultPayload }
	| { source: "caret-host"; type: "edit-status"; payload: EditStatusPayload }
	| { source: "caret-host"; type: "precompute-result"; payload: PrecomputeResultPayload }

export type DesignMessage = DesignInboundMessage | DesignOutboundMessage

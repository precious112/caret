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
}

export interface EditResultPayload {
	success: boolean
	error?: string
	suggestAiEdit?: boolean
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
	"page-focused": (p) => isStr(p.filePath),
	"flow-edge-create": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.toPage),
	"flow-edge-delete": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.toPage),
	"flow-edge-update": (p) => isStr(p.flowId) && isStr(p.fromPage) && isStr(p.oldToPage) && isStr(p.newToPage),
	"design-sync-now": () => true,
	log: () => true,
}

export function isValidDesignMessagePayload(type: string, payload: unknown): boolean {
	const validator = PAYLOAD_VALIDATORS[type]
	if (!validator) return true // unknown types are handled (ignored) downstream
	if (!payload || typeof payload !== "object") return false
	return validator(payload as Record<string, unknown>)
}

export type DesignMessage =
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
	| { source: "caret-extension"; type: "edit-result"; payload: EditResultPayload }
	| { source: "caret-extension"; type: "precompute-result"; payload: PrecomputeResultPayload }

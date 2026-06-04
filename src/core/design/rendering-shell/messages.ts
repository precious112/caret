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

export type DesignMessage =
	| { source: "caret-vite"; type: "element-selected"; payload: ElementSelectedPayload }
	| { source: "caret-vite"; type: "open-file"; payload: OpenFilePayload }
	| { source: "caret-vite"; type: "inline-edit"; payload: InlineEditPayload }
	| { source: "caret-vite"; type: "ai-edit-request"; payload: AiEditRequestPayload }
	| { source: "caret-vite"; type: "overlay-edit"; payload: OverlayEditPayload }
	| { source: "caret-vite"; type: "log"; payload: LogPayload }
	| { source: "caret-vite"; type: "page-focused"; payload: PageFocusedPayload }
	| { source: "caret-extension"; type: "edit-result"; payload: EditResultPayload }
	| { source: "caret-extension"; type: "precompute-result"; payload: PrecomputeResultPayload }

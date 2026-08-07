export interface VibeDescriptor {
	description: string
	tags: string[]
}

export interface ColorScale {
	50: string
	100: string
	200: string
	300: string
	400: string
	500: string
	600: string
	700: string
	800: string
	900: string
	950: string
}

export interface ColorTokens {
	brand: {
		seed: string
		scale: Partial<ColorScale>
	}
	neutral: {
		character: "warm" | "cool" | "true" | "slight-tint"
		scale: Partial<ColorScale>
	}
	/**
	 * Whether this project is built on light or dark surfaces.
	 *
	 * Optional because foundations written before this field existed do not carry
	 * it; everything that reads it treats absent as `light`. The wizard has always
	 * *asked* — the palette recipes each declare a surface and `FoundationProposal`
	 * requires one — but until Phase 6.7 the answer was dropped in `finalize`, so
	 * nothing downstream could act on it. Generated assets are the first thing that
	 * genuinely cannot: an image composed for a white page is wrong on a dark one
	 * in a way no amount of description repairs.
	 */
	surface?: "light" | "dark"
	semantic: {
		success: string
		warning: string
		error: string
		info: string
	}
}

export interface TypographyTokens {
	fontFamily: string
	fallback: string
	/**
	 * The heading face, when it differs from the body. Optional and additive —
	 * foundations written before the wizard existed have only `fontFamily`, and
	 * everything that reads tokens treats the display pair as body-when-absent.
	 */
	displayFamily?: string
	displayFallback?: string
	scaleRatio: number
	baseSize: number
	scale: Record<string, number>
}

export interface SpacingTokens {
	baseUnit: 4 | 8
	scale: number[]
}

export interface RadiusTokens {
	character: "sharp" | "soft" | "round" | "pill"
	scale: number[]
}

export interface FoundationTokens {
	vibe: VibeDescriptor
	color: ColorTokens
	typography: TypographyTokens
	spacing: SpacingTokens
	radius: RadiusTokens
}

export interface PageMeta {
	id: string
	title: string
	type: string
	states: string[]
	tags: string[]
}

export interface FlowStep {
	page: string
	label?: string
	next: string[]
	onError?: string[]
}

export interface FlowDefinition {
	id: string
	name: string
	description?: string
	steps: FlowStep[]
	/** Set by the rendering shell when the flow file is corrupt/invalid. */
	invalid?: boolean
	error?: string
}

export interface SyncState {
	lastSyncedCommit: string | null
}

export type DesignContext = "implementation" | "design"

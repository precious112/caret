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
}

export interface SyncState {
	lastSyncedCommit: string | null
}

export type DesignContext = "implementation" | "design"

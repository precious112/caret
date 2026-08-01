export const WIZARD_STEPS = [
	{
		id: "vibe",
		title: "Vibe",
		description: "Describe the overall feel and personality of your design system.",
	},
	{
		id: "color",
		title: "Color",
		description: "Set your brand color and generate a full palette.",
	},
	{
		id: "typography",
		title: "Typography",
		description: "Choose your typeface and configure the type scale.",
	},
	{
		id: "spacing",
		title: "Spacing",
		description: "Define your spacing base unit and scale.",
	},
	{
		id: "radius",
		title: "Radius",
		description: "Set the corner rounding character for your design.",
	},
	{
		id: "review",
		title: "Review",
		description: "Review your foundation tokens before saving.",
	},
] as const

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"]

export const VIBE_TAGS = ["modern", "playful", "dense", "editorial", "enterprise", "minimal", "organic", "technical"] as const

export const NEUTRAL_CHARACTERS = ["cool", "warm", "true", "slight-tint"] as const
export type NeutralCharacter = (typeof NEUTRAL_CHARACTERS)[number]

export const RADIUS_CHARACTERS = ["sharp", "soft", "round", "pill"] as const
export type RadiusCharacter = (typeof RADIUS_CHARACTERS)[number]

export const TYPE_SCALE_RATIOS = [
	{ label: "Minor Second (1.067)", value: 1.067 },
	{ label: "Major Second (1.125)", value: 1.125 },
	{ label: "Minor Third (1.2)", value: 1.2 },
	{ label: "Major Third (1.25)", value: 1.25 },
	{ label: "Perfect Fourth (1.333)", value: 1.333 },
	{ label: "Augmented Fourth (1.414)", value: 1.414 },
	{ label: "Perfect Fifth (1.5)", value: 1.5 },
] as const

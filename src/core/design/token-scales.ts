/**
 * Derives full token scales from a single seed value.
 *
 * The wizard asks for one decision per dimension — a brand colour, a base size,
 * a spacing unit, a radius character — and expands each into the scale the
 * design layer actually uses. Keeping the derivation here (rather than asking an
 * agent for it) is what makes the same seed produce the same scale every time.
 */
export type TokenScaleType = "color" | "typography" | "spacing" | "radius"

export function generateTokenScale(
	type: TokenScaleType,
	seedValue: string,
	options: Record<string, unknown> = {},
): Record<string, string> {
	switch (type) {
		case "color":
			return generateColorScale(seedValue, options as { steps?: number })
		case "typography":
			return generateTypographyScale(seedValue, options as { ratio?: number })
		case "spacing":
			return generateSpacingScale(seedValue)
		case "radius":
			return generateRadiusScale(seedValue)
		default:
			throw new Error(`Unknown scale type: ${type}`)
	}
}

const COLOR_LABELS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]

function generateColorScale(seed: string, options: { steps?: number }): Record<string, string> {
	const steps = options.steps || COLOR_LABELS.length
	const hex = seed.replace("#", "")
	const r = Number.parseInt(hex.slice(0, 2), 16)
	const g = Number.parseInt(hex.slice(2, 4), 16)
	const b = Number.parseInt(hex.slice(4, 6), 16)

	const scale: Record<string, string> = {}

	for (let i = 0; i < Math.min(steps, COLOR_LABELS.length); i++) {
		const t = i / (COLOR_LABELS.length - 1)
		const lightness = 1 - t
		const sr = Math.round(r + (255 - r) * lightness * 0.85)
		const sg = Math.round(g + (255 - g) * lightness * 0.85)
		const sb = Math.round(b + (255 - b) * lightness * 0.85)

		if (t <= 0.5) {
			// Lighter half: tint the shifted colour toward white.
			const factor = 1 - t * 0.6
			scale[COLOR_LABELS[i]] = rgbToHex(
				Math.round(sr * factor + 255 * (1 - factor)),
				Math.round(sg * factor + 255 * (1 - factor)),
				Math.round(sb * factor + 255 * (1 - factor)),
			)
		} else {
			// Darker half: shade the original seed toward black.
			const factor = (t - 0.5) * 1.4
			scale[COLOR_LABELS[i]] = rgbToHex(
				Math.round(r * (1 - factor)),
				Math.round(g * (1 - factor)),
				Math.round(b * (1 - factor)),
			)
		}
	}

	return scale
}

function generateTypographyScale(baseSize: string, options: { ratio?: number }): Record<string, string> {
	const base = Number.parseFloat(baseSize) || 16
	const ratio = options.ratio || 1.25
	const labels = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]
	const baseIndex = labels.indexOf("base")

	const scale: Record<string, string> = {}
	for (let i = 0; i < labels.length; i++) {
		scale[labels[i]] = `${Math.round(base * ratio ** (i - baseIndex) * 100) / 100}px`
	}
	return scale
}

function generateSpacingScale(baseUnit: string): Record<string, string> {
	const base = Number.parseFloat(baseUnit) || 4
	const multipliers = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64]

	const scale: Record<string, string> = {}
	for (const m of multipliers) {
		scale[String(m)] = `${base * m}px`
	}
	return scale
}

function generateRadiusScale(character: string): Record<string, string> {
	const presets: Record<string, number[]> = {
		sharp: [0, 1, 2, 4, 6, 9999],
		soft: [0, 2, 4, 8, 12, 9999],
		round: [0, 4, 8, 12, 16, 9999],
		pill: [0, 4, 8, 16, 24, 9999],
	}
	const values = presets[character] || presets.soft
	const labels = ["none", "sm", "md", "lg", "xl", "full"]

	const scale: Record<string, string> = {}
	for (let i = 0; i < labels.length; i++) {
		scale[labels[i]] = values[i] === 9999 ? "9999px" : `${values[i]}px`
	}
	return scale
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, v))
	return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/**
 * `foundation.json` → the language a photograph prompt needs.
 *
 * This is the point the plan calls out as the first place the foundation
 * *produces* rather than describes, and it binds hardest here: a generated
 * photograph that fights the palette is worse than no photograph, because
 * unlike a wrong colour it cannot be corrected by editing a token.
 *
 * Deliberately words rather than hex codes. Image models handle "warm sand and
 * clay neutrals, nothing pure white" far better than "#d9cbb8", and the hex
 * would in any case be a lie — a photograph is not going to come back in the
 * palette, it is going to come back *compatible* with it. Naming the family,
 * the key and the temperature is the honest version of the request.
 */
import { hexToHsl } from "../palette"
import type { GeneratorPalette } from "../types"

/**
 * How the picture should be lit and keyed, from the project's surface.
 *
 * A dark project needs a low-key image or it punches a hole in the page; a
 * light one needs a high-key image or every section it appears in goes heavy.
 * This is the single most consequential sentence in the whole prompt.
 */
export function keyWords(palette: GeneratorPalette): string {
	return palette.mode === "dark"
		? "Low-key: deep shadows, a single soft light source, most of the frame in shadow. Nothing pure black."
		: "High-key: bright, open, softly lit, most of the frame light. Nothing pure white."
}

/** The colour family, named by the brand hue and the neutral tint. */
export function paletteWords(palette: GeneratorPalette): string {
	const brand = hexToHsl(palette.brand)
	const neutral = hexToHsl(palette.raised)

	const temperature =
		neutral.s < 0.02
			? "neutral greys with no colour cast"
			: isWarm(neutral.h)
				? "warm neutrals — sand, clay, oatmeal"
				: "cool neutrals — slate, stone, pale blue-grey"

	// The brand is named as an *accent that may appear*, never as the subject.
	// Asking a model for "a blue photograph" produces a blue filter over
	// everything, which is the most obvious tell there is.
	const accent =
		brand.s < 0.12
			? "no single accent colour"
			: `at most one small accent of ${hueName(brand.h)}, occupying a few percent of the frame if it appears at all`

	return `${temperature}; ${accent}. Muted, desaturated overall.`
}

/** Both sentences, in the order a prompt wants them. */
export function foundationWords(palette: GeneratorPalette): string {
	return `${keyWords(palette)} ${paletteWords(palette)}`
}

function isWarm(hue: number): boolean {
	// Reds through yellows, plus the far end of the wheel that reads as warm.
	return hue < 70 || hue > 330
}

/**
 * A hue as a word.
 *
 * Coarse on purpose: the bands are wide because the distinction that matters to
 * a photograph is "warm orange" versus "cool blue", and a finer vocabulary
 * would imply a precision the medium does not have.
 */
function hueName(hue: number): string {
	const wheel: Array<[number, string]> = [
		[15, "red"],
		[45, "orange"],
		[70, "yellow"],
		[160, "green"],
		[200, "teal"],
		[255, "blue"],
		[290, "violet"],
		[330, "magenta"],
		[360, "red"],
	]
	return wheel.find(([limit]) => hue < limit)?.[1] ?? "red"
}

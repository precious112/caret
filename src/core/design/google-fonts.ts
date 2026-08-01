/**
 * Typeface lookup for the foundation wizard.
 *
 * The bundled fallback list is not a degraded mode — it is a small curated set
 * that is always available with no key and no network, which matters because the
 * wizard must work offline and on first run. A Google Fonts API key only widens
 * the search.
 */
import { fetch } from "@/shared/net"

const GOOGLE_FONTS_API = "https://www.googleapis.com/webfonts/v1/webfonts"
const MAX_RESULTS = 30

export interface FontOption {
	family: string
	category: string
	variants: string[]
}

export interface SearchFontsOptions {
	/** The user's own Google Fonts API key, if they have configured one. */
	apiKey?: string
}

export async function searchGoogleFonts(query: string, options: SearchFontsOptions = {}): Promise<FontOption[]> {
	const needle = query.toLowerCase()
	const apiKey = options.apiKey?.trim() || process.env.GOOGLE_FONTS_API_KEY

	if (!apiKey) {
		return filterFonts(FALLBACK_FONTS, needle)
	}

	try {
		const response = await fetch(`${GOOGLE_FONTS_API}?key=${apiKey}&sort=popularity`)
		const data = (await response.json()) as { items?: FontOption[] }
		return filterFonts(data.items ?? [], needle)
	} catch {
		// A missing key, a rate limit or no network all land here. The wizard must
		// still show something pickable rather than an empty list.
		return filterFonts(FALLBACK_FONTS, needle)
	}
}

function filterFonts(fonts: FontOption[], needle: string): FontOption[] {
	const matched = needle ? fonts.filter((f) => f.family.toLowerCase().includes(needle)) : fonts
	return matched.slice(0, MAX_RESULTS).map((f) => ({
		family: f.family,
		category: f.category || "",
		variants: f.variants || [],
	}))
}

const FALLBACK_FONTS: FontOption[] = [
	{ family: "Inter", category: "sans-serif", variants: ["400", "500", "600", "700"] },
	{ family: "Roboto", category: "sans-serif", variants: ["300", "400", "500", "700"] },
	{ family: "Open Sans", category: "sans-serif", variants: ["300", "400", "600", "700"] },
	{ family: "Lato", category: "sans-serif", variants: ["300", "400", "700"] },
	{ family: "Montserrat", category: "sans-serif", variants: ["300", "400", "500", "600", "700"] },
	{ family: "Poppins", category: "sans-serif", variants: ["300", "400", "500", "600", "700"] },
	{ family: "Source Sans Pro", category: "sans-serif", variants: ["300", "400", "600", "700"] },
	{ family: "Nunito", category: "sans-serif", variants: ["300", "400", "600", "700"] },
	{ family: "Playfair Display", category: "serif", variants: ["400", "500", "600", "700"] },
	{ family: "Merriweather", category: "serif", variants: ["300", "400", "700"] },
	{ family: "Lora", category: "serif", variants: ["400", "500", "600", "700"] },
	{ family: "PT Serif", category: "serif", variants: ["400", "700"] },
	{ family: "Libre Baskerville", category: "serif", variants: ["400", "700"] },
	{ family: "JetBrains Mono", category: "monospace", variants: ["400", "500", "600", "700"] },
	{ family: "Fira Code", category: "monospace", variants: ["300", "400", "500", "600", "700"] },
	{ family: "Space Mono", category: "monospace", variants: ["400", "700"] },
	{ family: "IBM Plex Mono", category: "monospace", variants: ["300", "400", "500", "600", "700"] },
	{ family: "DM Sans", category: "sans-serif", variants: ["400", "500", "700"] },
	{ family: "Work Sans", category: "sans-serif", variants: ["300", "400", "500", "600", "700"] },
	{ family: "Raleway", category: "sans-serif", variants: ["300", "400", "500", "600", "700"] },
]

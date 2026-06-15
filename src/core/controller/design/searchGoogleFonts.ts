import { StringRequest } from "@shared/proto/cline/common"
import { GoogleFontsResponse } from "@shared/proto/cline/design"
import { fetch } from "@/shared/net"
import { Controller } from "../index"

const GOOGLE_FONTS_API = "https://www.googleapis.com/webfonts/v1/webfonts"

export async function searchGoogleFonts(controller: Controller, request: StringRequest): Promise<GoogleFontsResponse> {
	const query = request.value?.toLowerCase() || ""

	try {
		// Prefer the user's BYOK key from settings; fall back to a build-time env key.
		const apiKey =
			controller.stateManager.getGlobalSettingsKey("googleFontsApiKey")?.trim() || process.env.GOOGLE_FONTS_API_KEY
		let fonts: Array<{ family: string; category: string; variants: string[] }>

		if (apiKey) {
			const url = `${GOOGLE_FONTS_API}?key=${apiKey}&sort=popularity`
			const response = await fetch(url)
			const data = (await response.json()) as { items: Array<{ family: string; category: string; variants: string[] }> }
			fonts = data.items || []
		} else {
			fonts = FALLBACK_FONTS
		}

		const filtered = query ? fonts.filter((f) => f.family.toLowerCase().includes(query)).slice(0, 30) : fonts.slice(0, 30)

		return GoogleFontsResponse.create({
			fonts: filtered.map((f) => ({
				family: f.family,
				category: f.category || "",
				variants: f.variants || [],
			})),
		})
	} catch {
		return GoogleFontsResponse.create({
			fonts: FALLBACK_FONTS.filter((f) => f.family.toLowerCase().includes(query)).slice(0, 30),
		})
	}
}

const FALLBACK_FONTS = [
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

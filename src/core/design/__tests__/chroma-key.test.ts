import { describe, it } from "mocha"
import "should"

import { CHROMA_GREEN, CHROMA_MAGENTA, chooseKeyColor, keyOutBackground } from "../asset-library/raster/chroma-key"
import type { GeneratorPalette } from "../asset-library/types"

function palette(brand: string): GeneratorPalette {
	return { surface: "#ffffff", raised: "#f0f0f0", ink: "#111111", brand, brandQuiet: brand, mode: "light" }
}

/** A flat scene: `fill` everywhere, `subject` in a centred square of `side`. */
function scene(
	width: number,
	height: number,
	fill: [number, number, number],
	subject: [number, number, number] | null,
	side = 0,
): Uint8Array {
	const data = new Uint8Array(width * height * 4)
	const x0 = Math.floor((width - side) / 2)
	const y0 = Math.floor((height - side) / 2)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const inSubject = subject && x >= x0 && x < x0 + side && y >= y0 && y < y0 + side
			const [r, g, b] = inSubject ? subject : fill
			const i = (y * width + x) * 4
			data[i] = r
			data[i + 1] = g
			data[i + 2] = b
			data[i + 3] = 255
		}
	}
	return data
}

const GREEN: [number, number, number] = [0, 177, 64]
const RED: [number, number, number] = [200, 40, 30]

describe("the chroma key", () => {
	it("keys green unless the project's own brand is green", () => {
		chooseKeyColor(palette("#2563eb")).should.equal(CHROMA_GREEN)
		chooseKeyColor(palette("#b45309")).should.equal(CHROMA_GREEN)
		// A green-branded project's assets lean green — keying green would eat them.
		chooseKeyColor(palette("#16a34a")).should.equal(CHROMA_MAGENTA)
		// A grey brand has no hue worth avoiding.
		chooseKeyColor(palette("#6b7280")).should.equal(CHROMA_GREEN)
	})

	it("cuts the background and leaves the subject untouched", () => {
		const width = 40
		const height = 40
		const data = scene(width, height, GREEN, RED, 12)
		const result = keyOutBackground({ data, width, height, order: "rgba" }, CHROMA_GREEN.hex)

		result.ok.should.be.true()
		// Corner: background, gone entirely.
		data[3].should.equal(0)
		// Centre: the subject, byte-for-byte what it was.
		const centre = (20 * width + 20) * 4
		data[centre].should.equal(RED[0])
		data[centre + 1].should.equal(RED[1])
		data[centre + 2].should.equal(RED[2])
		data[centre + 3].should.equal(255)
		// Roughly the right amount went: the frame minus the 12×12 square.
		const cut = (result as { cut: number }).cut
		cut.should.be.above(0.85)
		cut.should.be.below(0.95)
	})

	it("tolerates the background being shaded, because chromaticity ignores brightness", () => {
		const width = 40
		const height = 40
		const data = scene(width, height, GREEN, RED, 12)
		// Darken the right half of the background by a third — the gentle falloff a
		// model paints onto even a "perfectly flat" colour.
		for (let y = 0; y < height; y++) {
			for (let x = 20; x < width; x++) {
				const i = (y * width + x) * 4
				if (data[i] === RED[0] && data[i + 1] === RED[1]) continue
				data[i] = Math.round(data[i] * 0.66)
				data[i + 1] = Math.round(data[i + 1] * 0.66)
				data[i + 2] = Math.round(data[i + 2] * 0.66)
			}
		}
		const result = keyOutBackground({ data, width, height, order: "rgba" }, CHROMA_GREEN.hex)
		result.ok.should.be.true()
		// A shaded background corner is still background.
		const shadedCorner = (2 * width + (width - 3)) * 4
		data[shadedCorner + 3].should.equal(0)
	})

	it("handles BGRA the way Electron bitmaps arrive", () => {
		const width = 40
		const height = 40
		// The same scene with channels swapped into BGRA.
		const data = scene(width, height, [GREEN[2], GREEN[1], GREEN[0]], [RED[2], RED[1], RED[0]], 12)
		const result = keyOutBackground({ data, width, height, order: "bgra" }, CHROMA_GREEN.hex)

		result.ok.should.be.true()
		data[3].should.equal(0)
		const centre = (20 * width + 20) * 4
		data[centre].should.equal(RED[2])
		data[centre + 2].should.equal(RED[0])
		data[centre + 3].should.equal(255)
	})

	it("refuses when the model ignored the background instruction", () => {
		const width = 40
		const height = 40
		const white = scene(width, height, [245, 245, 245], RED, 12)
		const result = keyOutBackground({ data: white, width, height, order: "rgba" }, CHROMA_GREEN.hex)

		result.ok.should.be.false()
		// The refusal carries the measured number, so the user is told what
		// actually came back rather than "keying failed".
		;(result as { reason: string }).reason.should.match(/\d+% of the border/)
	})

	it("refuses when the subject went with the background", () => {
		const width = 40
		const height = 40
		const empty = scene(width, height, GREEN, null)
		const result = keyOutBackground({ data: empty, width, height, order: "rgba" }, CHROMA_GREEN.hex)

		result.ok.should.be.false()
		;(result as { reason: string }).reason.should.containEql("the subject went with the background")
	})

	it("refuses when keying barely removed anything", () => {
		const width = 60
		const height = 60
		// A key-coloured border ring around a frame that is otherwise all subject:
		// the border agrees, but the "background" was never really there.
		const data = scene(width, height, GREEN, RED, 56)
		const result = keyOutBackground({ data, width, height, order: "rgba" }, CHROMA_GREEN.hex)

		result.ok.should.be.false()
		;(result as { reason: string }).reason.should.containEql("the background was not where it should be")
	})

	it("keys magenta the same way, for the projects whose palette is green", () => {
		const width = 40
		const height = 40
		const data = scene(width, height, [232, 0, 232], [40, 160, 60], 12)
		const result = keyOutBackground({ data, width, height, order: "rgba" }, CHROMA_MAGENTA.hex)

		result.ok.should.be.true()
		data[3].should.equal(0)
		const centre = (20 * width + 20) * 4
		data[centre + 3].should.equal(255)
	})
})

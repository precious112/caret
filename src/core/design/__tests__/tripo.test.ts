import { describe, it } from "mocha"
import "should"

import type { CodingBackend } from "../agent/backend"
import { NO_TRIPO_REASON, resolveTripoConfig } from "../asset-library/tripo/client"
import { decideOptimization, isRecommendedOptimizer, OPTIMIZATION_BOUNDS } from "../asset-library/tripo/optimize"

describe("the 3D lane's configuration", () => {
	it("prefers the stored key, falls back to the environment, and null is normal", () => {
		resolveTripoConfig({ apiKey: "tsk_stored", env: { TRIPO_API_KEY: "tsk_env" } })!.apiKey.should.equal("tsk_stored")
		resolveTripoConfig({ env: { TRIPO_API_KEY: "tsk_env" } })!.apiKey.should.equal("tsk_env")
		;(resolveTripoConfig({ env: {} }) === null).should.be.true()
	})

	it("explains the absence without making the whole feature sound locked", () => {
		NO_TRIPO_REASON.should.containEql("works without one")
	})
})

describe("recommended optimizer models", () => {
	it("matches the user's named set however a backend spells them", () => {
		// The list is the user's; the spellings are every backend's own.
		isRecommendedOptimizer("anthropic/claude-fable-5").should.be.true()
		isRecommendedOptimizer("openai/gpt-5.6-sol").should.be.true()
		isRecommendedOptimizer("GPT 5.6 Sol").should.be.true()
		isRecommendedOptimizer("moonshotai/kimi-k3-instruct").should.be.true()
		isRecommendedOptimizer("Kimi K3").should.be.true()
		isRecommendedOptimizer("zhipuai/glm-5.2").should.be.true()
		isRecommendedOptimizer("deepseek/deepseek-v4-flash").should.be.true()
	})

	it("does not light up on lookalikes", () => {
		isRecommendedOptimizer("gpt-4o").should.be.false()
		isRecommendedOptimizer("glm-4").should.be.false()
		isRecommendedOptimizer("kimi-k2").should.be.false()
		isRecommendedOptimizer("resolution-tool").should.be.false()
	})
})

describe("the optimization decision", () => {
	const fakeBackend = (value: unknown): CodingBackend =>
		({
			structured: async () => ({ value, emulated: true }),
		}) as unknown as CodingBackend

	it("clamps a face limit outside the published bounds", async () => {
		// Emulated backends parse rather than enforce, so schema-valid is a weaker
		// guarantee and the post-clamp is load-bearing, not belt-and-braces.
		const decision = await decideOptimization({
			backend: fakeBackend({ faceLimit: 500_000, textureSize: 1024, reason: "keep everything" }),
			workingDirectory: "/tmp",
			draftBytes: 4_000_000,
			intendedUse: "a decoration",
		})
		decision.faceLimit.should.equal(OPTIMIZATION_BOUNDS.faceLimit.max)
	})

	it("refuses an answer that is not usable rather than guessing one", async () => {
		await decideOptimization({
			backend: fakeBackend({ faceLimit: "lots", textureSize: 700, reason: 3 }),
			workingDirectory: "/tmp",
			draftBytes: 1_000_000,
			intendedUse: "a decoration",
		}).should.be.rejectedWith(/not usable/)
	})
})

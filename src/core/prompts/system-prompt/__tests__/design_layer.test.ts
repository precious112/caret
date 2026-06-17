/**
 * Design-layer prompt gating tests.
 *
 * The DESIGN LAYER instruction block (components/design_layer.ts) must be
 * injected into the system prompt ONLY when designContext === "design", and
 * omitted in code/implementation mode (or when unset). This guards the
 * design/code toggle's effect on the prompt — see runSync forcing Code context
 * during design→app sync.
 */

import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { getSystemPrompt } from "../index"
import type { SystemPromptContext } from "../types"

const DESIGN_MARKER = "DESIGN LAYER"

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	clineWebToolsEnabled: true,
	subagentsEnabled: true,
	mcpHub: { getServers: () => [] } as unknown as McpHub,
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	browserSettings: { viewport: { width: 1280, height: 720 } },
	isTesting: true,
	providerInfo: {
		providerId: "test",
		model: { id: "fast", info: { supportsPromptCache: false } },
		mode: "act" as const,
	},
	enableNativeToolCalls: false,
}

describe("Design layer prompt gating", () => {
	it("includes the DESIGN LAYER block when designContext is 'design'", async () => {
		const { systemPrompt } = await getSystemPrompt({ ...baseContext, designContext: "design" })
		expect(systemPrompt).to.include(DESIGN_MARKER)
	})

	it("omits the DESIGN LAYER block when designContext is 'implementation' (code mode)", async () => {
		const { systemPrompt } = await getSystemPrompt({ ...baseContext, designContext: "implementation" })
		expect(systemPrompt).to.not.include(DESIGN_MARKER)
	})

	it("omits the DESIGN LAYER block when designContext is unset", async () => {
		const { systemPrompt } = await getSystemPrompt({ ...baseContext, designContext: undefined })
		expect(systemPrompt).to.not.include(DESIGN_MARKER)
	})
})

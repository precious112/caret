import { EmptyRequest } from "@shared/proto/cline/common"
import { FoundationTokensResponse } from "@shared/proto/cline/design"
import { readFoundationTokens } from "@/core/design/tokens"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from "../index"

export async function getFoundationTokens(controller: Controller, _: EmptyRequest): Promise<FoundationTokensResponse> {
	const workspacePath = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
	const tokens = await readFoundationTokens(workspacePath)
	return FoundationTokensResponse.create({
		tokensJson: JSON.stringify(tokens),
	})
}

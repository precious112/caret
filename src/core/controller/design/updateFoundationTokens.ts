import { Empty } from "@shared/proto/cline/common"
import { UpdateFoundationTokensRequest } from "@shared/proto/cline/design"
import { validateFoundationTokens, writeFoundationTokens } from "@/core/design/tokens"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from "../index"

export async function updateFoundationTokens(controller: Controller, request: UpdateFoundationTokensRequest): Promise<Empty> {
	const workspacePath = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
	const tokens = JSON.parse(request.tokensJson)
	if (!validateFoundationTokens(tokens)) {
		throw new Error("Invalid foundation tokens: object does not match expected schema")
	}
	await writeFoundationTokens(workspacePath, tokens)
	return Empty.create()
}

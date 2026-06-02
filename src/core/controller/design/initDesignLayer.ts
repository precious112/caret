import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { ensureCaretDirectoryExists } from "@/core/design/scaffold"
import { getCwd, getDesktopDir } from "@/utils/path"
import { Controller } from "../index"

export async function initDesignLayer(controller: Controller, _: EmptyRequest): Promise<Empty> {
	const workspacePath = controller.getWorkspaceManager()?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
	await ensureCaretDirectoryExists(workspacePath)
	return Empty.create()
}

import { EmptyRequest, String } from "@shared/proto/cline/common"
import { getRenderingShellPort } from "@/core/design/rendering-shell"
import { Controller } from "../index"

export async function getRenderingShellUrl(_controller: Controller, _: EmptyRequest): Promise<String> {
	const port = getRenderingShellPort()
	const value = port ? `http://localhost:${port}` : ""
	return String.create({ value })
}

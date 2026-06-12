import { EmptyRequest } from "@shared/proto/cline/common"
import { SyncDesignResponse } from "@shared/proto/cline/design"
import { runSync } from "@/core/design/sync/sync-orchestrator"
import { Controller } from "../index"

export async function syncDesignToApp(controller: Controller, _: EmptyRequest): Promise<SyncDesignResponse> {
	const result = await runSync(controller)
	return SyncDesignResponse.create({
		status: result.status,
		message: result.message,
		shown: result.diffStats?.shown ?? 0,
		total: result.diffStats?.total ?? 0,
		summarized: result.diffStats?.summarized ?? 0,
	})
}

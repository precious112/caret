import { SyncDesignRequest, SyncDesignResponse } from "@shared/proto/cline/design"
import { runSync } from "@/core/design/sync/sync-orchestrator"
import { Controller } from "../index"

export async function syncDesignToApp(controller: Controller, request: SyncDesignRequest): Promise<SyncDesignResponse> {
	const result = await runSync(controller, { autoFix: request.autoFix })
	return SyncDesignResponse.create({
		status: result.status,
		message: result.message,
		fixLabel: result.fixLabel ?? "",
		shown: 0,
		total: result.changedCount ?? 0,
		summarized: 0,
	})
}

import { SyncDesignRequest } from "@shared/proto/cline/design"
import { useState } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/common/AlertDialog"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { DesignServiceClient } from "@/services/grpc-client"

// Statuses that need a confirm before Caret mutates git (init / scoped commit).
const FIXABLE = new Set(["needs-git-setup", "needs-design-commit"])

interface DialogState {
	message: string
	/** Present only for a fixable status — re-invoke with autoFix=true on confirm. */
	fixLabel?: string
}

/**
 * "Sync design → app" affordance for the chat input. Rendered as a codicon next
 * to the send button (out of the model-picker row, which is space-constrained).
 * Shown whenever a `.caret/` design layer exists — in both implementation and
 * design mode (the intended workflow syncs from implementation mode). Renders
 * only the icon + a portaled dialog, so it consumes no row layout space.
 */
export const SyncDesignButton = () => {
	const { hasDesignLayer } = useExtensionState()
	const [dialog, setDialog] = useState<DialogState | null>(null)
	const [busy, setBusy] = useState(false)

	if (!hasDesignLayer) {
		return null
	}

	const sync = async (autoFix: boolean) => {
		setBusy(true)
		try {
			const r = await DesignServiceClient.syncDesignToApp(SyncDesignRequest.create({ autoFix }))
			if (FIXABLE.has(r.status) && r.fixLabel) {
				setDialog({ message: r.message, fixLabel: r.fixLabel })
			} else if (r.status !== "started") {
				// Terminal info (up-to-date / git-not-installed / …); a started sync
				// renders as a task in the chat and needs no dialog.
				setDialog({ message: r.message })
			}
		} catch (e) {
			setDialog({ message: e instanceof Error ? e.message : "Sync failed" })
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<span
				aria-label="Sync design to app"
				className={cn("input-icon-button", { disabled: busy }, "codicon codicon-sync text-sm mr-2")}
				data-testid="sync-design-button"
				onClick={() => !busy && sync(false)}
				title="Sync design to app"
			/>

			<AlertDialog onOpenChange={(open) => !open && setDialog(null)} open={dialog !== null}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Sync design → app</AlertDialogTitle>
						<AlertDialogDescription>{dialog?.message}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setDialog(null)}>
							{dialog?.fixLabel ? "Cancel" : "Close"}
						</AlertDialogCancel>
						{dialog?.fixLabel && (
							<AlertDialogAction
								onClick={() => {
									setDialog(null)
									void sync(true)
								}}>
								{dialog.fixLabel}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

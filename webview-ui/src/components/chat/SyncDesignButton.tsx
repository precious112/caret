import { EmptyRequest } from "@shared/proto/cline/common"
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
 * "Sync design → app" control in the chat footer (Row 1, beside the Design/Code
 * toggle). Always visible, but only clickable in Design mode — greyed/disabled
 * in Code mode. Gated on `designContext` (always present in webview state), not
 * the async `.caret/` cache, so it's reliably visible and correctly enabled.
 */
export const SyncDesignButton = () => {
	const { designContext } = useExtensionState()
	const [dialog, setDialog] = useState<DialogState | null>(null)
	const [busy, setBusy] = useState(false)

	const disabled = busy || designContext !== "design"

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

	const rollback = async () => {
		setBusy(true)
		try {
			const r = await DesignServiceClient.rollbackSync(EmptyRequest.create({}))
			setDialog({ message: r.message })
		} catch (e) {
			setDialog({ message: e instanceof Error ? e.message : "Roll back failed" })
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<button
				aria-label="Sync design to app"
				className={cn(
					"flex items-center gap-1 bg-transparent border-0 p-0 text-xs select-none",
					disabled
						? "text-(--vscode-descriptionForeground) opacity-50 cursor-not-allowed"
						: "text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground) cursor-pointer",
				)}
				disabled={disabled}
				onClick={() => !disabled && sync(false)}
				title={designContext === "design" ? "Sync design to app" : "Switch to Design mode to sync design → app"}
				type="button">
				<span className="codicon codicon-sync text-sm" />
				Sync
			</button>

			<button
				aria-label="Roll back last sync"
				className={cn(
					"flex items-center gap-1 bg-transparent border-0 p-0 text-xs select-none",
					disabled
						? "text-(--vscode-descriptionForeground) opacity-50 cursor-not-allowed"
						: "text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground) cursor-pointer",
				)}
				disabled={disabled}
				onClick={() => !disabled && rollback()}
				title={
					designContext === "design"
						? "Roll back the last sync (restore app + sync state to before it)"
						: "Switch to Design mode to roll back a sync"
				}
				type="button">
				<span className="codicon codicon-discard text-sm" />
				Undo sync
			</button>

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

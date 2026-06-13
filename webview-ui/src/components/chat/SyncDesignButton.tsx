import { SyncDesignRequest } from "@shared/proto/cline/design"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { RefreshCwIcon } from "lucide-react"
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
import { DesignServiceClient } from "@/services/grpc-client"

// Statuses that need a confirm before Caret mutates git (init / scoped commit).
const FIXABLE = new Set(["needs-git-setup", "needs-design-commit"])

/**
 * "Sync design → app" button for the chat input. Shown whenever a `.caret/`
 * design layer exists (in both implementation and design mode — the intended
 * workflow syncs from implementation mode). Drives the git-state confirm flow
 * in-webview via AlertDialog; a started sync renders as a task in the chat.
 */
export const SyncDesignButton = () => {
	const { hasDesignLayer } = useExtensionState()
	const [confirm, setConfirm] = useState<{ message: string; fixLabel: string } | null>(null)
	const [status, setStatus] = useState<string>("")
	const [busy, setBusy] = useState(false)

	if (!hasDesignLayer) {
		return null
	}

	const sync = async (autoFix: boolean) => {
		setBusy(true)
		setStatus("")
		try {
			const r = await DesignServiceClient.syncDesignToApp(SyncDesignRequest.create({ autoFix }))
			if (FIXABLE.has(r.status) && r.fixLabel) {
				setConfirm({ message: r.message, fixLabel: r.fixLabel })
				return
			}
			// started → the sync task appears in the chat; other statuses are terminal.
			if (r.status !== "started") {
				setStatus(r.message)
			}
		} catch (e) {
			setStatus(e instanceof Error ? e.message : "Sync failed")
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<VSCodeButton
				appearance="icon"
				aria-label="Sync design to app"
				className="p-0 m-0 flex items-center"
				disabled={busy}
				onClick={() => sync(false)}
				title="Sync design to app">
				<RefreshCwIcon size={13} />
			</VSCodeButton>

			{status && (
				<div className="text-foreground" style={{ fontSize: "11px", marginTop: "4px", opacity: 0.85 }}>
					{status}
				</div>
			)}

			<AlertDialog onOpenChange={(open) => !open && setConfirm(null)} open={confirm !== null}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Sync design → app</AlertDialogTitle>
						<AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirm(null)}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirm(null)
								void sync(true)
							}}>
							{confirm?.fixLabel}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const ClineAccountInfoCard = () => {
	const { clineUser } = useClineAuth()
	const { navigateToAccount } = useExtensionState()

	const user = clineUser || undefined

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				// Caret accounts are not yet available — the sign-up entry point is disabled.
				<div>
					<VSCodeButton className="mt-0" disabled title="Caret accounts are not yet available">
						Sign Up with Caret
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}

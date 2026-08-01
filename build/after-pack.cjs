/**
 * Ad-hoc signs the macOS bundle after electron-builder has assembled it.
 *
 * This is not optional on Apple Silicon: an arm64 Mach-O with no valid signature
 * will not execute at all, and the failure surfaces to the user as "Caret is
 * damaged and can't be opened" — which reads as a corrupt download and sends
 * them to re-download a file that was fine.
 *
 * electron-builder's `identity: null` means *skip signing*, not *ad-hoc sign*.
 * Electron's prebuilt binary arrives linker-signed, but injecting the app's own
 * files invalidates that, so the bundle has to be re-signed here. Verified with
 * `codesign --verify --deep --strict`, which is what catches the difference
 * between "a signature is present" and "the signature is valid".
 *
 * When a real Developer ID is available, `CSC_LINK`/`CSC_KEY_PASSWORD` take over
 * through electron-builder's normal path and this hook steps aside — so adding
 * the certificate later is a secrets change, not a pipeline rebuild.
 */
const { execFileSync } = require("child_process")
const path = require("path")

exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return

	// A real identity is configured — let electron-builder do the signing.
	if (process.env.CSC_LINK || process.env.CSC_NAME) return

	const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

	// Deep, force, ad-hoc ("-"). Deep is required because the Electron
	// Framework and the helper apps are nested bundles with their own
	// signatures, all invalidated by the same repack.
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" })

	// Fail the build rather than ship something that will not launch.
	execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" })

	console.log(`  • ad-hoc signed and verified  ${appPath}`)
}

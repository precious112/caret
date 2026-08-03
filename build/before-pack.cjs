/**
 * Stages the OpenCode binary Caret ships with.
 *
 * Caret spawns its backend from inside the app bundle, never from `PATH`, so the
 * binary has to be in `extraResources` — and the right one has to be chosen per
 * target, not per build machine.
 *
 * Two things make that non-obvious:
 *
 * - The `opencode-ai` package's own postinstall hardlinks whichever binary suits
 *   the **build machine**, so copying `node_modules/opencode-ai/bin` cross-compiles
 *   the wrong architecture without complaining.
 * - For x64 the choice is a **runtime CPU** property, not a build one: the plain
 *   x64 build needs AVX2 and the `-baseline` build does not. Since a packaged app
 *   cannot know its future CPU, x64 ships baseline, which runs everywhere.
 *
 * The platform packages are downloaded on demand rather than added as
 * dependencies, so a developer install pulls one 145MB binary instead of twelve.
 */
const child_process = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const VERSION = require("../package.json").devDependencies["opencode-ai"]

const PLATFORMS = { darwin: "darwin", win32: "windows", linux: "linux" }

/** electron-builder's `Arch` enum, which arrives as a number. */
const ARCHES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }

exports.default = async function beforePack(context) {
	const platform = PLATFORMS[context.electronPlatformName] ?? context.electronPlatformName
	const arch = ARCHES[context.arch] ?? String(context.arch)

	if (arch === "universal") {
		// A universal build would need both binaries merged with `lipo`, which the
		// backend adapter has no way to select between at runtime. Fail loudly
		// rather than shipping an app whose backend silently never starts.
		throw new Error("Caret cannot build a universal macOS bundle: package arm64 and x64 separately.")
	}

	// x64 always takes the baseline build — see the note above.
	const packageName = `opencode-${platform}-${arch}${arch === "x64" ? "-baseline" : ""}`
	const binaryName = platform === "windows" ? "opencode.exe" : "opencode"

	const staging = path.join(__dirname, "opencode")
	fs.rmSync(staging, { recursive: true, force: true })
	fs.mkdirSync(staging, { recursive: true })

	const source = resolveBinary(packageName, binaryName)
	const target = path.join(staging, binaryName)
	fs.copyFileSync(source, target)
	fs.chmodSync(target, 0o755)

	console.log(`[before-pack] staged ${packageName}@${VERSION} for ${platform}-${arch}`)
}

/** Finds the platform package locally, downloading it into a temp tree if absent. */
function resolveBinary(packageName, binaryName) {
	const local = path.join(__dirname, "..", "node_modules", packageName, "bin", binaryName)
	if (fs.existsSync(local)) return local

	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "caret-opencode-"))
	child_process.execFileSync(
		"npm",
		["install", "--no-save", "--no-audit", "--no-fund", "--prefix", scratch, `${packageName}@${VERSION}`],
		{ stdio: "inherit" },
	)

	const downloaded = path.join(scratch, "node_modules", packageName, "bin", binaryName)
	if (!fs.existsSync(downloaded)) {
		throw new Error(`${packageName}@${VERSION} did not contain bin/${binaryName}`)
	}
	return downloaded
}

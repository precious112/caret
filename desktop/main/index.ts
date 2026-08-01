/**
 * Caret's main process.
 *
 * Owns the app lifecycle, the window manager and the crash surfaces. Everything
 * project-specific lives on a {@link ProjectWindow}; this file only decides what
 * exists and when.
 */
import { app, dialog, shell } from "electron"
import * as path from "path"
import { fileURLToPath } from "url"

import { Logger } from "../../src/shared/services/Logger"
import { registerIpcHandlers } from "./ipc"
import { closeLauncherWindow, hasLauncherWindow, type LauncherWindowOptions, openLauncherWindow } from "./launcher-window"
import { buildMenu } from "./menu"
import { loadPrefs } from "./prefs"
import { WindowManager } from "./window-manager"

const here = path.dirname(fileURLToPath(import.meta.url))

// Logger's default is silent — nothing subscribes in a bare Node process — so
// wire it to stdout before anything else can try to report a failure.
Logger.subscribe((line) => console.log(`[caret] ${line}`))

/**
 * One instance owns the recents list and the session file. A second instance
 * would race both, and its windows would write over the first's idea of what is
 * open, so the second is asked to hand its arguments over and exit.
 */
if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	void main()
}

async function main(): Promise<void> {
	installCrashHandlers()

	await app.whenReady()
	loadPrefs()

	const launcherOptions: LauncherWindowOptions = {
		chromeEntry: resolveChromeEntry(),
		preloadChrome: path.join(here, "../preload/index.mjs"),
	}

	const windows = new WindowManager({
		chromeEntry: launcherOptions.chromeEntry,
		preloadChrome: launcherOptions.preloadChrome,
		preloadCanvas: path.join(here, "../preload/canvas.mjs"),
		onFirstProjectOpened: () => closeLauncherWindow(),
	})

	registerIpcHandlers(windows)
	buildMenu(windows)

	app.on("second-instance", (_event, argv) => {
		const fromArgv = projectPathFromArgv(argv)
		if (fromArgv) {
			void windows.open(fromArgv)
		} else if (windows.isEmpty()) {
			openLauncherWindow(launcherOptions)
		} else {
			windows.list()[0]?.focus()
		}
	})

	// Blocks external navigation and new windows everywhere. The canvas renders
	// agent-generated code, and a stray `window.open` or a link to a remote page
	// would put untrusted content in a view with a preload attached.
	app.on("web-contents-created", (_event, contents) => {
		contents.setWindowOpenHandler(({ url }) => {
			void shell.openExternal(url)
			return { action: "deny" }
		})
		contents.on("will-navigate", (event, url) => {
			if (!isLocal(url)) {
				event.preventDefault()
				void shell.openExternal(url)
			}
		})
	})

	// `caret ~/some/project` should open that project, which the first version of
	// this ignored — it only looked at argv for a *second* instance.
	const requested = projectPathFromArgv(process.argv)
	const opened = requested ? await windows.open(requested) : null

	const restored = opened ? 1 : await windows.restoreSession()
	if (restored === 0) {
		openLauncherWindow(launcherOptions)
	} else {
		closeLauncherWindow()
	}

	app.on("activate", () => {
		if (windows.isEmpty() && !hasLauncherWindow()) openLauncherWindow(launcherOptions)
	})

	app.on("window-all-closed", () => {
		// macOS convention is to stay resident with no windows; elsewhere, quitting
		// is what people expect.
		if (process.platform !== "darwin") app.quit()
	})

	app.on("before-quit", () => {
		void windows.closeAll()
	})
}

/**
 * The first argument that looks like a directory path.
 *
 * Electron passes its own flags and, in a packaged app, the app path itself, so
 * this cannot just take `argv[1]`.
 */
function projectPathFromArgv(argv: string[]): string | null {
	for (const arg of argv.slice(1)) {
		if (arg.startsWith("-")) continue
		if (arg.endsWith(".js") || arg.endsWith(".asar")) continue
		if (path.isAbsolute(arg)) return arg
	}
	return null
}

function resolveChromeEntry(): { url?: string; file?: string } {
	const devServer = process.env.ELECTRON_RENDERER_URL
	return devServer ? { url: devServer } : { file: path.join(here, "../renderer/index.html") }
}

function isLocal(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url)
		return protocol === "file:" || hostname === "localhost" || hostname === "127.0.0.1"
	} catch {
		return false
	}
}

/**
 * Without VS Code's notification host, an unhandled rejection in the main
 * process is completely invisible — the app simply stops working. Surface it.
 */
function installCrashHandlers(): void {
	process.on("uncaughtException", (err) => {
		Logger.error("[main] uncaught exception:", err)
		showCrash("Caret hit an unexpected error", err)
	})
	process.on("unhandledRejection", (reason) => {
		Logger.error("[main] unhandled rejection:", reason)
	})
}

function showCrash(title: string, err: unknown): void {
	const detail = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err)
	if (app.isReady()) {
		void dialog.showMessageBox({ type: "error", title, message: title, detail, buttons: ["OK"] })
	} else {
		dialog.showErrorBox(title, detail)
	}
}

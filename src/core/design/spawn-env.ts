/**
 * The environment for spawning system tools (node, npm).
 *
 * A macOS app launched from Finder inherits launchd's minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), which contains neither /opt/homebrew/bin
 * (Homebrew on Apple Silicon) nor /usr/local/bin (Homebrew on Intel, and the
 * node installer) — so the very node and npm the design shell depends on are
 * invisible exactly when the app is started the normal way. Development never
 * hits this because a shell-launched process carries the login PATH.
 *
 * Windows GUI launches inherit the user PATH, so no augmentation is needed
 * there.
 */
import * as path from "path"

const UNIX_TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]

export function systemSpawnEnv(): NodeJS.ProcessEnv {
	if (process.platform === "win32") return process.env
	const current = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
	const missing = UNIX_TOOL_DIRS.filter((dir) => !current.includes(dir))
	if (missing.length === 0) return process.env
	return { ...process.env, PATH: [...current, ...missing].join(path.delimiter) }
}

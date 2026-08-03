/**
 * Preload for the app-chrome renderer.
 *
 * Exposes exactly the channels declared in `desktop/shared/ipc.ts` and nothing
 * else — no `ipcRenderer` object, no Node globals. `contextIsolation` stays on,
 * so the renderer can only reach main through this surface.
 */
import { contextBridge, ipcRenderer } from "electron"

import type { CaretBridge, IpcEventChannel, IpcRequestChannel } from "../shared/ipc"

/**
 * Channels the renderer may call. An allowlist rather than a passthrough,
 * because the renderer is where a compromised dependency would land first and
 * main can touch the filesystem and spawn processes.
 */
const REQUEST_CHANNELS: readonly IpcRequestChannel[] = [
	"project:pickFolder",
	"project:open",
	"project:close",
	"project:recents",
	"project:forgetRecent",
	"project:state",
	"tokens:read",
	"tokens:write",
	"tokens:generateScale",
	"fonts:search",
	"pages:list",
	"assets:list",
	"assets:add",
	"assets:retag",
	"assets:describe",
	"assets:remove",
	"assets:pickFiles",
	"sync:now",
	"sync:rollback",
	"sync:markSynced",
	"agent:clientConfigs",
	"prefs:get",
	"prefs:set",
	"canvas:message",
	"canvas:setBounds",
	"canvas:setVisible",
	"notification:respond",
	"interview:respond",
	"interview:library",
	"interview:pending",
]

/**
 * Event channels the renderer may subscribe to.
 *
 * Adding a channel to `IpcEvents` is not enough — this list is the allowlist and
 * `on()` **throws** for anything absent from it. A throw inside a component's
 * effect unmounts the entire React tree, so a channel added to the types and
 * forgotten here does not degrade, it blanks the window.
 */
const EVENT_CHANNELS: readonly IpcEventChannel[] = [
	"project:stateChanged",
	"canvas:message",
	"notification:show",
	"interview:prompt",
	"assets:changed",
	"log",
]

const bridge: CaretBridge = {
	invoke(channel, ...args) {
		if (!REQUEST_CHANNELS.includes(channel)) {
			return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
		}
		return ipcRenderer.invoke(channel, ...args) as any
	},

	on(channel, listener) {
		if (!EVENT_CHANNELS.includes(channel)) {
			throw new Error(`Unknown IPC event channel: ${channel}`)
		}
		const wrapped = (_event: unknown, ...args: unknown[]) => (listener as (...a: unknown[]) => void)(...args)
		ipcRenderer.on(channel, wrapped)
		return () => {
			ipcRenderer.off(channel, wrapped)
		}
	},

	platform: process.platform,
}

contextBridge.exposeInMainWorld("caret", bridge)

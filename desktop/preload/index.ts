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
 * The allowlists, written as **exhaustive maps** rather than arrays.
 *
 * An allowlist, because the renderer is where a compromised dependency lands
 * first and main can touch the filesystem and spawn processes. A map keyed by
 * the channel union, because an array literal cannot be checked for
 * completeness: a channel added to `IpcEvents` and forgotten here used to
 * compile, ship, and then **blank the window** — `on()` throws, the throw
 * happens inside a component effect, and React unmounts the whole tree. Now the
 * same omission is a type error in `npm run check-types`.
 *
 * Set a channel to `false` to deliberately withhold it from the renderer.
 */
const REQUEST_CHANNELS: Record<IpcRequestChannel, boolean> = {
	"project:pickFolder": true,
	"project:open": true,
	"project:close": true,
	"project:recents": true,
	"project:forgetRecent": true,
	"project:state": true,
	"tokens:read": true,
	"tokens:write": true,
	"tokens:generateScale": true,
	"fonts:search": true,
	"pages:list": true,
	"assets:list": true,
	"assets:add": true,
	"assets:retag": true,
	"assets:describe": true,
	"assets:remove": true,
	"assets:pickFiles": true,
	"sync:now": true,
	"sync:rollback": true,
	"sync:markSynced": true,
	"agent:clientConfigs": true,
	"agent:state": true,
	"agent:send": true,
	"agent:abort": true,
	"agent:permission": true,
	"agent:approval": true,
	"agent:reset": true,
	"agent:backends": true,
	"agent:selectBackend": true,
	"agent:models": true,
	"agent:sessions": true,
	"agent:replay": true,
	"prefs:get": true,
	"prefs:set": true,
	"canvas:message": true,
	"canvas:setBounds": true,
	"canvas:setVisible": true,
	"notification:respond": true,
	"interview:respond": true,
	"interview:library": true,
	"interview:pending": true,
	"foundation:resume": true,
	"foundation:start": true,
	"foundation:answer": true,
	"foundation:back": true,
	"foundation:commit": true,
	"foundation:abandon": true,
	"wizard:resume": true,
	"wizard:start": true,
	"wizard:answer": true,
	"wizard:finishNow": true,
	"wizard:retry": true,
	"wizard:back": true,
	"wizard:commit": true,
	"wizard:abandon": true,
}

const EVENT_CHANNELS: Record<IpcEventChannel, boolean> = {
	"project:stateChanged": true,
	"canvas:message": true,
	"notification:show": true,
	"interview:prompt": true,
	"assets:changed": true,
	"agent:state": true,
	log: true,
}

const bridge: CaretBridge = {
	invoke(channel, ...args) {
		if (!REQUEST_CHANNELS[channel]) {
			return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
		}
		return ipcRenderer.invoke(channel, ...args) as any
	},

	on(channel, listener) {
		if (!EVENT_CHANNELS[channel]) {
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

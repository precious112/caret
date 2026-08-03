/**
 * The one strip of Caret chrome that is always visible.
 *
 * It carries the four things the user needs to know at a glance — which project,
 * whether the preview is up, whether an agent is connected, and how to sync —
 * and nothing else. Everything competing for space here competes with the design
 * work below it.
 */

import { Blocks, Images, Palette, RefreshCw } from "lucide-react"
import { forwardRef } from "react"

import type { ProjectState } from "../../../shared/ipc"
import type { Surface } from "../App"
import { invoke, platform } from "../ipc"
import { cn } from "../lib/utils"

interface TopBarProps {
	project: ProjectState
	surface: Surface
	onSurfaceChange(surface: Surface): void
}

export const TopBar = forwardRef<HTMLDivElement, TopBarProps>(function TopBar({ project, surface, onSurfaceChange }, ref) {
	return (
		<div
			className={cn(
				"titlebar-drag flex h-11 shrink-0 items-center gap-2 border-b border-shell-border bg-shell-panel px-3",
				// Leaves room for the macOS traffic lights, which sit over the content
				// under `titleBarStyle: hiddenInset`.
				platform === "darwin" && "pl-20",
			)}
			data-testid="top-bar"
			ref={ref}>
			<span className="truncate text-[13px] font-medium">{project.name}</span>

			<StatusDot label={project.canvasUrl ? "Preview running" : "Starting preview…"} ok={project.canvasUrl !== null} />

			<div className="flex-1" />

			<div className="titlebar-nodrag flex items-center gap-1">
				<TopBarButton
					active={surface === "foundation"}
					icon={<Palette size={14} />}
					label="Foundation"
					onClick={() => onSurfaceChange(surface === "foundation" ? "canvas" : "foundation")}
				/>

				<TopBarButton
					active={surface === "assets"}
					icon={<Images size={14} />}
					label="Assets"
					onClick={() => onSurfaceChange(surface === "assets" ? "canvas" : "assets")}
				/>

				<TopBarButton
					active={surface === "agent"}
					icon={<Blocks size={14} />}
					label={project.agentConnected ? "Agent connected" : "Connect agent"}
					onClick={() => onSurfaceChange(surface === "agent" ? "canvas" : "agent")}
					tone={project.agentConnected ? "ok" : "warn"}
				/>

				<TopBarButton icon={<RefreshCw size={14} />} label="Sync" onClick={() => invoke("sync:now", project.path)} />
			</div>
		</div>
	)
})

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
	return (
		<span className="flex items-center gap-1.5 text-[11px] text-shell-muted" title={label}>
			<span aria-hidden className={cn("size-1.5 rounded-full", ok ? "bg-emerald-400" : "animate-pulse bg-amber-400")} />
			{label}
		</span>
	)
}

interface TopBarButtonProps {
	icon: React.ReactNode
	label: string
	onClick(): void
	active?: boolean
	tone?: "ok" | "warn"
}

function TopBarButton({ icon, label, onClick, active, tone }: TopBarButtonProps) {
	return (
		<button
			className={cn(
				"flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
				"hover:bg-white/5",
				active && "bg-caret-accent/15 text-caret-accent",
				tone === "warn" && !active && "text-amber-300",
				tone === "ok" && !active && "text-emerald-300",
			)}
			onClick={onClick}
			type="button">
			{icon}
			{label}
		</button>
	)
}

/**
 * The app chrome.
 *
 * Deliberately thin. The canvas is a native view sitting under this document,
 * not a React tree, so everything here is the frame around it: which project is
 * open, whether an agent is connected, and the full-window surfaces (foundation
 * wizard, agent setup, preferences) that temporarily take the canvas's place.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectState } from "../../shared/ipc"
import { invoke, on } from "./ipc"
import { AgentPanel } from "./views/AgentPanel"
import { FoundationView } from "./views/FoundationView"
import { NotificationStack } from "./views/NotificationStack"
import { ProjectPicker } from "./views/ProjectPicker"
import { TopBar } from "./views/TopBar"

/** Which full-window surface is covering the canvas, if any. */
export type Surface = "canvas" | "foundation" | "agent"

export function App() {
	const [project, setProject] = useState<ProjectState | null>(null)
	const [surface, setSurface] = useState<Surface>("canvas")
	const topBarRef = useRef<HTMLDivElement>(null)

	// Main pushes project state whenever Vite comes up, an agent connects, or
	// tokens change — the renderer never polls for it.
	useEffect(() => on("project:stateChanged", (next) => setProject(next)), [])

	// The canvas view is positioned by main, which cannot measure the top bar.
	// Report its height whenever it changes, including on window resize.
	useEffect(() => {
		if (!project) return
		const element = topBarRef.current
		if (!element) return

		const report = () => invoke("canvas:setBounds", project.path, element.getBoundingClientRect().height)
		report()

		const observer = new ResizeObserver(report)
		observer.observe(element)
		return () => observer.disconnect()
	}, [project])

	useEffect(() => {
		if (project) invoke("canvas:setVisible", project.path, surface === "canvas")
	}, [project, surface])

	// A project with no foundation gets the wizard first. Generating pages before
	// tokens exist means re-styling all of them later, which is the exact rework
	// the design layer is supposed to prevent.
	useEffect(() => {
		if (project && !project.hasFoundation) setSurface("foundation")
	}, [project])

	const openProject = useCallback(async (projectPath: string) => {
		const state = await invoke("project:open", projectPath)
		if (state) setProject(state)
	}, [])

	if (!project) {
		return (
			<>
				<ProjectPicker onOpen={openProject} />
				<NotificationStack />
			</>
		)
	}

	return (
		<div className="flex h-full flex-col">
			<TopBar onSurfaceChange={setSurface} project={project} ref={topBarRef} surface={surface} />

			{surface === "foundation" && <FoundationView onDone={() => setSurface("canvas")} project={project} />}
			{surface === "agent" && <AgentPanel onClose={() => setSurface("canvas")} project={project} />}

			<NotificationStack />
		</div>
	)
}

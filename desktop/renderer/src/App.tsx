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
	/**
	 * True while an agent is blocked on a question. Nothing may navigate away
	 * from the foundation surface until it is answered — the token editor closes
	 * itself on a timer after saving, and that timer landing mid-interview would
	 * silently remove the screen the agent is waiting on.
	 *
	 * Held in a ref rather than state because the callers that need vetoing are
	 * exactly the ones holding a *stale* callback: a `setTimeout` scheduled before
	 * the interview began captured an older closure, so a dependency-based guard
	 * reads `false` and lets it through. The ref is always current, and nothing
	 * renders from this, so state would only add a needless re-render.
	 */
	const interviewPendingRef = useRef(false)

	const markInterviewPending = useCallback((pending: boolean) => {
		interviewPendingRef.current = pending
	}, [])
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

	// An agent asking the user a direct question has to reach them. Left on the
	// canvas they would see nothing at all while the agent waited indefinitely,
	// so an arriving prompt takes them to it.
	useEffect(
		() =>
			on("interview:prompt", () => {
				markInterviewPending(true)
				setSurface("foundation")
			}),
		[],
	)

	// A project with no foundation gets the wizard first. Generating pages before
	// tokens exist means re-styling all of them later, which is the exact rework
	// the design layer is supposed to prevent.
	useEffect(() => {
		if (project && !project.hasFoundation) setSurface("foundation")
	}, [project])

	/** Surface changes that a pending interview is allowed to veto. */
	const requestSurface = useCallback((next: Surface) => {
		if (interviewPendingRef.current && next !== "foundation") return
		setSurface(next)
	}, [])

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
			<TopBar onSurfaceChange={requestSurface} project={project} ref={topBarRef} surface={surface} />

			{surface === "foundation" && (
				<FoundationView
					onDone={() => requestSurface("canvas")}
					onInterviewAnswered={() => markInterviewPending(false)}
					project={project}
				/>
			)}
			{surface === "agent" && <AgentPanel onClose={() => requestSurface("canvas")} project={project} />}

			<NotificationStack />
		</div>
	)
}

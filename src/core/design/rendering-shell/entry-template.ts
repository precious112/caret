import * as fs from "fs/promises"
import * as path from "path"

import { generateCanvasFiles } from "./canvas-template"

export async function generateEntryFiles(caretDir: string): Promise<void> {
	// index.html
	const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Caret Design Preview</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/main.tsx"></script>
</body>
</html>
`

	// main.tsx — mounts the canvas app, or a single page if ?page= is set (for iframe embedding)
	const mainTsx = `import React from "react"
import { createRoot } from "react-dom/client"
import "./global.css"
import "react-grab/styles.css"

const params = new URLSearchParams(window.location.search)
const isolatedPageId = params.get("page")
const mode = params.get("mode")

if (isolatedPageId && mode === "focused") {
  document.body.style.background = "#ffffff"
  document.body.style.overflow = "auto"

  import("react-grab").then(() => {
    return import("./lib/caret-grab-plugin")
  }).then(() => {
    return Promise.all([
      import("virtual:caret-router"),
      import("./lib/canvas/OverlayPainter"),
      import("./lib/canvas/CaretStateContext"),
      import("./lib/bridge"),
      import("./lib/canvas/canvas.css"),
    ])
  }).then(([routerMod, overlayMod, stateMod, bridgeMod]) => {
    const { routes } = routerMod as any
    const { OverlayPainter } = overlayMod as any
    const { CaretStateProvider } = stateMod as any
    const { bridge } = bridgeMod as any
    const route = routes.find((r: any) => r.name === isolatedPageId)
    if (!route) return

    const PageComponent = route.component

    function FocusedApp() {
      const [paintMode, setPaintMode] = React.useState(false)
      const [currentState, setCurrentState] = React.useState("default")

      React.useEffect(() => {
        const filePath = "pages/" + isolatedPageId + "/index.tsx"
        ;(window as any).__CARET_FOCUSED_PAGE__ = { pageId: isolatedPageId, filePath }
        bridge.send({ type: "page-focused", payload: { filePath } })

        const hmrHandler = () => {
          bridge.send({ type: "page-focused", payload: { filePath } })
        }
        if (import.meta.hot) {
          import.meta.hot.on("vite:afterUpdate", hmrHandler)
        }

        const rg = (window as any).__REACT_GRAB__
        if (rg) rg.activate()

        const msgHandler = (e: MessageEvent) => {
          if (e.data?.type === "set-state") {
            setCurrentState(e.data.value)
          }
        }
        window.addEventListener("message", msgHandler)

        return () => {
          if (rg) rg.deactivate()
          ;(window as any).__CARET_FOCUSED_PAGE__ = null
          if (import.meta.hot) import.meta.hot.off("vite:afterUpdate", hmrHandler)
          window.removeEventListener("message", msgHandler)
        }
      }, [])

      return (
        <CaretStateProvider value={currentState}>
          <div className="caret-focused">
            <button onClick={() => window.parent.postMessage({ source: "caret-page-iframe", type: "back" }, "*")} className="caret-focused-fab" title="Back to canvas">←</button>
            <button
              onClick={() => setPaintMode(!paintMode)}
              className={"caret-focused-fab caret-focused-paint-btn" + (paintMode ? " active" : "")}
              title={paintMode ? "Exit paint mode" : "Paint to edit"}
            >
              ✎
            </button>
            <button onClick={() => window.parent.postMessage({ source: "caret-page-iframe", type: "simulate" }, "*")} className="caret-focused-fab caret-focused-sim-btn" title="Simulate">▶</button>
            <div className="caret-focused-content">
              <PageComponent />
            </div>
            {paintMode && <OverlayPainter onClose={() => setPaintMode(false)} />}
          </div>
        </CaretStateProvider>
      )
    }

    createRoot(document.getElementById("root")!).render(<FocusedApp />)
  }).catch((err) => {
    console.error("[caret] Failed to initialize focused mode:", err)
  })
} else if (isolatedPageId) {
  document.body.style.background = "#ffffff"
  document.body.style.overflow = "auto"
  import("virtual:caret-router").then(({ routes }: any) => {
    const route = routes.find((r: any) => r.name === isolatedPageId)
    if (route) {
      const PageComponent = route.component
      createRoot(document.getElementById("root")!).render(<PageComponent />)
    }
  })
} else {
  import("react-grab").then(() => {
    return import("./lib/caret-grab-plugin")
  }).then(() => {
    import("./lib/canvas/CanvasApp").then(({ CanvasApp }) => {
      createRoot(document.getElementById("root")!).render(<CanvasApp />)
    })
  }).catch((err) => {
    console.error("[caret] Failed to initialize react-grab:", err)
    import("./lib/canvas/CanvasApp").then(({ CanvasApp }) => {
      createRoot(document.getElementById("root")!).render(<CanvasApp />)
    })
  })
}
`

	// global.css — Tailwind v4 + Caret overrides
	const globalCss = `@import "tailwindcss";

@source "./pages/**/*.tsx";
@source "./components/**/*.tsx";
@source "./layouts/**/*.tsx";
@source "./lib/**/*.tsx";

:root {
  --caret-font-family: system-ui, sans-serif;
  --caret-font-base: 16px;
}

body {
  font-family: var(--caret-font-family);
  font-size: var(--caret-font-base);
  line-height: 1.5;
  color: #1f2937;
  background: #0a0a0a;
  overflow: hidden;
}
`

	// Write core files
	await fs.writeFile(path.join(caretDir, "index.html"), indexHtml)
	await fs.writeFile(path.join(caretDir, "main.tsx"), mainTsx)
	await fs.writeFile(path.join(caretDir, "global.css"), globalCss)

	// Ensure pages directory exists
	await fs.mkdir(path.join(caretDir, "pages"), { recursive: true })

	// Generate canvas component files
	await generateCanvasFiles(caretDir)
}

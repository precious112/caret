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
	// NOTE: react-grab/styles.css must NOT be imported here. react-grab injects
	// its own styles into its shadow root at runtime; the document-level sheet
	// styles nothing but ships ~200 unlayered Tailwind-named utility classes
	// (.hidden, .block, .flex, ...) that beat the page's layered Tailwind
	// utilities in the cascade — permanently hiding any "hidden md:block"
	// responsive pattern.
	const mainTsx = `import React from "react"
import { createRoot } from "react-dom/client"
import "./global.css"

const params = new URLSearchParams(window.location.search)
const isolatedPageId = params.get("page")
const mode = params.get("mode")

if (isolatedPageId && mode === "focused") {
  const flog = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: "[focused] " + msg } }, "*")
  flog("loading for page: " + isolatedPageId)
  document.body.style.background = "#ffffff"
  document.body.style.overflow = "auto"

  import("react-grab").then(() => {
    flog("react-grab loaded")
    return import("./lib/caret-grab-plugin")
  }).then(() => {
    flog("caret-grab-plugin loaded, loading remaining modules...")
    return Promise.all([
      import("virtual:caret-router"),
      import("./lib/canvas/OverlayPainter"),
      import("./lib/canvas/CaretStateContext"),
      import("./lib/bridge"),
      import("./lib/canvas/canvas.css"),
    ])
  }).then(([routerMod, overlayMod, stateMod, bridgeMod]) => {
    flog("all modules loaded")
    const { routes } = routerMod as any
    const { OverlayPainter } = overlayMod as any
    const { CaretStateProvider } = stateMod as any
    const { bridge } = bridgeMod as any
    flog("routes available: " + JSON.stringify(routes.map((r: any) => r.name)))
    const route = routes.find((r: any) => r.name === isolatedPageId)
    if (!route) {
      flog("ERROR: route not found for page: " + isolatedPageId)
      document.getElementById("root")!.innerHTML =
        '<div style="padding:20px;color:#f87171;font-family:monospace;font-size:13px">' +
        '<h3 style="color:#fca5a5">Route not found</h3>' +
        '<p>Page "' + isolatedPageId + '" not found in routes.</p></div>'
      return
    }
    flog("route found, rendering FocusedApp")

    const PageComponent = route.component

    function FocusedApp() {
      const [paintMode, setPaintMode] = React.useState(false)
      const [currentState, setCurrentState] = React.useState("default")

      // Sample the rendered background behind the floating buttons and switch
      // them to a dark style when the page underneath is light.
      React.useEffect(() => {
        // Returns perceived lightness 0..1 + alpha. Handles rgb()/rgba() and the
        // oklch()/oklab() values Tailwind v4 emits (their first component is
        // perceptual lightness, which is exactly what we need).
        const parseLuminance = (value: string | null): { lum: number; a: number } | null => {
          if (!value) return null
          const open = value.indexOf("(")
          const close = value.lastIndexOf(")")
          if (open === -1 || close === -1) return null
          const body = value.slice(open + 1, close)
          if (value.indexOf("rgb") === 0) {
            const parts = body.split(",").map(s => parseFloat(s))
            if (parts.length < 3 || parts.slice(0, 3).some(n => isNaN(n))) return null
            return { lum: (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255, a: parts.length > 3 ? parts[3] : 1 }
          }
          if (value.indexOf("oklch") === 0 || value.indexOf("oklab") === 0) {
            const slash = body.indexOf("/")
            const main = (slash === -1 ? body : body.slice(0, slash)).split(" ").filter(s => s.length > 0)
            if (main.length === 0) return null
            let l = parseFloat(main[0])
            if (main[0].indexOf("%") !== -1) l = l / 100
            if (isNaN(l)) return null
            const a = slash === -1 ? 1 : parseFloat(body.slice(slash + 1))
            return { lum: l, a: isNaN(a) ? 1 : a }
          }
          return null
        }
        // Walk the first-child chain from <body> (the elements painted at the
        // top-left, where the buttons sit) and take the deepest opaque
        // background. Hit-testing (elementsFromPoint) is useless here: active
        // react-grab puts the page content behind pointer-events: none.
        const isOwnUi = (el: Element) =>
          el.classList?.contains("caret-focused-fab") ||
          el.hasAttribute?.("data-react-grab") ||
          (typeof el.className === "string" && el.className.indexOf("caret-overlay") !== -1)
        const detect = () => {
          try {
            let found: number | null = null
            let el: HTMLElement | null = document.body
            let depth = 0
            while (el && depth < 40) {
              const c = parseLuminance(window.getComputedStyle(el).backgroundColor)
              if (c && c.a > 0.5) {
                // Only count real backdrops, not small widgets (logos, badges)
                // the first-child chain may descend into.
                const rect = el.getBoundingClientRect()
                if (el === document.body || (rect.width >= 200 && rect.height >= 200)) found = c.lum
              }
              let next: HTMLElement | null = null
              for (const child of Array.from(el.children)) {
                if (!isOwnUi(child)) { next = child as HTMLElement; break }
              }
              el = next
              depth++
            }
            if (found !== null) {
              // Toggle a class on the shell root instead of going through React
              // state: the root's className prop never changes, so React leaves
              // externally-added classes alone across re-renders.
              const shell = document.querySelector(".caret-focused")
              if (shell) shell.classList.toggle("fabs-on-light", found > 0.6)
            }
          } catch {}
        }
        detect()
        const t1 = setTimeout(detect, 400)
        const t2 = setTimeout(detect, 1500)
        let raf = 0
        const onScroll = () => {
          if (raf) return
          raf = requestAnimationFrame(() => { raf = 0; detect() })
        }
        document.addEventListener("scroll", onScroll, { passive: true, capture: true })
        if (import.meta.hot) import.meta.hot.on("vite:afterUpdate", detect)
        return () => {
          clearTimeout(t1)
          clearTimeout(t2)
          if (raf) cancelAnimationFrame(raf)
          document.removeEventListener("scroll", onScroll, { capture: true })
          if (import.meta.hot) import.meta.hot.off("vite:afterUpdate", detect)
        }
      }, [currentState])

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
        bridge.send({ type: "log", payload: { message: "[focused] React Grab available: " + !!rg } })
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
    flog("FAILED: " + String(err))
    document.getElementById("root")!.innerHTML =
      '<div style="padding:20px;color:#f87171;font-family:monospace;font-size:13px">' +
      '<h3 style="color:#fca5a5">Focused mode failed to load</h3>' +
      '<pre style="white-space:pre-wrap">' + String(err) + '</pre></div>'
  })
} else if (isolatedPageId) {
  document.body.style.background = "#ffffff"
  document.body.style.overflow = "auto"

  // Failures must be readable inside a canvas thumbnail (scaled to ~0.26),
  // hence the very large type. A blank white box is indistinguishable from a
  // blank page and hides bad AI output.
  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const showPageError = (title: string, detail: string) => {
    document.getElementById("root")!.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:48px;background:#fff5f5;color:#b91c1c;font-family:system-ui,sans-serif;text-align:center">' +
      '<div style="font-size:96px;line-height:1">⚠</div>' +
      '<div style="font-size:48px;font-weight:700;margin:24px 0 16px">' + escapeHtml(title) + '</div>' +
      '<div style="font-size:26px;color:#7f1d1d;max-width:900px;word-break:break-word">' + escapeHtml(detail) + '</div>' +
      '</div>'
  }
  window.addEventListener("error", (e) => {
    showPageError("Page crashed", String(e.message || e.error || "Unknown runtime error"))
  })

  import("virtual:caret-router").then(({ routes }: any) => {
    const route = routes.find((r: any) => r.name === isolatedPageId)
    if (!route) {
      showPageError("Page not found", "pages/" + isolatedPageId + "/index.tsx is missing or failed to compile")
      return
    }
    const PageComponent = route.component
    createRoot(document.getElementById("root")!).render(<PageComponent />)
  }).catch((err) => {
    showPageError("Page failed to load", String(err))
  })
} else {
  // Canvas mode deliberately does NOT load react-grab: the editable page lives
  // in the mode=focused iframe with its own instance. A second instance here
  // overlays the canvas document, can only ever "select" the iframe, and its
  // toolbar hijacks AI-edit prompts (which carry no screenshot).
  import("./lib/canvas/CanvasApp").then(({ CanvasApp }) => {
    createRoot(document.getElementById("root")!).render(<CanvasApp />)
  })
}
`

	// global.css — Tailwind v4 + Caret overrides
	// source(none) disables Tailwind's automatic content detection, which would
	// otherwise scan the whole .caret dir — its Vite plugin then force-reloads every
	// client whenever any scanned file (e.g. flows/*.flow.json) changes.
	const globalCss = `@import "tailwindcss" source(none);

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

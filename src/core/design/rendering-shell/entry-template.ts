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

if (isolatedPageId) {
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

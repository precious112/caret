import * as fs from "fs/promises"
import * as path from "path"

export async function generateViteConfig(caretDir: string): Promise<void> {
	const configContent = `import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { resolve, join } from "path"
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"

// Directory-based routing plugin with page watching
function caretRouterPlugin() {
  const pagesDir = resolve(__dirname, "pages")

  function buildModule() {
    if (!existsSync(pagesDir)) {
      return "export const routes = []\\nexport const pageMetas = []"
    }
    const allDirs = readdirSync(pagesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    // A page dir without index.tsx is broken AI output. Importing it would
    // break this whole module (and with it every page on the canvas), so only
    // import intact pages and mark the rest so the canvas can flag them.
    const pages = allDirs.filter(p => existsSync(join(pagesDir, p, "index.tsx")))
    const broken = allDirs.filter(p => !existsSync(join(pagesDir, p, "index.tsx")))

    const imports = pages.map((p, i) => \`import Page\${i} from "./pages/\${p}/index.tsx"\`).join("\\n")
    const routeEntries = pages.map((p, i) => \`  { path: "/\${p}", component: Page\${i}, name: "\${p}" }\`).join(",\\n")

    const metas = allDirs.map(p => {
      const isBroken = broken.includes(p)
      try {
        const metaPath = join(pagesDir, p, "meta.json")
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
        return JSON.stringify({ ...meta, id: meta.id || p, ...(isBroken ? { broken: true } : {}) })
      } catch {
        return JSON.stringify({ id: p, title: p, type: "page", states: [], tags: [], ...(isBroken ? { broken: true } : {}) })
      }
    })
    const metaEntries = metas.map(m => \`  \${m}\`).join(",\\n")

    return \`\${imports}\\nexport const routes = [\\n\${routeEntries}\\n]\\nexport const pageMetas = [\\n\${metaEntries}\\n]\`
  }

  return {
    name: "caret-router",
    resolveId(id) {
      if (id === "virtual:caret-router") return "\\0virtual:caret-router"
      return null
    },
    load(id) {
      if (id === "\\0virtual:caret-router") return buildModule()
      return null
    },
    configureServer(server) {
      server.watcher.on("addDir", (p) => {
        if (p.startsWith(pagesDir) && p !== pagesDir) {
          const mod = server.moduleGraph.getModuleById("\\0virtual:caret-router")
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: "custom", event: "caret:pages-changed" })
        }
      })
      server.watcher.on("unlinkDir", (p) => {
        if (p.startsWith(pagesDir) && p !== pagesDir) {
          const mod = server.moduleGraph.getModuleById("\\0virtual:caret-router")
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: "custom", event: "caret:pages-changed" })
        }
      })
      server.watcher.on("change", (p) => {
        if (p.endsWith("meta.json") && p.includes(pagesDir)) {
          server.ws.send({ type: "custom", event: "caret:pages-changed" })
        }
      })
      // index.tsx appearing/disappearing changes which pages are importable —
      // without this, a deleted page file never invalidates the router module.
      const handleIndexFile = (p) => {
        if (p.startsWith(pagesDir) && p.endsWith("index.tsx")) {
          const mod = server.moduleGraph.getModuleById("\\0virtual:caret-router")
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: "custom", event: "caret:pages-changed" })
        }
      }
      server.watcher.on("add", handleIndexFile)
      server.watcher.on("unlink", handleIndexFile)
    },
  }
}

// Virtual module for foundation tokens
function caretTokensPlugin() {
  const tokensPath = resolve(__dirname, "tokens/foundation.json")
  return {
    name: "caret-tokens",
    resolveId(id) {
      if (id === "virtual:caret-tokens") return "\\0virtual:caret-tokens"
      return null
    },
    load(id) {
      if (id === "\\0virtual:caret-tokens") {
        try {
          const content = readFileSync(tokensPath, "utf-8")
          return \`export default \${content}\`
        } catch {
          return "export default {}"
        }
      }
      return null
    },
    handleHotUpdate({ file, server }) {
      if (file === tokensPath) {
        const mod = server.moduleGraph.getModuleById("\\0virtual:caret-tokens")
        if (mod) {
          server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: "full-reload" })
          server.ws.send({ type: "custom", event: "caret:tokens-changed" })
        }
      }
    },
  }
}

// Reads flow files, replacing corrupt/invalid ones with visible placeholder
// entries instead of silently dropping them — a flow vanishing without signal
// reads as data loss, while an "invalid" chip points at the broken file.
function readFlowsForServing(flowsDir) {
  if (!existsSync(flowsDir)) return []
  let files = []
  try { files = readdirSync(flowsDir).filter(f => f.endsWith(".flow.json")) } catch { return [] }
  const isValidFlowShape = (flow) =>
    !!flow && typeof flow === "object" &&
    typeof flow.id === "string" && typeof flow.name === "string" && Array.isArray(flow.steps) &&
    flow.steps.every(s => s && typeof s === "object" && typeof s.page === "string" && Array.isArray(s.next) && (s.onError === undefined || Array.isArray(s.onError)))
  return files.map(f => {
    try {
      const flow = JSON.parse(readFileSync(join(flowsDir, f), "utf-8"))
      if (!isValidFlowShape(flow)) {
        return { id: "invalid:" + f, name: f, steps: [], invalid: true, error: "Invalid flow shape — needs id, name and steps[] with page/next" }
      }
      return flow
    } catch (e) {
      return { id: "invalid:" + f, name: f, steps: [], invalid: true, error: String(e) }
    }
  })
}

// Virtual module for flow definitions
function caretFlowsPlugin() {
  const flowsDir = resolve(__dirname, "flows")

  function buildModule() {
    try {
      return "export default " + JSON.stringify(readFlowsForServing(flowsDir))
    } catch {
      return "export default []"
    }
  }

  return {
    name: "caret-flows",
    resolveId(id) {
      if (id === "virtual:caret-flows") return "\\0virtual:caret-flows"
      return null
    },
    load(id) {
      if (id === "\\0virtual:caret-flows") return buildModule()
      return null
    },
    configureServer(server) {
      if (existsSync(flowsDir)) server.watcher.add(flowsDir)
      const handleFlowChange = (p) => {
        if (p.endsWith(".flow.json")) {
          server.ws.send({ type: "custom", event: "caret:flows-changed" })
        }
      }
      server.watcher.on("change", handleFlowChange)
      server.watcher.on("add", handleFlowChange)
      server.watcher.on("unlink", handleFlowChange)
    },
  }
}

// Screenshot + pages-meta + canvas-layout API middleware
function caretApiPlugin() {
  const thumbnailsDir = resolve(__dirname, "thumbnails")
  const pagesDir = resolve(__dirname, "pages")
  const layoutPath = resolve(__dirname, "canvas-layout.json")

  return {
    name: "caret-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__caret/")) return next()

        // Image proxy for cross-origin screenshot capture
        if (req.method === "GET" && req.url.startsWith("/__caret/image-proxy?")) {
          const params = new URL(req.url, "http://localhost").searchParams
          const imageUrl = params.get("url")
          if (!imageUrl) { res.statusCode = 400; res.end("missing url"); return }
          try {
            const resp = await fetch(imageUrl)
            if (!resp.ok) { res.statusCode = resp.status; res.end("fetch failed"); return }
            const buffer = Buffer.from(await resp.arrayBuffer())
            res.setHeader("Content-Type", resp.headers.get("content-type") || "image/png")
            res.setHeader("Cache-Control", "public, max-age=3600")
            res.end(buffer)
          } catch (e) {
            res.statusCode = 502
            res.end(String(e))
          }
          return
        }

        // GET/PUT /__caret/canvas-layout
        if (req.url === "/__caret/canvas-layout") {
          if (req.method === "GET") {
            try {
              const data = existsSync(layoutPath) ? readFileSync(layoutPath, "utf-8") : "{}"
              res.setHeader("Content-Type", "application/json")
              res.end(data)
            } catch {
              res.setHeader("Content-Type", "application/json")
              res.end("{}")
            }
            return
          }
          if (req.method === "PUT") {
            let body = ""
            req.on("data", chunk => { body += chunk })
            req.on("end", () => {
              try {
                writeFileSync(layoutPath, body)
                res.statusCode = 200
                res.end("ok")
              } catch (e) {
                res.statusCode = 500
                res.end(String(e))
              }
            })
            return
          }
        }

        // GET /__caret/pages-meta
        if (req.method === "GET" && req.url === "/__caret/pages-meta") {
          try {
            const pages = existsSync(pagesDir)
              ? readdirSync(pagesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
              : []
            const metas = pages.map(p => {
              const isBroken = !existsSync(join(pagesDir, p, "index.tsx"))
              let meta
              try {
                meta = JSON.parse(readFileSync(join(pagesDir, p, "meta.json"), "utf-8"))
                meta.id = meta.id || p
              } catch {
                meta = { id: p, title: p, type: "page", states: [], tags: [] }
              }
              if (isBroken) meta.broken = true
              return meta
            })
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(metas))
          } catch {
            res.statusCode = 500
            res.end("[]")
          }
          return
        }

        // GET /__caret/flows-meta
        if (req.method === "GET" && req.url === "/__caret/flows-meta") {
          const flowsDir = resolve(__dirname, "flows")
          try {
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(readFlowsForServing(flowsDir)))
          } catch {
            res.statusCode = 500
            res.end("[]")
          }
          return
        }

        // Screenshot endpoints: /__caret/screenshots/:pageId
        const screenshotMatch = req.url.match(/^\\/__caret\\/screenshots\\/([^?/]+)/)
        if (!screenshotMatch) return next()
        const pageId = decodeURIComponent(screenshotMatch[1])
        const filePath = join(thumbnailsDir, \`\${pageId}.png\`)

        if (req.method === "POST") {
          let body = ""
          req.on("data", chunk => { body += chunk })
          req.on("end", () => {
            try {
              const { dataUrl } = JSON.parse(body)
              const base64 = dataUrl.replace(/^data:image\\/png;base64,/, "")
              mkdirSync(thumbnailsDir, { recursive: true })
              writeFileSync(filePath, Buffer.from(base64, "base64"))
              res.statusCode = 200
              res.end("ok")
            } catch (e) {
              res.statusCode = 500
              res.end(String(e))
            }
          })
          return
        }

        if (req.method === "GET") {
          try {
            if (!existsSync(filePath)) {
              res.statusCode = 404
              res.end("not found")
              return
            }
            const data = readFileSync(filePath)
            res.setHeader("Content-Type", "image/png")
            res.setHeader("Cache-Control", "no-cache")
            res.end(data)
          } catch {
            res.statusCode = 500
            res.end("error")
          }
          return
        }

        next()
      })

      // Watch thumbnails dir for changes
      server.watcher.add(thumbnailsDir)
      server.watcher.on("change", (p) => {
        if (p.startsWith(thumbnailsDir) && p.endsWith(".png")) {
          const pageId = p.slice(thumbnailsDir.length + 1).replace(".png", "")
          server.ws.send({ type: "custom", event: "caret:thumbnail-updated", data: { pageId } })
        }
      })
    },
  }
}

// Captures SWC's __source arg from jsxDEV calls into a global WeakMap.
// SWC passes {fileName, lineNumber, columnNumber} as the 5th arg to jsxDEV.
// React 19 ignores it, but we intercept it for exact source locations.
function caretSourceCapturePlugin() {
  return {
    name: "caret-source-capture",
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (!id.endsWith(".tsx") && !id.endsWith(".jsx")) return null
      // SWC emits: import { jsxDEV as _jsxDEV } from "react/jsx-dev-runtime"
      const importRe = /import\\s*\\{\\s*jsxDEV\\s+as\\s+(\\w+)\\s*\\}\\s*from\\s*["']react\\/jsx-dev-runtime["']/
      const match = code.match(importRe)
      if (!match) return null
      const localName = match[1]
      // Replace the import with a wrapped version
      const wrapped = code.replace(
        importRe,
        \`import { jsxDEV as __origJsxDEV__ } from "react/jsx-dev-runtime";\\n\` +
        \`const \${localName} = (t,p,k,s,src,self) => { if(src&&p&&typeof p==="object") (window.__caretSourceMap||(window.__caretSourceMap=new WeakMap())).set(p,src); return __origJsxDEV__(t,p,k,s,src,self) };\`
      )
      return { code: wrapped, map: null }
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), react(), caretSourceCapturePlugin(), caretRouterPlugin(), caretTokensPlugin(), caretFlowsPlugin(), caretApiPlugin()],
  server: {
    host: "localhost",
    strictPort: false,
  },
  resolve: {
    alias: {
      "@caret": resolve(__dirname),
    },
  },
})
`

	await fs.writeFile(path.join(caretDir, "vite.config.ts"), configContent)
}

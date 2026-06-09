import * as fs from "fs/promises"
import * as path from "path"

import { dedent } from "./template-utils"

export async function generateCanvasFiles(caretDir: string): Promise<void> {
	const libDir = path.join(caretDir, "lib")
	const canvasDir = path.join(libDir, "canvas")

	await fs.mkdir(canvasDir, { recursive: true })

	await Promise.all([
		fs.writeFile(path.join(canvasDir, "types.ts"), generateTypes()),
		fs.writeFile(path.join(canvasDir, "CanvasApp.tsx"), generateCanvasApp()),
		fs.writeFile(path.join(canvasDir, "CanvasView.tsx"), generateCanvasView()),
		fs.writeFile(path.join(canvasDir, "PageThumbnail.tsx"), generatePageThumbnail()),
		fs.writeFile(path.join(canvasDir, "FocusedPageView.tsx"), generateFocusedPageView()),
		fs.writeFile(path.join(canvasDir, "ErrorBoundary.tsx"), generateErrorBoundary()),
		fs.writeFile(path.join(canvasDir, "OverlayPainter.tsx"), generateOverlayPainter()),
		fs.writeFile(path.join(canvasDir, "CaretStateContext.tsx"), generateCaretStateContext()),
		fs.writeFile(path.join(canvasDir, "CaretNavigator.tsx"), generateCaretNavigator()),
		fs.writeFile(path.join(canvasDir, "SimulationView.tsx"), generateSimulationView()),
		fs.writeFile(path.join(canvasDir, "canvas.css"), generateCanvasCSS()),
		fs.writeFile(path.join(libDir, "bridge.ts"), generateBridge()),
		fs.writeFile(path.join(libDir, "caret-grab-plugin.ts"), generateCaretGrabPlugin()),
	])
}

function generateTypes(): string {
	return dedent`
		export interface PageInfo {
		  id: string
		  title: string
		  type: string
		  states: string[]
		  tags: string[]
		}

		export interface CanvasTransform {
		  x: number
		  y: number
		  scale: number
		}

		export type LayoutMode = "auto" | "manual"

		export interface CanvasLayout {
		  mode: LayoutMode
		  positions: Record<string, { x: number; y: number }>
		}

		export type ViewportPreset = "desktop-1440" | "desktop-1280" | "tablet-768" | "mobile-390" | "mobile-375"

		export const VIEWPORT_PRESETS: Record<ViewportPreset, { name: string; width: number; icon: string }> = {
		  "desktop-1440": { name: "Desktop", width: 1440, icon: "🖥" },
		  "desktop-1280": { name: "Laptop", width: 1280, icon: "💻" },
		  "tablet-768":   { name: "Tablet", width: 768, icon: "📱" },
		  "mobile-390":   { name: "iPhone 14", width: 390, icon: "📱" },
		  "mobile-375":   { name: "iPhone SE", width: 375, icon: "📱" },
		}

		export interface FlowStep {
		  page: string
		  label?: string
		  next: string[]
		  onError?: string[]
		}

		export interface FlowDefinition {
		  id: string
		  name: string
		  description?: string
		  steps: FlowStep[]
		}
	`
}

function generateCanvasApp(): string {
	return dedent`
		import React, { useState, useEffect, useCallback, useRef } from "react"
		import { routes, pageMetas } from "virtual:caret-router"
		import { CanvasView } from "./CanvasView"
		import { FocusedPageView } from "./FocusedPageView"
		import { ErrorBoundary } from "./ErrorBoundary"
		import { SimulationView } from "./SimulationView"
		import type { PageInfo, ViewportPreset, FlowDefinition } from "./types"
		import "./canvas.css"

		export function CanvasApp() {
		  const [mode, setMode] = useState<"canvas" | "focused" | "simulation">("canvas")
		  const [focusedPageId, setFocusedPageId] = useState<string | null>(null)
		  const [pages, setPages] = useState<PageInfo[]>(pageMetas || [])
		  const [viewport, setViewport] = useState<ViewportPreset>("desktop-1440")
		  const [flows, setFlows] = useState<FlowDefinition[]>([])

		  const log = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: msg } }, "*")

		  useEffect(() => {
		    log("CanvasApp mounted, fetching flows-meta...")
		    fetch("/__caret/flows-meta")
		      .then(r => { log("flows-meta response: " + r.status); return r.ok ? r.json() : [] })
		      .then(f => { log("flows loaded: " + f.length + " " + JSON.stringify(f.map((x: any) => x.id))); setFlows(f) })
		      .catch(e => { log("flows-meta fetch FAILED: " + String(e)) })

		    if (import.meta.hot) {
		      import.meta.hot.on("caret:pages-changed", () => {
		        fetch("/__caret/pages-meta")
		          .then(r => r.json())
		          .then(metas => setPages(metas))
		          .catch(() => {})
		      })
		      import.meta.hot.on("caret:flows-changed", () => {
		        log("[HMR] caret:flows-changed received, refetching...")
		        fetch("/__caret/flows-meta")
		          .then(r => r.ok ? r.json() : [])
		          .then(f => { log("[HMR] flows refetched: " + f.length); setFlows(f) })
		          .catch(e => { log("[HMR] flows refetch failed: " + e) })
		      })
		    }
		  }, [])

		  const handleFocus = useCallback((pageId: string) => {
		    setFocusedPageId(pageId)
		    setMode("focused")
		  }, [])

		  const handleBack = useCallback(() => {
		    setMode("canvas")
		    setFocusedPageId(null)
		  }, [])

		  // Tracks where simulation was entered from so exiting returns there.
		  const simOrigin = useRef<"canvas" | "focused">("focused")

		  const handleSimulate = useCallback(() => {
		    simOrigin.current = "focused"
		    setMode("simulation")
		  }, [])

		  const handleSimulateFromCanvas = useCallback((pageId: string) => {
		    simOrigin.current = "canvas"
		    setFocusedPageId(pageId)
		    setMode("simulation")
		  }, [])

		  const handleExitSimulation = useCallback(() => {
		    if (simOrigin.current === "canvas") {
		      setMode("canvas")
		      setFocusedPageId(null)
		    } else {
		      setMode("focused")
		    }
		  }, [])

		  if (mode === "simulation" && focusedPageId) {
		    return (
		      <ErrorBoundary fallback={<CanvasErrorFallback />}>
		        <SimulationView
		          initialPageId={focusedPageId}
		          pages={pages}
		          viewport={viewport}
		          onSetViewport={setViewport}
		          onExit={handleExitSimulation}
		        />
		      </ErrorBoundary>
		    )
		  }

		  if (mode === "focused" && focusedPageId) {
		    const page = pages.find(p => p.id === focusedPageId)
		    return (
		      <ErrorBoundary fallback={<FocusedErrorFallback onBack={() => { setMode("canvas"); setFocusedPageId(null) }} />}>
		        <FocusedPageView
		          pageId={focusedPageId}
		          title={page?.title || focusedPageId}
		          tags={page?.tags || []}
		          states={page?.states || []}
		          onBack={handleBack}
		          onSimulate={handleSimulate}
		          viewport={viewport}
		          onSetViewport={setViewport}
		        />
		      </ErrorBoundary>
		    )
		  }

		  return (
		    <ErrorBoundary fallback={<CanvasErrorFallback />}>
		      <CanvasView
		        pages={pages}
		        routes={routes}
		        onFocus={handleFocus}
		        onSimulate={handleSimulateFromCanvas}
		        flows={flows}
		        viewport={viewport}
		        onSetViewport={setViewport}
		      />
		    </ErrorBoundary>
		  )
		}

		function FocusedErrorFallback({ onBack }: { onBack: () => void }) {
		  return (
		    <div className="caret-focused-shell">
		      <div className="caret-focused-toolbar">
		        <button onClick={onBack} className="caret-focused-toolbar-btn" title="Back to canvas">←</button>
		      </div>
		      <div className="caret-canvas-error">
		        <h2>Page failed to render</h2>
		        <p>Check .caret/vite.log for compilation errors.</p>
		      </div>
		    </div>
		  )
		}

		function CanvasErrorFallback() {
		  return (
		    <div className="caret-canvas-error">
		      <h2>Canvas error</h2>
		      <p>Something went wrong. Try reloading the preview.</p>
		    </div>
		  )
		}
	`
}

function generateCanvasView(): string {
	return dedent`
		import React, { useState, useRef, useCallback, useEffect } from "react"
		import { PageThumbnail } from "./PageThumbnail"
		import type { PageInfo, CanvasTransform, CanvasLayout, LayoutMode, ViewportPreset, FlowDefinition } from "./types"
		import { VIEWPORT_PRESETS } from "./types"

		const THUMB_WIDTH = 380
		const THUMB_HEIGHT = 238
		const FRAME_WIDTH = 1440
		const FRAME_HEIGHT = 900
		const GAP = 40
		const COLS = 3
		const MIN_SCALE = 0.1
		const MAX_SCALE = 3.0
		const DRAG_THRESHOLD = 5
		const GROUP_HEADER_HEIGHT = 32
		const GROUP_GAP = 48
		// Height of the title label above each thumbnail frame (20px min-height + 6px padding).
		const LABEL_H = 26
		// Manual positions are stored in reference space: thumbnail height at desktop-1440.
		// Other viewports scale y at render time so saved layouts stay viewport-independent.
		const REF_THUMB_HEIGHT = FRAME_HEIGHT * (THUMB_WIDTH / 1440)

		interface Props {
		  pages: PageInfo[]
		  routes: Array<{ path: string; name: string; component: React.ComponentType }>
		  onFocus: (pageId: string) => void
		  onSimulate: (pageId: string) => void
		  flows: FlowDefinition[]
		  viewport: ViewportPreset
		  onSetViewport: (v: ViewportPreset) => void
		}

		function groupPagesByTag(pages: PageInfo[]): Array<{ tag: string; pages: PageInfo[] }> {
		  const groups: Record<string, PageInfo[]> = {}
		  for (const page of pages) {
		    const tag = page.tags?.[0] || "other"
		    if (!groups[tag]) groups[tag] = []
		    groups[tag].push(page)
		  }
		  return Object.entries(groups)
		    .sort(([a], [b]) => (a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b)))
		    .map(([tag, pages]) => ({ tag, pages }))
		}

		function computeAutoPositions(pages: PageInfo[], thumbHeight: number): Array<{ page: PageInfo; x: number; y: number; groupTag?: string }> {
		  const groups = groupPagesByTag(pages)
		  const items: Array<{ page: PageInfo; x: number; y: number; groupTag?: string }> = []
		  let yOffset = 0
		  const rowHeight = thumbHeight + GAP + 24

		  for (const group of groups) {
		    yOffset += GROUP_HEADER_HEIGHT
		    group.pages.forEach((page, i) => {
		      const col = i % COLS
		      const row = Math.floor(i / COLS)
		      items.push({
		        page,
		        x: col * (THUMB_WIDTH + GAP),
		        y: yOffset + row * rowHeight,
		        groupTag: i === 0 ? group.tag : undefined,
		      })
		    })
		    const rows = Math.ceil(group.pages.length / COLS)
		    yOffset += rows * rowHeight + GROUP_GAP
		  }
		  return items
		}

		let saveTimeout: ReturnType<typeof setTimeout> | null = null
		function saveLayout(layout: CanvasLayout) {
		  if (saveTimeout) clearTimeout(saveTimeout)
		  saveTimeout = setTimeout(() => {
		    fetch("/__caret/canvas-layout", {
		      method: "PUT",
		      headers: { "Content-Type": "application/json" },
		      body: JSON.stringify(layout),
		    }).catch(() => {})
		  }, 500)
		}

		export function CanvasView({ pages, routes, onFocus, onSimulate, flows, viewport, onSetViewport }: Props) {
		  const [transform, setTransform] = useState<CanvasTransform>({ x: 40, y: 40, scale: 1 })
		  const [showFlows, setShowFlows] = useState(false)
		  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)
		  const [isPanning, setIsPanning] = useState(false)
		  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
		  const [layoutMode, setLayoutMode] = useState<LayoutMode>("auto")
		  const [manualPositions, setManualPositions] = useState<Record<string, { x: number; y: number }>>({})
		  const [dragState, setDragState] = useState<{ pageId: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
		  const [edgeDrag, setEdgeDrag] = useState<{ fromPage: string; mouseX: number; mouseY: number; originX: number; originY: number; reassignFlowId?: string; reassignOldTo?: string; reassignIsError?: boolean } | null>(null)
		  const [selectedEdge, setSelectedEdge] = useState<{ flowId: string; from: string; to: string; isError?: boolean } | null>(null)
		  const containerRef = useRef<HTMLDivElement>(null)
		  const log = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: msg } }, "*")

		  const activeFrameWidth = VIEWPORT_PRESETS[viewport].width
		  const activeThumbHeight = FRAME_HEIGHT * (THUMB_WIDTH / activeFrameWidth)
		  const autoItems = layoutMode === "auto" ? computeAutoPositions(pages, activeThumbHeight) : null
		  // Scaling the full card pitch (thumb + label) keeps cards that fit at the
		  // reference viewport from ever overlapping at taller viewports.
		  const layoutScaleY = (activeThumbHeight + LABEL_H) / (REF_THUMB_HEIGHT + LABEL_H)
		  const manualDisplayPositions = React.useMemo(() => {
		    const out: Record<string, { x: number; y: number }> = {}
		    pages.forEach((p, i) => {
		      const ref = manualPositions[p.id] || { x: (i % COLS) * (THUMB_WIDTH + GAP), y: Math.floor(i / COLS) * (REF_THUMB_HEIGHT + GAP + LABEL_H) }
		      out[p.id] = { x: ref.x, y: ref.y * layoutScaleY }
		    })
		    return out
		  }, [pages, manualPositions, layoutScaleY])

		  // y + LABEL_H so edges anchor on the visible frame, not the title label above it.
		  const getRect = (pageId: string) => {
		    if (autoItems) {
		      const item = autoItems.find(i => i.page.id === pageId)
		      if (item) return { x: item.x, y: item.y + LABEL_H, w: THUMB_WIDTH, h: activeThumbHeight }
		    } else {
		      const pos = manualDisplayPositions[pageId]
		      if (pos) return { x: pos.x, y: pos.y + LABEL_H, w: THUMB_WIDTH, h: activeThumbHeight }
		    }
		    return null
		  }

		  const visibleFlows = activeFlowId ? flows.filter(f => f.id === activeFlowId) : flows

		  // Edge "ports": every edge endpoint — and the right-side connector ring — gets
		  // its own slot along the card side it touches, ordered by where the other end
		  // of the edge lies. Endpoints therefore never stack on each other or on the
		  // connector. SIDE_DIRS are the outward normals used for bezier control points.
		  const edgePorts = (() => {
		    const SIDE_DIRS: Record<string, { dx: number; dy: number }> = {
		      left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 }, top: { dx: 0, dy: -1 }, bottom: { dx: 0, dy: 1 },
		    }
		    const groups: Record<string, Array<{ key: string; sortVal: number }>> = {}
		    const addItem = (pageId: string, side: string, key: string, sortVal: number) => {
		      const gk = pageId + "|" + side
		      if (!groups[gk]) groups[gk] = []
		      groups[gk].push({ key, sortVal })
		    }
		    pages.forEach(p => addItem(p.id, "right", "connector", Infinity))
		    const edges: Array<{ key: string; from: string; to: string; fromSide: string; toSide: string }> = []
		    if (showFlows) {
		      for (const flow of visibleFlows) {
		        for (const step of flow.steps) {
		          const targets = [
		            ...step.next.map(t => ({ to: t, err: "n" })),
		            ...(step.onError || []).map(t => ({ to: t, err: "e" })),
		          ]
		          for (const t of targets) {
		            const fr = getRect(step.page), tr = getRect(t.to)
		            if (!fr || !tr) continue
		            const fcx = fr.x + fr.w / 2, fcy = fr.y + fr.h / 2
		            const tcx = tr.x + tr.w / 2, tcy = tr.y + tr.h / 2
		            const dx = tcx - fcx, dy = tcy - fcy
		            const horizontal = Math.abs(dx) > Math.abs(dy)
		            const fromSide = horizontal ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top")
		            const toSide = horizontal ? (dx > 0 ? "left" : "right") : (dy > 0 ? "top" : "bottom")
		            const key = flow.id + "|" + step.page + "|" + t.to + "|" + t.err
		            edges.push({ key, from: step.page, to: t.to, fromSide, toSide })
		            addItem(step.page, fromSide, key + "|from", horizontal ? tcy : tcx)
		            addItem(t.to, toSide, key + "|to", horizontal ? fcy : fcx)
		          }
		        }
		      }
		    }
		    const portPos: Record<string, { x: number; y: number }> = {}
		    for (const gk of Object.keys(groups)) {
		      const sep = gk.lastIndexOf("|")
		      const rect = getRect(gk.slice(0, sep))
		      if (!rect) continue
		      const side = gk.slice(sep + 1)
		      const items = groups[gk].slice().sort((a, b) => (a.sortVal - b.sortVal) || (a.key < b.key ? -1 : 1))
		      items.forEach((item, i) => {
		        const frac = (i + 1) / (items.length + 1)
		        portPos[gk + "|" + item.key] =
		          side === "left" ? { x: rect.x, y: rect.y + rect.h * frac }
		          : side === "right" ? { x: rect.x + rect.w, y: rect.y + rect.h * frac }
		          : side === "top" ? { x: rect.x + rect.w * frac, y: rect.y }
		          : { x: rect.x + rect.w * frac, y: rect.y + rect.h }
		      })
		    }
		    const anchors: Record<string, { fx: number; fy: number; tx: number; ty: number; fdx: number; fdy: number; tdx: number; tdy: number }> = {}
		    for (const e of edges) {
		      const fp = portPos[e.from + "|" + e.fromSide + "|" + e.key + "|from"]
		      const tp = portPos[e.to + "|" + e.toSide + "|" + e.key + "|to"]
		      if (!fp || !tp) continue
		      anchors[e.key] = {
		        fx: fp.x, fy: fp.y, tx: tp.x, ty: tp.y,
		        fdx: SIDE_DIRS[e.fromSide].dx, fdy: SIDE_DIRS[e.fromSide].dy,
		        tdx: SIDE_DIRS[e.toSide].dx, tdy: SIDE_DIRS[e.toSide].dy,
		      }
		    }
		    const connectors: Record<string, { x: number; y: number }> = {}
		    pages.forEach(p => {
		      const cp = portPos[p.id + "|right|connector"]
		      if (cp) connectors[p.id] = cp
		    })
		    return { anchors, connectors }
		  })()

		  useEffect(() => {
		    fetch("/__caret/canvas-layout")
		      .then(r => r.ok ? r.json() : null)
		      .then(data => {
		        if (data?.mode) setLayoutMode(data.mode)
		        if (data?.positions) setManualPositions(data.positions)
		      })
		      .catch(() => {})
		  }, [])

		  const handleWheel = useCallback((e: React.WheelEvent) => {
		    e.preventDefault()
		    if (e.ctrlKey || e.metaKey) {
		      const rect = containerRef.current?.getBoundingClientRect()
		      if (!rect) return
		      const mx = e.clientX - rect.left
		      const my = e.clientY - rect.top
		      setTransform(prev => {
		        const factor = e.deltaY > 0 ? 0.9 : 1.1
		        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
		        const ratio = newScale / prev.scale
		        return { x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio, scale: newScale }
		      })
		    } else {
		      setTransform(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
		    }
		  }, [])

		  const handlePointerDown = useCallback((e: React.PointerEvent) => {
		    if (selectedEdge) setSelectedEdge(null)
		    if (e.button === 1 || (e.button === 0 && e.altKey)) {
		      e.preventDefault()
		      setIsPanning(true)
		      setPanStart({ x: e.clientX, y: e.clientY })
		      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		    }
		  }, [selectedEdge])

		  const handlePointerMove = useCallback((e: React.PointerEvent) => {
		    if (edgeDrag) {
		      const rect = containerRef.current?.getBoundingClientRect()
		      if (rect) {
		        setEdgeDrag(prev => prev ? { ...prev, mouseX: (e.clientX - rect.left - transform.x) / transform.scale, mouseY: (e.clientY - rect.top - transform.y) / transform.scale } : null)
		      }
		      return
		    }
		    if (dragState) {
		      const dx = (e.clientX - dragState.startX) / transform.scale
		      const dy = (e.clientY - dragState.startY) / transform.scale
		      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD || dragState.moved) {
		        setDragState(prev => prev ? { ...prev, moved: true } : null)
		        setManualPositions(prev => ({
		          ...prev,
		          [dragState.pageId]: { x: dragState.origX + dx, y: dragState.origY + dy / layoutScaleY },
		        }))
		      }
		      return
		    }
		    if (!isPanning) return
		    const dx = e.clientX - panStart.x
		    const dy = e.clientY - panStart.y
		    setPanStart({ x: e.clientX, y: e.clientY })
		    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
		  }, [isPanning, panStart, dragState, transform.scale, edgeDrag, transform.x, transform.y, layoutScaleY])

		  const handlePointerUp = useCallback((e: React.PointerEvent) => {
		    if (edgeDrag) {
		      const rect = containerRef.current?.getBoundingClientRect()
		      if (rect) {
		        const canvasX = (e.clientX - rect.left - transform.x) / transform.scale
		        const canvasY = (e.clientY - rect.top - transform.y) / transform.scale
		        const wrapperHeight = activeThumbHeight + LABEL_H
		        const allPositions = autoItems
		          ? autoItems.map(i => ({ id: i.page.id, x: i.x, y: i.y }))
		          : pages.map(p => ({ id: p.id, ...manualDisplayPositions[p.id] }))
		        const target = allPositions.find(p => p.id !== edgeDrag.fromPage && canvasX >= p.x && canvasX <= p.x + THUMB_WIDTH && canvasY >= p.y && canvasY <= p.y + wrapperHeight)
		        // New edges go to: the reassigned edge's flow, else the legend-selected
		        // flow, else the flow that already contains the source page as a step.
		        const sourceFlow = flows.find(f => f.steps.some(s => s.page === edgeDrag.fromPage))
		        const flowId = edgeDrag.reassignFlowId || activeFlowId || sourceFlow?.id || (flows.length > 0 ? flows[0].id : null)
		        if (target && flowId) {
		          if (edgeDrag.reassignOldTo && edgeDrag.reassignFlowId) {
		            log("[edge-reassign] " + edgeDrag.fromPage + ": " + edgeDrag.reassignOldTo + " → " + target.id + " flow=" + edgeDrag.reassignFlowId)
		            window.parent.postMessage({ source: "caret-vite", type: "flow-edge-update", payload: { flowId: edgeDrag.reassignFlowId, fromPage: edgeDrag.fromPage, oldToPage: edgeDrag.reassignOldTo, newToPage: target.id, isError: edgeDrag.reassignIsError || false } }, "*")
		          } else {
		            log("[edge-create] " + edgeDrag.fromPage + " → " + target.id + " flow=" + flowId)
		            window.parent.postMessage({ source: "caret-vite", type: "flow-edge-create", payload: { flowId, fromPage: edgeDrag.fromPage, toPage: target.id } }, "*")
		          }
		        } else {
		          log("[edge-drag-cancel] from=" + edgeDrag.fromPage + " canvasX=" + canvasX.toFixed(0) + " canvasY=" + canvasY.toFixed(0) + " positions=" + JSON.stringify(allPositions.map(p => p.id + ":" + p.x + "," + p.y).join("|")) + " wH=" + wrapperHeight.toFixed(0))
		        }
		      }
		      setEdgeDrag(null)
		      return
		    }
		    if (dragState?.moved) {
		      saveLayout({ mode: layoutMode, positions: manualPositions })
		    }
		    setDragState(null)
		    setIsPanning(false)
		  }, [dragState, layoutMode, manualPositions, manualDisplayPositions, edgeDrag, transform, autoItems, pages, activeFlowId, flows, activeThumbHeight])

		  const handleThumbPointerDown = useCallback((pageId: string, x: number, y: number, e: React.PointerEvent) => {
		    if (layoutMode !== "manual" || e.button !== 0) return
		    e.stopPropagation()
		    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		    // x/y arrive in display space; the drag origin is kept in reference space
		    // because drag moves write back into manualPositions (reference space).
		    setDragState({ pageId, startX: e.clientX, startY: e.clientY, origX: x, origY: y / layoutScaleY, moved: false })
		  }, [layoutMode, layoutScaleY])

		  const fitAll = useCallback(() => {
		    if (!containerRef.current || pages.length === 0) return
		    const rect = containerRef.current.getBoundingClientRect()
		    const positioned = layoutMode === "manual"
		      ? pages.map(p => manualDisplayPositions[p.id])
		      : computeAutoPositions(pages, activeThumbHeight).map(item => ({ x: item.x, y: item.y }))
		    const maxX = Math.max(...positioned.map(p => p.x)) + THUMB_WIDTH
		    const maxY = Math.max(...positioned.map(p => p.y)) + activeThumbHeight + LABEL_H
		    const padding = 60
		    const scaleX = (rect.width - padding * 2) / maxX
		    const scaleY = (rect.height - padding * 2) / maxY
		    const scale = Math.min(scaleX, scaleY, 1.5)
		    const x = (rect.width - maxX * scale) / 2
		    const y = (rect.height - maxY * scale) / 2
		    setTransform({ x, y, scale })
		  }, [pages, layoutMode, manualDisplayPositions, activeThumbHeight])

		  useEffect(() => { fitAll() }, [fitAll])

		  useEffect(() => {
		    if (!selectedEdge) return
		    const handleKey = (e: KeyboardEvent) => {
		      if (e.key === "Delete" || e.key === "Backspace") {
		        e.preventDefault()
		        log("[edge-delete] " + selectedEdge.from + " → " + selectedEdge.to + " flow=" + selectedEdge.flowId)
		        window.parent.postMessage({ source: "caret-vite", type: "flow-edge-delete", payload: { flowId: selectedEdge.flowId, fromPage: selectedEdge.from, toPage: selectedEdge.to, isError: selectedEdge.isError || false } }, "*")
		        setSelectedEdge(null)
		      } else if (e.key === "Escape") {
		        setSelectedEdge(null)
		      }
		    }
		    window.addEventListener("keydown", handleKey)
		    return () => window.removeEventListener("keydown", handleKey)
		  }, [selectedEdge])

		  const toggleLayout = useCallback(() => {
		    const newMode = layoutMode === "auto" ? "manual" : "auto"
		    if (newMode === "manual" && Object.keys(manualPositions).length === 0) {
		      const auto = computeAutoPositions(pages, REF_THUMB_HEIGHT)
		      const positions: Record<string, { x: number; y: number }> = {}
		      auto.forEach(item => { positions[item.page.id] = { x: item.x, y: item.y } })
		      setManualPositions(positions)
		      saveLayout({ mode: newMode, positions })
		    } else {
		      saveLayout({ mode: newMode, positions: manualPositions })
		    }
		    setLayoutMode(newMode)
		  }, [layoutMode, manualPositions, pages])

		  React.useEffect(() => {
		    log("[canvas] viewport=" + viewport + " activeFrameWidth=" + activeFrameWidth + " activeThumbHeight=" + activeThumbHeight.toFixed(0))
		  }, [viewport, activeFrameWidth])

		  // The simulation entry point is the page no flow edge points to (the flow root).
		  // Cyclic flows have no root, so fall back to the first step, then the first page.
		  const getSimStartPage = (): string | null => {
		    const pageExists = (id: string) => pages.some(p => p.id === id)
		    const candidateFlows = activeFlowId ? flows.filter(f => f.id === activeFlowId) : flows
		    const targets = new Set<string>()
		    for (const flow of candidateFlows) {
		      for (const step of flow.steps) {
		        step.next.forEach(t => targets.add(t))
		        ;(step.onError || []).forEach(t => targets.add(t))
		      }
		    }
		    for (const flow of candidateFlows) {
		      const root = flow.steps.find(s => !targets.has(s.page) && pageExists(s.page))
		      if (root) return root.page
		    }
		    for (const flow of candidateFlows) {
		      const first = flow.steps.find(s => pageExists(s.page))
		      if (first) return first.page
		    }
		    return pages.length > 0 ? pages[0].id : null
		  }

		  if (pages.length === 0) {
		    return (
		      <div className="caret-canvas-empty">
		        <div className="caret-canvas-empty-icon">◇</div>
		        <h2>No pages yet</h2>
		        <p>Use Caret in design mode to create pages.</p>
		      </div>
		    )
		  }

		  return (
		    <div
		      ref={containerRef}
		      className="caret-canvas-container"
		      onWheel={handleWheel}
		      onPointerDown={handlePointerDown}
		      onPointerMove={handlePointerMove}
		      onPointerUp={handlePointerUp}
		      style={{ cursor: isPanning ? "grabbing" : dragState ? "grabbing" : "default" }}
		    >
		      {showFlows && flows.length > 0 && (
		        <div className="caret-flow-legend">
		          {flows.map((flow, i) => (
		            <span key={flow.id} className={"caret-flow-legend-item" + (activeFlowId === flow.id ? " active" : "")} onClick={() => setActiveFlowId(activeFlowId === flow.id ? null : flow.id)}>
		              <span className="caret-flow-legend-dot" style={{ background: ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"][i % 5] }} />
		              {flow.name}
		            </span>
		          ))}
		        </div>
		      )}
		      <div className="caret-canvas-toolbar">
		        <button onClick={fitAll} className="caret-tb-btn" title="Fit all">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/></svg>
		        </button>
		        <button onClick={toggleLayout} className={"caret-tb-btn" + (layoutMode === "manual" ? " active" : "")} title={layoutMode === "auto" ? "Switch to manual layout" : "Switch to auto layout"}>
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v4M6 4h4M3 8h10M3 8c-1 0-1.5.5-1.5 1.5S2.5 11 3 12M13 8c1 0 1.5.5 1.5 1.5S13.5 11 13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
		        </button>
		        <div className="caret-tb-sep" />
		        <button onClick={() => onSetViewport("desktop-1440")} className={"caret-tb-btn" + (viewport === "desktop-1440" ? " active" : "")} title="Desktop 1440">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M5 14h6M8 12v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
		        </button>
		        <button onClick={() => onSetViewport("desktop-1280")} className={"caret-tb-btn" + (viewport === "desktop-1280" ? " active" : "")} title="Laptop 1280">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/><path d="M1 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
		        </button>
		        <button onClick={() => onSetViewport("tablet-768")} className={"caret-tb-btn" + (viewport === "tablet-768" ? " active" : "")} title="Tablet 768">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="13" r="0.5" fill="currentColor"/></svg>
		        </button>
		        <button onClick={() => onSetViewport("mobile-390")} className={"caret-tb-btn" + (viewport === "mobile-390" ? " active" : "")} title="Mobile 390">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="4" y="1" width="8" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 13h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
		        </button>
		        <div className="caret-tb-sep" />
		        {flows.length > 0 && (
		          <button onClick={() => setShowFlows(!showFlows)} className={"caret-tb-btn" + (showFlows ? " active" : "")} title={showFlows ? "Hide flows" : "Show flows"}>
		            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h4M10 8h4M8 4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 8l2-2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
		          </button>
		        )}
		        <button onClick={() => { const start = getSimStartPage(); if (start) onSimulate(start) }} className="caret-tb-btn" title="Simulate">
		          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 3l8 5-8 5V3z" fill="currentColor"/></svg>
		        </button>
		        <span className="caret-canvas-zoom-label">{Math.round(transform.scale * 100)}%</span>
		      </div>
		      <div
		        className="caret-canvas-content"
		        style={{
		          transform: \`translate(\${transform.x}px, \${transform.y}px) scale(\${transform.scale})\`,
		          transformOrigin: "0 0",
		        }}
		      >
		        {autoItems ? (
		          autoItems.map(({ page, x, y, groupTag }) => {
		            const hasRoute = routes.some(r => r.name === page.id)
		            const conn = edgePorts.connectors[page.id] || { x: x + THUMB_WIDTH, y: y + LABEL_H + activeThumbHeight / 2 }
		            return (
		              <React.Fragment key={page.id}>
		                {groupTag && (
		                  <div className="caret-canvas-group-header" style={{ position: "absolute", left: 0, top: y - GROUP_HEADER_HEIGHT, width: COLS * (THUMB_WIDTH + GAP) }}>
		                    {groupTag}
		                  </div>
		                )}
		                <div className="caret-canvas-thumb-wrapper" style={{ position: "absolute", left: x, top: y }}>
		                  <PageThumbnail pageId={page.id} title={page.title || page.id} tags={page.tags || []} frameWidth={activeFrameWidth} frameHeight={FRAME_HEIGHT} thumbWidth={THUMB_WIDTH} onClick={hasRoute ? () => onFocus(page.id) : undefined} />
		                  {showFlows && (
		                    <div className="caret-edge-connector" style={{ top: conn.y - y }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); log("[edge-drag-start] from=" + page.id); setEdgeDrag({ fromPage: page.id, mouseX: conn.x, mouseY: conn.y, originX: conn.x, originY: conn.y }) }} />
		                  )}
		                </div>
		              </React.Fragment>
		            )
		          })
		        ) : (
		          pages.map((page) => {
		            const pos = manualDisplayPositions[page.id]
		            const hasRoute = routes.some(r => r.name === page.id)
		            const conn = edgePorts.connectors[page.id] || { x: pos.x + THUMB_WIDTH, y: pos.y + LABEL_H + activeThumbHeight / 2 }
		            return (
		              <div
		                key={page.id}
		                className={"caret-canvas-thumb-wrapper" + (dragState?.pageId === page.id ? " dragging" : "")}
		                style={{ position: "absolute", left: pos.x, top: pos.y }}
		                onPointerDown={(e) => handleThumbPointerDown(page.id, pos.x, pos.y, e)}
		              >
		                <PageThumbnail pageId={page.id} title={page.title || page.id} tags={page.tags || []} frameWidth={activeFrameWidth} frameHeight={FRAME_HEIGHT} thumbWidth={THUMB_WIDTH}
		                  onClick={hasRoute && !dragState?.moved ? () => onFocus(page.id) : undefined} />
		                {showFlows && (
		                  <div className="caret-edge-connector" style={{ top: conn.y - pos.y }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); log("[edge-drag-start] from=" + page.id); setEdgeDrag({ fromPage: page.id, mouseX: conn.x, mouseY: conn.y, originX: conn.x, originY: conn.y }) }} />
		                )}
		              </div>
		            )
		          })
		        )}
		        {showFlows && flows.length > 0 && (() => {
		          const FLOW_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"]
		          // Anchors come from the shared port distribution (edgePorts) so endpoints
		          // never collide with each other or the connector ring. The outward unit
		          // vectors (fdx/fdy, tdx/tdy) make the bezier end tangent enter the
		          // destination, keeping orient="auto" arrowheads pointing forward.
		          const getEdgeAnchors = (flowId: string, fromId: string, toId: string, err: string) =>
		            edgePorts.anchors[flowId + "|" + fromId + "|" + toId + "|" + err] || null
		          const makePath = (a: { fx: number; fy: number; tx: number; ty: number; fdx: number; fdy: number; tdx: number; tdy: number }) => {
		            const dist = Math.sqrt((a.tx - a.fx) ** 2 + (a.ty - a.fy) ** 2)
		            const cp = Math.max(20, Math.min(dist * 0.4, 150))
		            return "M " + a.fx + " " + a.fy + " C " + (a.fx + a.fdx * cp) + " " + (a.fy + a.fdy * cp) + ", " + (a.tx + a.tdx * cp) + " " + (a.ty + a.tdy * cp) + ", " + a.tx + " " + a.ty
		          }
		          return (
		            <svg className="caret-canvas-flow-overlay" style={{ width: 10000, height: 10000 }}>
		              {/* userSpaceOnUse keeps arrows a fixed size (no stroke-width scaling);
		                  refX=21 parks the tip 7px short of the endpoint, on the rim of the r=7 dot. */}
		              <defs>
		                {flows.map((flow, i) => (
		                  <marker key={flow.id} id={"caret-arrow-" + flow.id} markerWidth="14" markerHeight="10" refX="21" refY="5" orient="auto" markerUnits="userSpaceOnUse">
		                    <polygon points="0 0, 14 5, 0 10" fill={FLOW_COLORS[i % 5]} />
		                  </marker>
		                ))}
		                <marker id="caret-arrow-error" markerWidth="14" markerHeight="10" refX="21" refY="5" orient="auto" markerUnits="userSpaceOnUse">
		                  <polygon points="0 0, 14 5, 0 10" fill="#ef4444" />
		                </marker>
		              </defs>
		              {visibleFlows.map((flow, fi) => {
		                const color = FLOW_COLORS[flows.indexOf(flow) % 5]
		                return flow.steps.flatMap(step => {
		                  const nextEdges = step.next.map(nextPage => {
		                    const anchors = getEdgeAnchors(flow.id, step.page, nextPage, "n")
		                    if (!anchors) return null
		                    const d = makePath(anchors)
		                    const isSelected = selectedEdge?.flowId === flow.id && selectedEdge?.from === step.page && selectedEdge?.to === nextPage
		                    return <g key={flow.id + "-" + step.page + "-" + nextPage}>
		                      <path d={d} stroke="transparent" strokeWidth={14} fill="none" style={{ cursor: "pointer", pointerEvents: "stroke" }} onClick={(e) => { e.stopPropagation(); log("[edge-select] " + step.page + " → " + nextPage + " flow=" + flow.id); setSelectedEdge({ flowId: flow.id, from: step.page, to: nextPage, isError: false }) }} />
		                      <path d={d} stroke={isSelected ? "#fff" : color} strokeWidth={isSelected ? 3 : 2} fill="none" opacity={isSelected ? 1 : 0.7} markerEnd={"url(#caret-arrow-" + flow.id + ")"} style={{ pointerEvents: "none" }} />
		                      <circle cx={anchors.tx} cy={anchors.ty} r={7} fill={isSelected ? "#fff" : color} stroke={isSelected ? color : "#0a0a0a"} strokeWidth={2} style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); log("[edge-reassign-start] " + step.page + " → " + nextPage + " flow=" + flow.id); setEdgeDrag({ fromPage: step.page, mouseX: anchors.tx, mouseY: anchors.ty, originX: anchors.fx, originY: anchors.fy, reassignFlowId: flow.id, reassignOldTo: nextPage, reassignIsError: false }) }} />
		                    </g>
		                  })
		                  const errorEdges = (step.onError || []).map(errorPage => {
		                    const anchors = getEdgeAnchors(flow.id, step.page, errorPage, "e")
		                    if (!anchors) return null
		                    const d = makePath(anchors)
		                    const isSelected = selectedEdge?.flowId === flow.id && selectedEdge?.from === step.page && selectedEdge?.to === errorPage
		                    return <g key={flow.id + "-error-" + step.page + "-" + errorPage}>
		                      <path d={d} stroke="transparent" strokeWidth={14} fill="none" style={{ cursor: "pointer", pointerEvents: "stroke" }} onClick={(e) => { e.stopPropagation(); setSelectedEdge({ flowId: flow.id, from: step.page, to: errorPage, isError: true }) }} />
		                      <path d={d} stroke={isSelected ? "#fff" : "#ef4444"} strokeWidth={isSelected ? 3 : 2} fill="none" opacity={isSelected ? 1 : 0.7} strokeDasharray="6 3" markerEnd="url(#caret-arrow-error)" style={{ pointerEvents: "none" }} />
		                      <circle cx={anchors.tx} cy={anchors.ty} r={7} fill={isSelected ? "#fff" : "#ef4444"} stroke="#0a0a0a" strokeWidth={2} style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); log("[edge-reassign-start] " + step.page + " → " + errorPage + " flow=" + flow.id + " (error)"); setEdgeDrag({ fromPage: step.page, mouseX: anchors.tx, mouseY: anchors.ty, originX: anchors.fx, originY: anchors.fy, reassignFlowId: flow.id, reassignOldTo: errorPage, reassignIsError: true }) }} />
		                    </g>
		                  })
		                  return [...nextEdges, ...errorEdges]
		                })
		              })}
		              {edgeDrag && (
		                <line x1={edgeDrag.originX} y1={edgeDrag.originY} x2={edgeDrag.mouseX} y2={edgeDrag.mouseY} stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" opacity={0.8} style={{ pointerEvents: "none" }} />
		              )}
		            </svg>
		          )
		        })()}
		      </div>
		    </div>
		  )
		}
	`
}

function generatePageThumbnail(): string {
	return dedent`
		import React from "react"

		interface Props {
		  pageId: string
		  title: string
		  tags: string[]
		  frameWidth: number
		  frameHeight: number
		  thumbWidth: number
		  onClick?: () => void
		}

		export function PageThumbnail({ pageId, title, tags, frameWidth, frameHeight, thumbWidth, onClick }: Props) {
		  const scale = thumbWidth / frameWidth
		  const thumbHeight = frameHeight * scale

		  React.useEffect(() => {
		    window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: "[thumb] " + pageId + " frameWidth=" + frameWidth + " scale=" + scale.toFixed(4) + " thumbHeight=" + thumbHeight.toFixed(1) } }, "*")
		  }, [pageId, frameWidth])

		  return (
		    <div className="caret-canvas-frame" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
		      <div className="caret-canvas-frame-label">
		        <span className="caret-canvas-frame-title">{title}</span>
		        {tags.length > 0 && (
		          <div className="caret-canvas-frame-tags">
		            {tags.slice(0, 3).map(tag => (
		              <span key={tag} className="caret-canvas-frame-tag">{tag}</span>
		            ))}
		          </div>
		        )}
		      </div>
		      <div className="caret-canvas-frame-viewport" style={{ width: thumbWidth, height: thumbHeight }}>
		        <iframe
		          src={\`/?page=\${encodeURIComponent(pageId)}\`}
		          className="caret-canvas-frame-iframe"
		          title={title}
		          style={{
		            width: frameWidth,
		            height: frameHeight,
		            transform: \`scale(\${scale})\`,
		          }}
		          tabIndex={-1}
		        />
		      </div>
		    </div>
		  )
		}
	`
}

function generateFocusedPageView(): string {
	return dedent`
		import React, { useRef, useEffect } from "react"
		import type { ViewportPreset } from "./types"
		import { VIEWPORT_PRESETS } from "./types"

		interface Props {
		  pageId: string
		  title: string
		  tags: string[]
		  states: string[]
		  onBack: () => void
		  onSimulate: () => void
		  viewport: ViewportPreset
		  onSetViewport: (v: ViewportPreset) => void
		}

		export function FocusedPageView({ pageId, title, states, onBack, onSimulate, viewport, onSetViewport }: Props) {
		  const iframeRef = useRef<HTMLIFrameElement>(null)
		  const preset = VIEWPORT_PRESETS[viewport]

		  useEffect(() => {
		    const log = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: msg } }, "*")
		    log("[focused] mounted pageId=" + pageId + " viewport=" + viewport + " preset.width=" + preset.width + "px (this is the iframe inline width)")
		    const iframe = iframeRef.current
		    if (iframe) {
		      const computed = window.getComputedStyle(iframe)
		      log("[focused] iframe computedWidth=" + computed.width + " computedMaxWidth=" + computed.maxWidth + " containerWidth=" + iframe.parentElement?.getBoundingClientRect().width)
		    }
		    const handler = (e: MessageEvent) => {
		      const iframe = iframeRef.current
		      if (!iframe?.contentWindow) return

		      if (e.data?.source === "caret-vite" && e.source === iframe.contentWindow) {
		        log("relay: iframe->parent type=" + e.data.type)
		        window.parent.postMessage(e.data, "*")
		        return
		      }

		      if (e.data?.source === "caret-extension") {
		        log("relay: parent->iframe type=" + e.data.type)
		        iframe.contentWindow.postMessage(e.data, "*")
		        return
		      }

		      if (e.data?.source === "caret-page-iframe" && e.source === iframe.contentWindow) {
		        log("relay: iframe control: " + e.data.type)
		        if (e.data.type === "back") onBack()
		        if (e.data.type === "simulate") onSimulate()
		        return
		      }
		    }

		    window.addEventListener("message", handler)
		    return () => window.removeEventListener("message", handler)
		  }, [onBack, onSimulate])

		  useEffect(() => {
		    const vlog = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: msg } }, "*")
		    vlog("[focused] viewport changed to " + viewport + " preset.width=" + preset.width)
		    const iframe = iframeRef.current
		    if (iframe) {
		      requestAnimationFrame(() => {
		        const rect = iframe.getBoundingClientRect()
		        vlog("[focused] after viewport change: iframe actual rendered width=" + rect.width + " height=" + rect.height)
		      })
		    }
		  }, [viewport, preset.width])

		  return (
		    <div className="caret-focused-shell">
		      <div className="caret-focused-toolbar">
		        <button onClick={onBack} className="caret-focused-toolbar-btn" title="Back to canvas">←</button>
		        <span className="caret-focused-toolbar-title">{title}</span>
		        <div className="caret-focused-viewport-selector">
		          {(Object.entries(VIEWPORT_PRESETS) as [ViewportPreset, { name: string; width: number; icon: string }][]).map(([key, p]) => (
		            <button key={key} onClick={() => { onSetViewport(key); window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: "[focused] viewport button clicked: " + key + " width=" + p.width } }, "*") }} className={"caret-focused-toolbar-btn" + (viewport === key ? " active" : "")} title={p.name}>
		              {p.icon} {p.width}
		            </button>
		          ))}
		        </div>
		      </div>
		      <div className="caret-focused-iframe-container">
		        <iframe
		          ref={iframeRef}
		          src={"/?page=" + encodeURIComponent(pageId) + "&mode=focused"}
		          className="caret-focused-iframe"
		          style={{ width: preset.width }}
		          title={title}
		        />
		      </div>
		    </div>
		  )
		}
	`
}

function generateErrorBoundary(): string {
	return dedent`
		import React from "react"

		interface Props {
		  children: React.ReactNode
		  fallback: React.ReactNode
		}

		interface State {
		  hasError: boolean
		}

		export class ErrorBoundary extends React.Component<Props, State> {
		  constructor(props: Props) {
		    super(props)
		    this.state = { hasError: false }
		  }

		  static getDerivedStateFromError(): State {
		    return { hasError: true }
		  }

		  componentDidCatch(error: Error, info: React.ErrorInfo) {
		    console.error("Canvas error boundary caught:", error, info.componentStack)
		  }

		  render() {
		    if (this.state.hasError) return this.props.fallback
		    return this.props.children
		  }
		}
	`
}

function generateCaretStateContext(): string {
	return dedent`
		import React, { createContext, useContext } from "react"

		const CaretStateContext = createContext<string>("default")

		export function CaretStateProvider({ value, children }: { value: string; children: React.ReactNode }) {
		  return <CaretStateContext.Provider value={value}>{children}</CaretStateContext.Provider>
		}

		export function useCaretState() {
		  return useContext(CaretStateContext)
		}
	`
}

function generateCaretNavigator(): string {
	return dedent`
		import { useState, useCallback } from "react"

		export function useCaretNavigator(initialPageId: string) {
		  const [history, setHistory] = useState<string[]>([initialPageId])
		  const [historyIndex, setHistoryIndex] = useState(0)

		  const currentPageId = history[historyIndex]

		  const navigate = useCallback((pageId: string) => {
		    window.parent.postMessage({ source: "caret-sim-navigate", pageId }, "*")
		    setHistory(prev => [...prev.slice(0, historyIndex + 1), pageId])
		    setHistoryIndex(prev => prev + 1)
		  }, [historyIndex])

		  const goBack = useCallback(() => {
		    if (historyIndex > 0) setHistoryIndex(prev => prev - 1)
		  }, [historyIndex])

		  const goForward = useCallback(() => {
		    if (historyIndex < history.length - 1) setHistoryIndex(prev => prev + 1)
		  }, [historyIndex])

		  const canGoBack = historyIndex > 0
		  const canGoForward = historyIndex < history.length - 1

		  return { currentPageId, navigate, goBack, goForward, canGoBack, canGoForward }
		}
	`
}

function generateSimulationView(): string {
	return dedent`
		import React, { useRef, useEffect } from "react"
		import { useCaretNavigator } from "./CaretNavigator"
		import type { ViewportPreset, PageInfo } from "./types"
		import { VIEWPORT_PRESETS } from "./types"

		interface Props {
		  initialPageId: string
		  pages: PageInfo[]
		  viewport: ViewportPreset
		  onSetViewport: (v: ViewportPreset) => void
		  onExit: () => void
		}

		export function SimulationView({ initialPageId, pages, viewport, onSetViewport, onExit }: Props) {
		  const { currentPageId, navigate, goBack, goForward, canGoBack, canGoForward } = useCaretNavigator(initialPageId)
		  const iframeRef = useRef<HTMLIFrameElement>(null)
		  const preset = VIEWPORT_PRESETS[viewport]
		  const currentPage = pages.find(p => p.id === currentPageId)

		  const simLog = (msg: string) => window.parent.postMessage({ source: "caret-vite", type: "log", payload: { message: msg } }, "*")

		  useEffect(() => {
		    simLog("[sim] SimulationView mounted, listening for caret-sim-navigate. initialPageId=" + initialPageId)
		    const handler = (e: MessageEvent) => {
		      if (e.data?.source === "caret-sim-navigate") {
		        simLog("[sim] received caret-sim-navigate, navigating to: " + e.data.pageId)
		        navigate(e.data.pageId)
		      }
		    }
		    window.addEventListener("message", handler)
		    return () => window.removeEventListener("message", handler)
		  }, [navigate])

		  return (
		    <div className="caret-simulation-shell">
		      <div className="caret-simulation-toolbar">
		        <button onClick={onExit} className="caret-sim-btn" title="Exit simulation">✕</button>
		        <button onClick={goBack} className="caret-sim-btn" disabled={!canGoBack} title="Back">←</button>
		        <button onClick={goForward} className="caret-sim-btn" disabled={!canGoForward} title="Forward">→</button>
		        <span className="caret-sim-page-label">{currentPage?.title || currentPageId}</span>
		        <div className="caret-sim-viewport-selector">
		          {(Object.entries(VIEWPORT_PRESETS) as [ViewportPreset, { name: string; width: number; icon: string }][]).map(([key, p]) => (
		            <button key={key} onClick={() => onSetViewport(key)} className={"caret-sim-btn" + (viewport === key ? " active" : "")} title={p.name}>
		              {p.icon} {p.width}
		            </button>
		          ))}
		        </div>
		      </div>
		      <div className="caret-simulation-content">
		        {simLog("[sim] device frame: viewport=" + viewport + " width=" + preset.width + " (no maxWidth clamp)")}
		        <div className="caret-simulation-device-frame" style={{ width: preset.width }}>
		          <iframe
		            ref={iframeRef}
		            key={currentPageId}
		            src={"/?page=" + encodeURIComponent(currentPageId)}
		            className="caret-simulation-iframe"
		            title={currentPage?.title || currentPageId}
		          />
		        </div>
		      </div>
		    </div>
		  )
		}
	`
}

function generateOverlayPainter(): string {
	return dedent`
		import React, { useState, useRef, useCallback } from "react"
		import html2canvas from "html2canvas"
		import { bridge } from "../bridge"

		interface Props {
		  onClose: () => void
		}

		export function OverlayPainter({ onClose }: Props) {
		  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
		  const [drawing, setDrawing] = useState(false)
		  const [instruction, setInstruction] = useState("")
		  const [sending, setSending] = useState(false)
		  const startRef = useRef({ x: 0, y: 0 })

		  const handlePointerDown = useCallback((e: React.PointerEvent) => {
		    if ((e.target as HTMLElement).closest(".caret-overlay-prompt")) return
		    setDrawing(true)
		    startRef.current = { x: e.clientX, y: e.clientY }
		    setRect(null)
		    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		  }, [])

		  const handlePointerMove = useCallback((e: React.PointerEvent) => {
		    if (!drawing) return
		    const x = Math.min(startRef.current.x, e.clientX)
		    const y = Math.min(startRef.current.y, e.clientY)
		    const w = Math.abs(e.clientX - startRef.current.x)
		    const h = Math.abs(e.clientY - startRef.current.y)
		    setRect({ x, y, w, h })
		  }, [drawing])

		  const handlePointerUp = useCallback(() => {
		    setDrawing(false)
		  }, [])

		  const handleSubmit = useCallback(async () => {
		    if (!rect || !instruction.trim()) return
		    setSending(true)

		    try {
		      const focusedPage = (window as any).__CARET_FOCUSED_PAGE__
		      let screenshotDataUrl = ""

		      try {
		        const colorFnRe = /(oklch|oklab|lab|lch|hwb|color-mix|color)\\([^)]*(?:\\([^)]*\\)[^)]*)*\\)/g
		        const cache = new Map<string, string>()
		        const cvs = document.createElement("canvas")
		        cvs.width = 1
		        cvs.height = 1
		        const cvCtx = cvs.getContext("2d")!
		        function toRgb(value: string): string {
		          if (cache.has(value)) return cache.get(value)!
		          try {
		            cvCtx.clearRect(0, 0, 1, 1)
		            cvCtx.fillStyle = "rgba(0,0,0,0)"
		            cvCtx.fillStyle = value
		            cvCtx.fillRect(0, 0, 1, 1)
		            const [r, g, b, a] = cvCtx.getImageData(0, 0, 1, 1).data
		            const rgb = a === 0 ? "transparent" : a === 255 ? "rgb(" + r + ", " + g + ", " + b + ")" : "rgba(" + r + ", " + g + ", " + b + ", " + (a / 255).toFixed(3) + ")"
		            cache.set(value, rgb)
		            return rgb
		          } catch {
		            return value
		          }
		        }
		        const originals = new Map<HTMLStyleElement, string>()
		        let replacedCount = 0

		        document.querySelectorAll("style").forEach((s) => {
		          if (s.textContent && colorFnRe.test(s.textContent)) {
		            originals.set(s as HTMLStyleElement, s.textContent)
		            colorFnRe.lastIndex = 0
		            s.textContent = s.textContent.replace(colorFnRe, (m) => { replacedCount++; return toRgb(m) })
		          }
		        })

		        let linkedSheetColors = 0
		        for (const sheet of Array.from(document.styleSheets)) {
		          if (sheet.ownerNode?.nodeName === "STYLE") continue
		          try {
		            const cssText = Array.from(sheet.cssRules).map(r => r.cssText).join(" ")
		            const matches = cssText.match(colorFnRe)
		            if (matches) linkedSheetColors += matches.length
		          } catch {}
		        }

		        const origGCS = window.getComputedStyle
		        const convertColorStr = (val: string): string => {
		          colorFnRe.lastIndex = 0
		          if (colorFnRe.test(val)) {
		            colorFnRe.lastIndex = 0
		            return val.replace(colorFnRe, (m) => toRgb(m))
		          }
		          return val
		        }
		        window.getComputedStyle = function(el: Element, pseudo?: string | null) {
		          const style = origGCS.call(window, el, pseudo)
		          return new Proxy(style, {
		            get(target, prop) {
		              if (prop === "getPropertyValue") {
		                return function(name: string) {
		                  const val = target.getPropertyValue(name)
		                  return typeof val === "string" && val.length > 3 ? convertColorStr(val) : val
		                }
		              }
		              const val = Reflect.get(target, prop)
		              if (typeof val === "string" && val.length > 3) return convertColorStr(val)
		              if (typeof val === "function") return val.bind(target)
		              return val
		            }
		          }) as CSSStyleDeclaration
		        }

		        bridge.send({ type: "log", payload: { level: "info", message: "[caret] Color replacement: " + replacedCount + " in stylesheets, getComputedStyle patched" } })

		        let viewportCanvas: HTMLCanvasElement
		        try {
		          viewportCanvas = await html2canvas(document.documentElement, {
		            width: window.innerWidth,
		            height: window.innerHeight,
		            windowWidth: window.innerWidth,
		            windowHeight: window.innerHeight,
		            x: window.scrollX,
		            y: window.scrollY,
		            proxy: "/__caret/image-proxy",
		            useCORS: true,
		            scale: 1,
		            logging: false,
		            ignoreElements: (el: Element) => {
		              return el.classList?.contains("caret-overlay") || el.classList?.contains("caret-focused-fab")
		            },
		          })
		        } finally {
		          window.getComputedStyle = origGCS
		          originals.forEach((content, el) => { el.textContent = content })
		        }

		        const cropCanvas = document.createElement("canvas")
		        cropCanvas.width = rect.w
		        cropCanvas.height = rect.h
		        const cropCtx = cropCanvas.getContext("2d")
		        if (!cropCtx) throw new Error("Failed to get crop canvas context")
		        cropCtx.drawImage(viewportCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)

		        screenshotDataUrl = cropCanvas.toDataURL("image/png")
		      } catch (captureErr: any) {
		        bridge.send({ type: "log", payload: { level: "error", message: "[caret] Screenshot capture failed: " + (captureErr?.message || captureErr) } })
		      }

		      bridge.send({
		        type: "overlay-edit",
		        payload: {
		          instruction: instruction.trim(),
		          screenshotDataUrl,
		          regionBounds: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
		          filePath: focusedPage?.filePath || "",
		        },
		      })

		      setRect(null)
		      setInstruction("")
		      onClose()
		    } catch (err) {
		      console.error("[caret] Overlay submit failed:", err)
		    } finally {
		      setSending(false)
		    }
		  }, [rect, instruction, onClose])

		  return (
		    <div
		      className="caret-overlay"
		      onPointerDown={handlePointerDown}
		      onPointerMove={handlePointerMove}
		      onPointerUp={handlePointerUp}
		    >
		      {rect && (
		        <>
		          <div className="caret-overlay-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
		          {!drawing && rect.w > 20 && rect.h > 20 && (
		            <div className="caret-overlay-prompt" style={{ left: rect.x, top: rect.y + rect.h + 8 }}>
		              <input
		                autoFocus
		                placeholder="Describe the change..."
		                value={instruction}
		                onChange={e => setInstruction(e.target.value)}
		                onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") { setRect(null); onClose() } }}
		                disabled={sending}
		              />
		              <button onClick={handleSubmit} disabled={sending || !instruction.trim()}>
		                {sending ? "..." : "→"}
		              </button>
		            </div>
		          )}
		        </>
		      )}
		    </div>
		  )
		}
	`
}

function generateCanvasCSS(): string {
	return dedent`
		.caret-canvas-container {
		  position: fixed;
		  inset: 0;
		  overflow: hidden;
		  background: #0a0a0a;
		  user-select: none;
		}

		.caret-canvas-content {
		  position: absolute;
		  top: 0;
		  left: 0;
		  will-change: transform;
		}

		.caret-canvas-toolbar {
		  position: fixed;
		  bottom: 16px;
		  left: 50%;
		  transform: translateX(-50%);
		  display: flex;
		  align-items: center;
		  gap: 2px;
		  padding: 4px 6px;
		  background: #1e1e1e;
		  border: 1px solid #333;
		  border-radius: 24px;
		  z-index: 100;
		  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
		}

		.caret-tb-btn {
		  background: none;
		  border: none;
		  color: #999;
		  width: 32px;
		  height: 32px;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  border-radius: 50%;
		  cursor: pointer;
		  padding: 0;
		  transition: background 0.15s, color 0.15s;
		}
		.caret-tb-btn:hover { background: #333; color: #ddd; }
		.caret-tb-btn.active { background: #2563eb; color: #fff; }

		.caret-tb-sep {
		  width: 1px;
		  height: 20px;
		  background: #444;
		  margin: 0 4px;
		  flex-shrink: 0;
		}

		.caret-canvas-zoom-label {
		  color: #888;
		  font-size: 11px;
		  font-family: monospace;
		  min-width: 36px;
		  text-align: center;
		  padding: 0 4px;
		}

		.caret-flow-legend {
		  position: fixed;
		  bottom: 60px;
		  left: 50%;
		  transform: translateX(-50%);
		  display: flex;
		  gap: 16px;
		  padding: 6px 14px;
		  background: #1e1e1e;
		  border: 1px solid #333;
		  border-radius: 8px;
		  z-index: 100;
		  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
		}

		.caret-flow-legend-item {
		  display: flex;
		  align-items: center;
		  gap: 6px;
		  font-size: 12px;
		  color: #999;
		  cursor: pointer;
		  white-space: nowrap;
		}
		.caret-flow-legend-item:hover { color: #ddd; }
		.caret-flow-legend-item.active { color: #fff; }

		.caret-flow-legend-dot {
		  width: 8px;
		  height: 8px;
		  border-radius: 50%;
		  flex-shrink: 0;
		}

		.caret-canvas-empty {
		  position: fixed;
		  inset: 0;
		  display: flex;
		  flex-direction: column;
		  align-items: center;
		  justify-content: center;
		  background: #0a0a0a;
		  color: #666;
		}
		.caret-canvas-empty-icon { font-size: 48px; margin-bottom: 16px; }
		.caret-canvas-empty h2 { font-size: 20px; color: #999; margin-bottom: 8px; }
		.caret-canvas-empty p { font-size: 14px; }

		/* Frame — Figma-style artboard */
		.caret-canvas-frame {
		  display: flex;
		  flex-direction: column;
		}

		.caret-canvas-frame-label {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 0 0 6px;
		  min-height: 20px;
		}

		.caret-canvas-frame-title {
		  font-size: 12px;
		  color: #888;
		  font-weight: 500;
		  white-space: nowrap;
		  overflow: hidden;
		  text-overflow: ellipsis;
		}

		.caret-canvas-frame:hover .caret-canvas-frame-title {
		  color: #ddd;
		}

		.caret-canvas-frame-tags {
		  display: flex;
		  gap: 4px;
		}

		.caret-canvas-frame-tag {
		  font-size: 9px;
		  padding: 1px 5px;
		  border-radius: 3px;
		  background: #222;
		  color: #666;
		}

		.caret-canvas-frame-viewport {
		  position: relative;
		  overflow: hidden;
		  border-radius: 4px;
		  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
		  background: #fff;
		}

		.caret-canvas-frame:hover .caret-canvas-frame-viewport {
		  box-shadow: 0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.5);
		}

		.caret-canvas-frame-iframe {
		  transform-origin: top left;
		  border: none;
		  pointer-events: none;
		  display: block;
		}

		/* Focused page view */
		.caret-focused {
		  position: fixed;
		  inset: 0;
		  overflow-y: auto;
		  background: #fff;
		}

		.caret-focused-fab {
		  position: fixed;
		  top: 12px;
		  left: 12px;
		  z-index: 9999;
		  width: 36px;
		  height: 36px;
		  display: flex;
		  align-items: center;
		  justify-content: center;
		  background: rgba(255, 255, 255, 0.15);
		  color: #fff;
		  border: 1px solid rgba(255, 255, 255, 0.2);
		  border-radius: 50%;
		  cursor: pointer;
		  font-size: 16px;
		  backdrop-filter: blur(12px);
		  -webkit-backdrop-filter: blur(12px);
		  transition: background 0.15s, border-color 0.15s;
		  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
		  padding: 0;
		  line-height: 1;
		}
		.caret-focused-fab:hover {
		  background: rgba(255, 255, 255, 0.25);
		  border-color: rgba(255, 255, 255, 0.35);
		}
		/* Dark variant applied when the page behind the buttons is light.
		   The fabs-on-light class is toggled on the shell root by FocusedApp. */
		.caret-focused.fabs-on-light .caret-focused-fab:not(.active) {
		  background: rgba(17, 24, 39, 0.65);
		  border-color: rgba(17, 24, 39, 0.45);
		}
		.caret-focused.fabs-on-light .caret-focused-fab:not(.active):hover {
		  background: rgba(17, 24, 39, 0.85);
		  border-color: rgba(17, 24, 39, 0.65);
		}

		.caret-focused-content {
		  min-height: 100%;
		}

		/* Group headers */
		.caret-canvas-group-header {
		  font-size: 12px;
		  font-weight: 600;
		  color: #666;
		  text-transform: uppercase;
		  letter-spacing: 0.05em;
		  padding: 4px 0;
		  white-space: nowrap;
		}

		/* Drag states */
		.caret-canvas-thumb-wrapper.dragging {
		  z-index: 10;
		  opacity: 0.85;
		}
		.caret-canvas-thumb-wrapper {
		  transition: none;
		}

		/* Error fallback */
		.caret-canvas-error {
		  display: flex;
		  flex-direction: column;
		  align-items: center;
		  justify-content: center;
		  min-height: 50vh;
		  color: #888;
		  text-align: center;
		}
		.caret-canvas-error h2 { font-size: 18px; color: #ccc; margin-bottom: 8px; }
		.caret-canvas-error p { font-size: 13px; }

		/* Focused shell (thin iframe wrapper) */
		.caret-focused-shell {
		  position: fixed;
		  inset: 0;
		  display: flex;
		  flex-direction: column;
		  background: #0a0a0a;
		}

		.caret-focused-toolbar {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 6px 12px;
		  background: #1a1a1a;
		  border-bottom: 1px solid #333;
		  z-index: 10;
		  flex-shrink: 0;
		}

		.caret-focused-toolbar-btn {
		  background: none;
		  border: 1px solid #444;
		  color: #ccc;
		  padding: 4px 8px;
		  border-radius: 4px;
		  cursor: pointer;
		  font-size: 13px;
		  white-space: nowrap;
		}
		.caret-focused-toolbar-btn:hover { background: #333; }
		.caret-focused-toolbar-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }

		.caret-focused-toolbar-title {
		  color: #999;
		  font-size: 13px;
		  font-weight: 500;
		  margin-right: auto;
		  white-space: nowrap;
		  overflow: hidden;
		  text-overflow: ellipsis;
		}

		.caret-focused-viewport-selector {
		  display: flex;
		  gap: 4px;
		}

		.caret-focused-iframe-container {
		  flex: 1;
		  display: flex;
		  justify-content: center;
		  overflow: auto;
		  background: #111;
		}

		.caret-focused-iframe {
		  border: none;
		  height: 100%;
		  background: #fff;
		}

		/* Simulation mode */
		.caret-simulation-shell {
		  position: fixed;
		  inset: 0;
		  display: flex;
		  flex-direction: column;
		  background: #0a0a0a;
		}

		.caret-simulation-toolbar {
		  display: flex;
		  align-items: center;
		  gap: 8px;
		  padding: 6px 12px;
		  background: #1a1a1a;
		  border-bottom: 1px solid #333;
		  z-index: 10;
		  flex-shrink: 0;
		}

		.caret-sim-btn {
		  background: none;
		  border: 1px solid #444;
		  color: #ccc;
		  padding: 4px 8px;
		  border-radius: 4px;
		  cursor: pointer;
		  font-size: 13px;
		  white-space: nowrap;
		}
		.caret-sim-btn:hover { background: #333; }
		.caret-sim-btn:disabled { opacity: 0.4; cursor: default; }
		.caret-sim-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; }

		.caret-sim-page-label {
		  color: #999;
		  font-size: 13px;
		  margin-right: auto;
		}

		.caret-sim-viewport-selector {
		  display: flex;
		  gap: 4px;
		}

		.caret-simulation-content {
		  flex: 1;
		  display: flex;
		  justify-content: center;
		  align-items: flex-start;
		  overflow: auto;
		  padding: 24px;
		}

		.caret-simulation-device-frame {
		  background: #fff;
		  border-radius: 8px;
		  overflow: hidden;
		  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
		  height: calc(100vh - 100px);
		}

		.caret-simulation-iframe {
		  width: 100%;
		  height: 100%;
		  border: none;
		}

		/* Canvas flow overlay */
		.caret-canvas-flow-overlay {
		  position: absolute;
		  top: 0;
		  left: 0;
		  pointer-events: none;
		  overflow: visible;
		}
		.caret-canvas-flow-overlay g { pointer-events: auto; }

		/* Edge connector dots — hollow ring, distinct from solid destination dots */
		.caret-edge-connector {
		  position: absolute;
		  right: -7px;
		  /* top is set inline per page from the edge-port distribution */
		  transform: translateY(-50%);
		  width: 14px;
		  height: 14px;
		  border-radius: 50%;
		  background: transparent;
		  border: 3px solid #3b82f6;
		  cursor: crosshair;
		  z-index: 10;
		  opacity: 1;
		  transition: transform 0.15s, background 0.15s;
		}
		.caret-edge-connector:hover {
		  transform: translateY(-50%) scale(1.2);
		  background: #3b82f6;
		}

		/* (old canvas viewport selector removed — integrated into toolbar) */

		/* Paint mode button */
		.caret-focused-paint-btn {
		  top: 12px;
		  left: 56px;
		}

		.caret-focused-sim-btn {
		  top: 12px;
		  left: 100px;
		}
		.caret-focused-paint-btn.active {
		  background: rgba(59, 130, 246, 0.4);
		  border-color: rgba(59, 130, 246, 0.6);
		}

		/* Overlay painter */
		.caret-overlay {
		  position: fixed;
		  inset: 0;
		  z-index: 9998;
		  cursor: crosshair;
		  background: rgba(0, 0, 0, 0.1);
		}

		.caret-overlay-rect {
		  position: fixed;
		  border: 2px solid #3b82f6;
		  background: rgba(59, 130, 246, 0.08);
		  pointer-events: none;
		}

		.caret-overlay-prompt {
		  position: fixed;
		  display: flex;
		  gap: 4px;
		  z-index: 9999;
		}

		.caret-overlay-prompt input {
		  padding: 6px 10px;
		  border: 1px solid #555;
		  border-radius: 6px;
		  background: #1a1a1a;
		  color: #eee;
		  font-size: 13px;
		  width: 280px;
		  outline: none;
		}
		.caret-overlay-prompt input:focus {
		  border-color: #3b82f6;
		}

		.caret-overlay-prompt button {
		  padding: 6px 10px;
		  border: 1px solid #555;
		  border-radius: 6px;
		  background: #3b82f6;
		  color: #fff;
		  cursor: pointer;
		  font-size: 13px;
		}
		.caret-overlay-prompt button:disabled {
		  opacity: 0.5;
		  cursor: default;
		}
	`
}

function generateBridge(): string {
	return dedent`
		type MessageHandler = (data: any) => void

		const listeners: Map<string, Set<MessageHandler>> = new Map()

		function showToast(message: string, isError: boolean) {
		  const el = document.createElement("div")
		  el.textContent = message
		  Object.assign(el.style, {
		    position: "fixed", bottom: "20px", right: "20px", zIndex: "99999",
		    padding: "8px 16px", borderRadius: "6px", fontSize: "13px",
		    background: isError ? "#dc2626" : "#16a34a", color: "#fff",
		    boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "opacity 0.3s",
		  })
		  document.body.appendChild(el)
		  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300) }, 2500)
		}

		window.addEventListener("message", (e) => {
		  if (e.data?.source !== "caret-extension") return

		  if (e.data.type === "edit-result") {
		    const { success, error } = e.data.payload
		    if (!success) showToast(error || "Edit failed", true)
		  }

		  const handlers = listeners.get(e.data.type)
		  if (handlers) {
		    handlers.forEach(fn => fn(e.data.payload))
		  }
		})

		export const bridge = {
		  send(message: { type: string; payload: unknown }) {
		    window.parent.postMessage({ source: "caret-vite", ...message }, "*")
		  },

		  on(type: string, handler: MessageHandler) {
		    if (!listeners.has(type)) listeners.set(type, new Set())
		    listeners.get(type)!.add(handler)
		    return () => { listeners.get(type)?.delete(handler) }
		  },
		}
	`
}

function generateCaretGrabPlugin(): string {
	return dedent`
		import { bridge } from "./bridge"

		function log(...args: unknown[]) {
		  console.log("[caret-grab]", ...args)
		  bridge.send({ type: "log", payload: { level: "info", message: args.map(String).join(" ") } })
		}

		function logError(...args: unknown[]) {
		  console.error("[caret-grab]", ...args)
		  bridge.send({ type: "log", payload: { level: "error", message: args.map(String).join(" ") } })
		}

		function getFocusedPage(): { pageId: string; filePath: string } | null {
		  return (window as any).__CARET_FOCUSED_PAGE__ || null
		}

		function isCanvasInfraFile(fp: string): boolean {
		  if (!fp) return true
		  return fp.includes("/lib/canvas/") || fp.includes("CanvasApp") || fp.includes("FocusedPageView") || fp.includes("PageThumbnail") || fp.includes("ErrorBoundary")
		}

		function getFiberFromElement(element: Element | Node): any {
		  let el: any = element
		  if (el.nodeType === 3) el = el.parentElement
		  if (!el) return null

		  const fiberKey = Object.keys(el).find((k: string) => k.startsWith("__reactFiber$"))
		  if (fiberKey) return el[fiberKey]

		  let parent = el.parentElement
		  while (parent) {
		    const key = Object.keys(parent).find((k: string) => k.startsWith("__reactFiber$"))
		    if (key) return parent[key]
		    parent = parent.parentElement
		  }
		  return null
		}

		type SourceLocation = { filePath: string; lineNumber: number; columnNumber: number; componentName: string }

		function parseDebugStack(debugStack: any): SourceLocation | null {
		  if (!debugStack) return null

		  let stackStr: string
		  if (typeof debugStack === "string") {
		    stackStr = debugStack
		  } else if (debugStack instanceof Error || typeof debugStack?.stack === "string") {
		    stackStr = debugStack.stack
		  } else {
		    return null
		  }

		  const lines = stackStr.split("\\n")
		  for (const line of lines) {
		    const match = line.match(/at\\s+(?:(\\S+)\\s+)?\\(?https?:\\/\\/[^/]+\\/(.+?):(\\d+):(\\d+)\\)?/)
		    if (!match) continue

		    const [, componentName, urlPath, lineStr] = match
		    const lineNumber = parseInt(lineStr, 10)

		    if (isCanvasInfraFile(urlPath)) continue
		    if (urlPath.includes("node_modules/")) continue
		    if (urlPath.startsWith("@") || urlPath.startsWith("vite/")) continue

		    return { filePath: urlPath, lineNumber, columnNumber: 0, componentName: componentName || "" }
		  }
		  return null
		}

		function resolveSourceFromFiber(element: Element | Node): SourceLocation | null {
		  try {
		    const fiber = getFiberFromElement(element)
		    if (!fiber) return null

		    const sourceMap: WeakMap<object, any> | undefined = (window as any).__caretSourceMap

		    let current = fiber
		    let depth = 0
		    while (current && depth < 30) {
		      // Priority 1: SWC __source via patched jsxDEV (exact line numbers)
		      if (sourceMap) {
		        const props = current.memoizedProps || current.pendingProps
		        if (props && typeof props === "object") {
		          const caretSource = sourceMap.get(props)
		          if (caretSource && caretSource.fileName) {
		            const rawPath = caretSource.fileName as string
		            const urlMatch = rawPath.match(/https?:\\/\\/[^/]+\\/(.+)/)
		            const filePath = urlMatch ? urlMatch[1] : rawPath
		            if (!isCanvasInfraFile(filePath) && !filePath.includes("node_modules/")) {
		              const componentName = typeof current.type === "function" ? (current.type.displayName || current.type.name || "") : ""
		              log("resolveSourceFromFiber: __caretSource hit", filePath, "line:", caretSource.lineNumber, "col:", caretSource.columnNumber)
		              return { filePath, lineNumber: caretSource.lineNumber || 0, columnNumber: caretSource.columnNumber || 0, componentName }
		            }
		          }
		        }
		      }
		      // Priority 2: _debugStack from React 19 (approximate line numbers)
		      if (current._debugStack) {
		        const result = parseDebugStack(current._debugStack)
		        if (result) return result
		      }
		      current = current.return
		      depth++
		    }
		    return null
		  } catch (err) {
		    logError("resolveSourceFromFiber failed:", err)
		    return null
		  }
		}

		let lastResolvedSource: SourceLocation | null = null

		const dynamicRangesMap: Map<string, Array<{ startLine: number; startCol: number; endLine: number; endCol: number; diagnostics: string[] }>> = new Map()

		function isInDynamicRange(filePath: string, line: number, col: number, diagnosticType?: string): boolean {
		  const ranges = dynamicRangesMap.get(filePath)
		  if (!ranges) return false
		  return ranges.some(r => {
		    const afterStart = line > r.startLine || (line === r.startLine && col >= r.startCol)
		    const beforeEnd = line < r.endLine || (line === r.endLine && col <= r.endCol)
		    const matches = afterStart && beforeEnd
		    return matches && (!diagnosticType || r.diagnostics.includes(diagnosticType))
		  })
		}

		function resolveElementSource(rgSource: any, element?: Element | Node): SourceLocation | null {
		  const page = getFocusedPage()
		  if (!page) return rgSource || null

		  if (element) {
		    const fiberSource = resolveSourceFromFiber(element)
		    if (fiberSource && !isCanvasInfraFile(fiberSource.filePath)) {
		      log("resolveElementSource: fiber hit", JSON.stringify(fiberSource))
		      lastResolvedSource = fiberSource
		      return fiberSource
		    }
		  }

		  if (rgSource && !isCanvasInfraFile(rgSource.filePath)) {
		    lastResolvedSource = rgSource
		    return rgSource
		  }

		  const fallback = { filePath: page.filePath, lineNumber: 0, columnNumber: 0, componentName: rgSource?.componentName || "" }
		  lastResolvedSource = fallback
		  return fallback
		}

		function showToast(message: string, type: "success" | "error") {
		  const toast = document.createElement("div")
		  toast.textContent = message
		  toast.style.cssText = \`position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;color:#fff;pointer-events:none;opacity:0;transition:opacity 0.2s;\${type === "success" ? "background:#16a34a;" : "background:#dc2626;"}\`
		  document.body.appendChild(toast)
		  requestAnimationFrame(() => { toast.style.opacity = "1" })
		  setTimeout(() => {
		    toast.style.opacity = "0"
		    setTimeout(() => toast.remove(), 200)
		  }, 3000)
		}

		function showAiEditFallback(errorMessage: string) {
		  const existing = document.getElementById("caret-ai-edit-fallback")
		  if (existing) existing.remove()

		  const card = document.createElement("div")
		  card.id = "caret-ai-edit-fallback"
		  card.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#1e1e2e;border:1px solid #444;border-radius:12px;padding:16px 20px;font-family:system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);max-width:400px;width:90%;"

		  const closeBtn = document.createElement("button")
		  closeBtn.textContent = "×"
		  closeBtn.style.cssText = "position:absolute;top:8px;right:12px;background:none;border:none;color:#a1a1aa;font-size:20px;cursor:pointer;padding:0;line-height:1;"
		  closeBtn.addEventListener("click", () => card.remove())
		  card.appendChild(closeBtn)

		  const msg = document.createElement("p")
		  msg.textContent = errorMessage
		  msg.style.cssText = "margin:0 0 12px;font-size:13px;color:#f87171;line-height:1.4;padding-right:20px;"
		  card.appendChild(msg)

		  const label = document.createElement("p")
		  label.textContent = "Describe what you want to change:"
		  label.style.cssText = "margin:0 0 8px;font-size:12px;color:#a1a1aa;"
		  card.appendChild(label)

		  const row = document.createElement("div")
		  row.style.cssText = "display:flex;gap:8px;"

		  const input = document.createElement("input")
		  input.type = "text"
		  input.placeholder = "e.g. Change text to 'Hello World'"
		  input.style.cssText = "flex:1;padding:8px 12px;border-radius:6px;border:1px solid #555;background:#2a2a3e;color:#fff;font-size:13px;outline:none;"
		  row.appendChild(input)

		  const btn = document.createElement("button")
		  btn.textContent = "Send"
		  btn.style.cssText = "padding:8px 16px;border-radius:6px;border:none;background:#6366f1;color:#fff;font-size:13px;cursor:pointer;font-weight:500;"
		  row.appendChild(btn)

		  card.appendChild(row)
		  document.body.appendChild(card)
		  input.focus()

		  const submit = () => {
		    const text = input.value.trim()
		    if (!text || !lastResolvedSource) return
		    log("ai-edit-fallback: submitting", text)
		    bridge.send({
		      type: "ai-edit-request",
		      payload: {
		        instruction: text,
		        filePath: lastResolvedSource.filePath,
		        lineNumber: lastResolvedSource.lineNumber,
		        columnNumber: lastResolvedSource.columnNumber,
		        componentName: lastResolvedSource.componentName,
		        caretId: "",
		        componentStack: "",
		      },
		    })
		    card.remove()
		  }

		  btn.addEventListener("click", submit)
		  input.addEventListener("keydown", (e: KeyboardEvent) => {
		    if (e.key === "Enter") submit()
		    if (e.key === "Escape") card.remove()
		  })
		}

		async function initPlugin() {
		  log("initializing caret-grab-plugin")

		  bridge.on("edit-result", (payload: any) => {
		    if (payload.success) {
		      log("edit-result: SUCCESS")
		      showToast("Edit applied", "success")
		    } else if (payload.suggestAiEdit && lastResolvedSource) {
		      logError("edit-result: FAILED (suggesting AI edit) -", payload.error)
		      showAiEditFallback(payload.error || "This content can't be edited inline.")
		    } else {
		      logError("edit-result: FAILED -", payload.error || "unknown error")
		      showToast(payload.error || "Edit failed", "error")
		    }
		  })

		  bridge.on("precompute-result", (payload: any) => {
		    if (payload.filePath && Array.isArray(payload.dynamicRanges)) {
		      dynamicRangesMap.set(payload.filePath, payload.dynamicRanges)
		      log("precompute-result: loaded", payload.dynamicRanges.length, "dynamic ranges for", payload.filePath)
		    }
		  })

		  const rg = await import("react-grab")
		  const api = (window as any).__REACT_GRAB__
		  log("react-grab loaded, api exists:", !!api)

		  if (!api) {
		    logError("window.__REACT_GRAB__ is null after import — react-grab failed to self-init")
		    return
		  }

		  rg.registerPlugin({
		    name: "caret",
		    hooks: {
		      async onElementSelect(element: Element) {
		        try {
		          const rgSource = await api.getSource(element)
		          const source = resolveElementSource(rgSource, element)
		          log("onElementSelect:", JSON.stringify(source), "(raw:", JSON.stringify(rgSource), ")")
		          if (!source) return true
		          bridge.send({
		            type: "element-selected",
		            payload: {
		              filePath: source.filePath,
		              lineNumber: source.lineNumber,
		              componentName: source.componentName,
		              tagName: element.tagName.toLowerCase(),
		              props: {},
		            },
		          })
		        } catch (err) {
		          logError("onElementSelect error:", err)
		        }
		        return true
		      },

		      onOpenFile(filePath: string, lineNumber?: number) {
		        const page = getFocusedPage()
		        if (page && isCanvasInfraFile(filePath)) {
		          const resolved = lastResolvedSource?.filePath || page.filePath
		          const resolvedLine = lastResolvedSource?.lineNumber || lineNumber
		          log("onOpenFile:", resolved, resolvedLine, "(from cached fiber source)")
		          bridge.send({ type: "open-file", payload: { filePath: resolved, lineNumber: resolvedLine } })
		        } else {
		          log("onOpenFile:", filePath, lineNumber)
		          bridge.send({ type: "open-file", payload: { filePath, lineNumber } })
		        }
		        return true
		      },

		      onPromptModeChange(isPrompt: boolean) {
		        if (!isPrompt) return
		        log("prompt mode activated, waiting for input element")

		        let attempts = 0
		        const tryAttach = () => {
		          attempts++
		          const host = document.querySelector("[data-react-grab]")
		          if (!host?.shadowRoot) { logError("prompt mode: no shadow root"); return }
		          const input = host.shadowRoot.querySelector("textarea") || host.shadowRoot.querySelector("input[type=text]") || host.shadowRoot.querySelector("input")
		          if (!input) {
		            if (attempts < 20) { setTimeout(tryAttach, 50); return }
		            logError("prompt mode: no input element found after " + attempts + " attempts")
		            return
		          }
		          log("prompt mode: input found after " + attempts + " attempts")
		          let pendingValue = ""
		          const onInput = () => { pendingValue = (input as HTMLInputElement | HTMLTextAreaElement).value }
		          const handler = (e: KeyboardEvent) => {
		            if (e.key !== "Enter" || e.shiftKey) return
		            const prompt = pendingValue.trim() || (input as HTMLInputElement | HTMLTextAreaElement).value.trim()
		            if (!prompt || !lastResolvedSource) {
		              log("prompt submit skipped: prompt=" + JSON.stringify(prompt) + " source=" + JSON.stringify(lastResolvedSource))
		              return
		            }
		            log("prompt submitted:", prompt, "source:", JSON.stringify(lastResolvedSource))
		            const selectedEl = document.querySelector("[data-rg-selected]") as HTMLElement | null
		            bridge.send({
		              type: "ai-edit-request",
		              payload: {
		                instruction: prompt,
		                filePath: lastResolvedSource.filePath,
		                lineNumber: lastResolvedSource.lineNumber,
		                columnNumber: lastResolvedSource.columnNumber,
		                componentName: lastResolvedSource.componentName,
		                caretId: selectedEl?.getAttribute("data-caret-id") || "",
		                componentStack: "",
		              },
		            })
		            input.removeEventListener("keydown", handler, true)
		            input.removeEventListener("input", onInput)
		          }
		          input.addEventListener("input", onInput)
		          input.addEventListener("keydown", handler, true)
		        }
		        tryAttach()
		      },
		    },

		    actions: [
		      {
		        id: "caret-ai-edit",
		        label: "AI Edit",
		        onAction(ctx: any) {
		          const el = ctx.element
		          if (el) {
		            const source = resolveElementSource(null, el)
		            log("ai-edit action: resolved source before prompt mode", JSON.stringify(source))
		          }
		          ctx.enterPromptMode?.()
		        },
		      },
		      {
		        id: "caret-edit-text",
		        label: "Edit text",
		        enabled: (ctx: any) => {
		          const el = ctx.element
		          if (!el) return false
		          const directText = Array.from(el.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent || "").join("")
		          if (!directText.trim()) return false
		          const allText = el.textContent || ""
		          if (directText.trim() !== allText.trim()) return false
		          const source = resolveSourceFromFiber(el)
		          if (source && isInDynamicRange(source.filePath, source.lineNumber, source.columnNumber, "dynamic-text")) return false
		          return true
		        },
		        async onAction(ctx: any) {
		          const el = ctx.element
		          if (!el) return
		          const source = resolveElementSource(null, el)
		          const filePath = source?.filePath
		          if (!filePath) { logError("edit-text: no filePath"); return }
		          const lineNumber = source?.lineNumber || 0
		          log("edit-text action:", filePath, "line:", lineNumber, el.tagName, el.textContent?.slice(0, 40))

		          const original = el.textContent || ""
		          el.contentEditable = "true"
		          el.focus()

		          let editSent = false
		          const finish = () => {
		            if (editSent) return
		            editSent = true
		            el.contentEditable = "false"
		            el.removeEventListener("blur", onBlur)
		            el.removeEventListener("keydown", onKeyDown)
		            const newText = el.textContent || ""
		            if (newText !== original) {
		              log("edit-text: sending", filePath, JSON.stringify(original), "->", JSON.stringify(newText))
		              bridge.send({
		                type: "inline-edit",
		                payload: {
		                  editType: "text",
		                  filePath,
		                  lineNumber,
		                  oldValue: original,
		                  newValue: newText,
		                  tagName: el.tagName.toLowerCase(),
		                  caretId: el.getAttribute("data-caret-id") || "",
		                },
		              })
		            }
		          }

		          const onBlur = () => finish()
		          const onKeyDown = (e: KeyboardEvent) => {
		            if (e.key === "Enter" && !e.shiftKey) {
		              e.preventDefault()
		              finish()
		            }
		            if (e.key === "Escape") {
		              editSent = true
		              el.textContent = original
		              el.contentEditable = "false"
		              el.removeEventListener("blur", onBlur)
		              el.removeEventListener("keydown", onKeyDown)
		            }
		          }

		          el.addEventListener("blur", onBlur)
		          el.addEventListener("keydown", onKeyDown)
		        },
		      },
		      {
		        id: "caret-edit-color",
		        label: "Edit color",
		        enabled: (ctx: any) => {
		          const el = ctx.element
		          if (!el) return false
		          const source = resolveSourceFromFiber(el)
		          if (source && isInDynamicRange(source.filePath, source.lineNumber, source.columnNumber, "dynamic-tailwind-class")) return false
		          return true
		        },
		        onAction(ctx: any) {
		          const el = ctx.element
		          if (!el) return
		          const source = resolveElementSource(null, el)
		          const filePath = source?.filePath
		          if (!filePath) { logError("edit-color: no filePath"); return }
		          const lineNumber = source?.lineNumber || 0
		          log("edit-color action:", filePath, "line:", lineNumber)

		          const computed = window.getComputedStyle(el)
		          const currentColor = computed.backgroundColor || computed.color || "#000000"

		          const toHex = (c: string): string => {
		            const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/)
		            if (!m) return c.startsWith("#") ? c : "#000000"
		            return "#" + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, "0")).join("")
		          }

		          const input = document.createElement("input")
		          input.type = "color"
		          input.value = toHex(currentColor)
		          input.style.position = "fixed"
		          input.style.opacity = "0"
		          input.style.pointerEvents = "none"
		          document.body.appendChild(input)

		          input.addEventListener("input", (e) => {
		            bridge.send({
		              type: "inline-edit",
		              payload: {
		                editType: "color",
		                filePath,
		                lineNumber,
		                oldValue: "",
		                newValue: (e.target as HTMLInputElement).value,
		                caretId: el.getAttribute("data-caret-id") || "",
		              },
		            })
		          })

		          const rg = (window as any).__REACT_GRAB__
		          if (rg) rg.deactivate()

		          input.addEventListener("change", () => {
		            document.body.removeChild(input)
		            if (rg) rg.activate()
		          })

		          input.click()
		        },
		      },
		      {
		        id: "caret-replace-image",
		        label: "Replace image",
		        enabled: (ctx: any) => {
		          if (ctx.element?.tagName !== "IMG") return false
		          const source = resolveSourceFromFiber(ctx.element)
		          if (source && isInDynamicRange(source.filePath, source.lineNumber, source.columnNumber, "dynamic-image-src")) return false
		          return true
		        },
		        onAction(ctx: any) {
		          const el = ctx.element
		          if (!el) return
		          const source = resolveElementSource(null, el)
		          const filePath = source?.filePath
		          if (!filePath) { logError("replace-image: no filePath"); return }
		          const lineNumber = source?.lineNumber || 0
		          log("replace-image action:", filePath, "line:", lineNumber)

		          const input = document.createElement("input")
		          input.type = "file"
		          input.accept = "image/*"

		          const rg = (window as any).__REACT_GRAB__
		          if (rg) rg.deactivate()

		          input.addEventListener("change", () => {
		            const file = input.files?.[0]
		            if (!file) {
		              if (rg) rg.activate()
		              return
		            }
		            const reader = new FileReader()
		            reader.onload = () => {
		              bridge.send({
		                type: "inline-edit",
		                payload: {
		                  editType: "image",
		                  filePath,
		                  lineNumber,
		                  oldValue: "",
		                  newValue: file.name,
		                  imageData: reader.result as string,
		                  caretId: el.getAttribute("data-caret-id") || "",
		                },
		              })
		              if (rg) rg.activate()
		            }
		            reader.readAsDataURL(file)
		          })

		          input.click()
		        },
		      },
		    ],
		  })

		  log("caret plugin registered")
		}

		initPlugin().catch((err) => {
		  console.error("[caret-grab] initPlugin failed:", err)
		  bridge.send({ type: "log", payload: { level: "error", message: "initPlugin failed: " + String(err) } })
		})
	`
}

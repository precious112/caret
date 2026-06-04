# Caret — Build Phases

Each phase delivers something usable and testable. Dependencies flow forward. Mark each phase as you complete and verify it.

**Status key:** `[ ]` = pending · `[~]` = in progress · `[x]` = complete

For detailed design context behind each item, see [CARET-PLAN.md](./CARET-PLAN.md). For decision rationale, see [CARET-DECISIONS.md](./CARET-DECISIONS.md).

---

## [x] Phase 1: Foundation — Design Layer Infrastructure

- [x] `.caret/` directory scaffolding (create on project init)
- [x] Token config schema (JSON format, `foundation.json`, namespaced files under `.caret/tokens/`)
- [x] Token wizard in IDE (hardcoded flow + AI-assisted, per-token bespoke widgets: color picker + auto-scale, Google Fonts picker, radius character slider, spacing toggle, vibe tags + free text)
- [x] Live preview surface in wizard (representative components update in real time as tokens are picked)
- [x] Rendering shell (Vite serves `.caret/pages/*/index.tsx` as routes)
- [x] Design mode toggle in IDE (switch between design and implementation modes)
- [x] AI generates React pages into `.caret/pages/` with token config injected into context
- [x] Page `meta.json` structure (id, title, type, states, tags)
- [x] Generator behavior: AI hoists shared patterns into `.caret/components/` before building pages

**Deliverable:** Dev can initialize a design layer, define tokens via wizard, generate design pages via AI, and preview them in Vite.

---

## [x] Phase 2: Web Platform + Canvas

- [x] Web platform codebase (React app, lives in Caret repo)
- [x] Embed as VS Code webview for design mode
- [x] Zoomable/pannable canvas with page thumbnail grid (default view: clean, no flow arrows)
- [x] Live iframe previews (each page rendered as scaled-down iframe — replaced screenshot pipeline)
- [x] Click-to-focus (mount live React for focused page, glass back button to canvas)
- [x] Live page rendering (iframes show actual content immediately — no placeholders needed)
- [x] Canvas page organization (by tags, flow grouping, or manual drag-positioning)

**Deliverable:** Dev sees all design pages on a canvas, clicks to focus and interact. Canvas performance handled via cached thumbnails.

---

## [x] Phase 3: Visual Editing

- [x] React Grab integration via npm dependency + Caret plugin (no fork needed — plugin system sufficient)
- [x] Element selection via React Fiber → source file, line, component name, props (React Grab + Caret plugin)
- [x] Message bridge: Vite iframe ↔ VS Code webview relay ↔ extension host (bidirectional postMessage)
- [x] Wire React Grab context directly into Caret's AI pipeline (plugin hooks → bridge → controller.initTask)
- [x] Inline text editing (right-click → "Edit text" → contentEditable → AST source write-back → HMR)
- [x] Inline color editing (right-click → "Edit color" → native color picker → AST source write-back → HMR)
- [x] Inline image editing (right-click → "Replace image" → file picker → save to assets → AST source write-back → HMR)
- [x] AI-assisted edits via React Grab's built-in prompt mode (floating text input → enriched prompt → AI → HMR)
- [x] Canvas overlay editor fallback (paint region → screenshot capture via image proxy → instruction → AI locates and modifies code)
- [x] Error feedback via toast notifications on edit-result messages
- [x] `data-caret-id` element lookup pipeline (AST editor uses caret IDs for precise element targeting)
- [x] Arbitrary Tailwind color class support (hex/rgb/hsl in `text-[#...]` / `bg-[#...]` patterns)

**Deliverable:** Full visual editing — select any element, make simple edits instantly, describe complex changes to AI.

---

## [x] Phase 3.5: Visual Editing Reliability Hardening

Goal: Make the visual editing algorithm more reliable and deterministic. The AI sometimes generates anti-patterns in design source code that break the inline editor — this phase auto-fixes deterministic issues and prevents users from hitting broken edit paths.

- [x] Auto-add missing `data-caret-id` on visible elements (pre-computation adds IDs on page focus)
- [x] Auto-convert inline styles to Tailwind arbitrary values (`style={{ color: "red" }}` → `className="text-[red]"`)
- [x] Detect dynamic text expressions and disable inline text editing (source range check in `enabled` callback)
- [x] Detect dynamic image sources and disable inline image replacement (source range check)
- [x] Detect dynamically constructed Tailwind class names and disable inline color editing (source range check)
- [x] Mark all `.map()`/`.forEach()`/`.flatMap()` content as non-inline-editable (iterator detection)
- [x] Wire column number through fiber source resolution for precise same-line element disambiguation
- [x] On-demand pre-computation on page focus + HMR (no file watchers, loading blocks interaction)
- [x] Precise AI edit context with exact element extraction via `findJSXElementAtPosition` and `findJSXElementByCaretId`
- [x] Harden AST editor: ambiguous fallback text replace refused, null guards, malformed JSX handled
- [x] System prompt hardening (inline styles emphasis, `.map()` guidance, nested element guidance)

**Deliverable:** Visual editing works reliably on real-world AI output. Anti-patterns are auto-fixed (caret-ids, inline styles) or prevented (dynamic content actions disabled at the source level).

---

## [ ] Phase 4: Flows + Simulation + State

- [ ] Flow definition files (`.caret/flows/*.flow.json` with page references, next/onError edges)
- [ ] Flow view overlay (user-toggled; React Flow or similar; color-coded per flow)
- [ ] Flow restructuring (drag edges → update `.flow.json` → AI prompts to update JSX navigation)
- [ ] Simulation mode (hide editor chrome, show single page in device frame, navigate via JSX links)
- [ ] Viewport presets (desktop 1440/1280, tablet 768, mobile 390/375) via iframe resize
- [ ] Desktop/tablet/mobile toggle persistent in toolbar (works in both canvas and simulation)
- [ ] State selector (dropdown populated from `meta.json` states; jump to any state without triggering it manually)

**Deliverable:** Flow visualization, user-flow simulation, responsive preview, state inspection.

---

## [ ] Phase 5: Sync + Collaboration + Deployment

- [ ] Design→app sync mechanic (`.caret/sync-state.json` tracks last-synced commit hash)
- [ ] Sync plan generation (AI reads git diff for intent + full state of both layers → produces plan covering UI + business logic)
- [ ] Sync triggers (manual "sync now" command + auto-prompt when new `.caret/` commits detected)
- [ ] Self-hosted web platform deployment (Docker image, GitHub API connection, GitHub OAuth)
- [ ] Git branching abstraction for non-devs (web platform auto-creates branches, PM sees "design draft for X")
- [ ] Web platform defaults to main (shipped state), toggle into in-flight design branches
- [ ] Permissions (edit by default, admin can restrict members to read-only)
- [ ] Stale design-branch notifications ("design branches awaiting sync")
- [ ] Voice input (BYOK speech-to-text API key in settings, transcribe → text pipeline)

**Deliverable:** Full V1 — design→code pipeline with team collaboration.

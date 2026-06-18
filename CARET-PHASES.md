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

## [x] Phase 4: Flows + Simulation + State

- [x] Flow definition files (`.caret/flows/*.flow.json` with page references, next/onError edges)
- [x] Flow view overlay (user-toggled; React Flow or similar; color-coded per flow)
- [x] Flow restructuring (drag edges → update `.flow.json` → AI prompts to update JSX navigation)
- [x] Simulation mode (hide editor chrome, show single page in device frame, navigate via JSX links)
- [x] Viewport presets (desktop 1440/1280, tablet 768, mobile 390/375) via iframe resize
- [x] Desktop/tablet/mobile toggle persistent in toolbar (works in both canvas and simulation)
- [x] State selector (dropdown populated from `meta.json` states; jump to any state without triggering it manually)

**Deliverable:** Flow visualization, user-flow simulation, responsive preview, state inspection.

### Reliability certification (post-Phase 4 hardening)

Design mode is hardened so failures are attributable to bad AI-generated content and surfaced visibly — never caret's own logic silently breaking or hiding data:

- [x] All flow/page/meta file writes are atomic (temp+rename) and serialized per file (`src/core/design/file-mutation-queue.ts`); inline edits, the precompute hook, and flow CRUD can no longer race each other into corrupt files
- [x] Flow CRUD resolves flows by id even when the filename doesn't match (AI-written flows were silently un-editable)
- [x] Corrupt/invalid `.flow.json` files render as flagged "invalid" legend entries with the parse error, plus a persistent canvas warnings chip — never silently dropped
- [x] A page dir without a working `index.tsx` shows a broken-page card instead of taking down the entire canvas; page iframes show readable error cards for missing/crashed pages
- [x] Edges referencing deleted pages are counted in the warnings chip (never auto-deleted)
- [x] `canvas-layout` writes are validated and atomic; corrupt layout files fall back to auto layout with a logged warning
- [x] Iframe message payloads are validated before reaching handlers; stale inline-edit targets (line drift after HMR) fall back safely instead of editing the wrong element
- [x] Design-mode activation is serialized (no double vite spawn) and an unexpected vite exit shows a Restart prompt instead of a dead iframe

**Re-certify after any rendering-shell change:** `npm run verify:design-shell` — boots the generated shell on a fixture project and runs a 14-scenario browser suite (happy paths + adversarial corruption); all scenarios must PASS.

---

## [x] Phase 5: Design → App Sync (V1)

Scoped to the sync mechanic for the V1 launch — it closes the core design→code loop and is sufficient to ship. Collaboration + deployment + voice are deferred to Phase 6.

- [x] Design→app sync mechanic (`.caret/sync-state.json` bookmark tracks the last-synced commit; advanced by our code, never by the model — `sync-state.ts`, `sync-completion.ts`)
- [x] Sync plan generation (specialized plan-mode `initTask`; the prompt hands the AI a net-changed **worklist**, NOT inlined file content, and instructs it to READ the current `.caret/` + app sources itself and reconcile against the current design as source of truth — `sync-prompt.ts`, `sync-orchestrator.ts`)
- [x] Net-diff worklist scoped to design content (`git diff --name-status <bookmark> HEAD` — cumulative, so superseded/reverted changes drop out; binary image assets filtered; no file content inlined, so prompt size stays flat regardless of design size — `getDesignLayerChangedFiles` in `src/utils/git.ts`)
- [x] Sync triggers (manual `caret.syncNow` command + `syncDesignToApp` RPC + auto-prompt `SyncWatcher` on new `.caret/` commits)
- [x] Mode/context flip on sync (forces Plan mode **and** the Design/Code toggle to Code — `sync-orchestrator.ts`)

**Deliverable:** One-way design→app sync — a dev hits "Sync now" (or accepts the auto-prompt), reviews an AI plan covering UI + logic changes, accepts (switches to Act), and the sync bookmark advances.

### Reliability certification (V1 hardening — verified end-to-end in a live Vue project, 2026-06-19)

- [x] **Bookmark advances reliably** — on *apply* (plan→Act via `togglePlanActMode` → `applySyncBookmark`, idempotent + exact-task-id gated) with `attempt_completion` as fallback. Fixes the bug where a plan-mode sync never reached completion, leaving the bookmark stuck at "never synced" so every sync re-reported the whole design layer. Verified: a one-page design change yields a **one-file** worklist, not ~16.
- [x] **Sync rollback** — a pre-sync checkpoint is captured at sync start; an **"Undo sync"** control restores the app files **and** reverts the bookmark to its pre-sync value, clears the pending record, and stops the task — while preserving the design change so the next sync re-offers it (`rollbackSync`, reuses the checkpoint shadow-git; `.caret/sync-state.json` is inside the snapshot)
- [x] **caret-ids never leak into app code** — the sync prompt instructs the AI to treat `data-caret-id` as design-only tooling metadata and omit it when translating
- [x] **caret-id authoring hardened** — precompute auto-heals to unique static ids (native + `motion.*` elements; converts dynamic ids, dedupes duplicates, strips ids inside `.map()`), plus the `/debug-ui-page` healing command and a shared `CARET_ID_RULES` constant used by both the system prompt and the command

**Known follow-ups (tracked, not blocking V1):** inline-text-edit indentation artifact in design source; component prop-threaded caret-ids (e.g. `data-caret-id={prop}` in a reused component) aren't auto-healed by precompute (use `/debug-ui-page`); rollback's app-restore currently requires the sync task to still be the active task.

---

## [ ] Phase 6: Collaboration + Deployment + Voice

Deferred from the original Phase 5 — not required for V1.

- [ ] Self-hosted web platform deployment (Docker image, GitHub API connection, GitHub OAuth)
- [ ] Git branching abstraction for non-devs (web platform auto-creates branches, PM sees "design draft for X")
- [ ] Web platform defaults to main (shipped state), toggle into in-flight design branches
- [ ] Permissions (edit by default, admin can restrict members to read-only)
- [ ] Stale design-branch notifications ("design branches awaiting sync")
- [ ] Voice input (BYOK speech-to-text API key in settings, transcribe → text pipeline)

**Deliverable:** Full V1+ — design→code pipeline with team collaboration.

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

**Known follow-ups (tracked, not blocking V1):** inline-text-edit indentation artifact in design source; component prop-threaded caret-ids (e.g. `data-caret-id={prop}` in a reused component) aren't auto-healed by precompute (use `/debug-ui-page`); rollback's app-restore currently requires the sync task to still be the active task; **overlay-editor screenshots aren't seen by native-tool models (Gemini, OpenAI-Responses) on _idle_ edits** — the image rides in `attempt_completion` tool-result feedback, which those formats serialize as text and drop (works on Anthropic and in fresh chats). Proper fix: have the completion-feedback path emit the image as a _separate following_ plain user message instead of inside the tool result (core change in `AttemptCompletionHandler`/task loop — deferred to avoid touching well-tested core/provider code).

---

## [x] Phase 5.5: Caret Identity, Quiet Design Edits, Orchestration & Search

Identity + UX polish plus two capability adds, slotted before Phase 6. The core `write_to_file`/`replace_in_file` tools and the single-task loop are untouched — design-mode quiet writes and sub-agent orchestration layer on top of existing infrastructure.

**Caret visual identity (styling only — no core logic):**

- [x] Distinct Caret blue accent across the webview (brand tokens `--caret-accent: #0B7AFF` / hover `#2E8BFF` / press `#0066DB`, navy `#16233D`), repointing `--accent`/`--primary`/`--color-accent`/legacy `--color-cline` and the dark-mode `--sidebar-primary` oklch — all in `webview-ui/src/theme.css`; optional chat-timeline `COLOR_BLUE` in `chat/colors.ts`. Neutrals stay bound to VS Code theme vars.
- [x] Restyle the chat widgets (tool-call rows, thinking block, task card) — unify corners to `rounded-lg`/`rounded-xl` (from raw 1–2px), add `fade-slide-in` entrance motion, accent the tool icons + context-window progress fill in Caret blue. **Active-glow status:** a `caret-pulse` glow border (`--caret-accent`) on only the single in-progress widget, settling to neutral when done — one moving accent per viewport as a real-time "working here" signal (`ChatRow.tsx`, `CodeAccordian.tsx`, `DiffEditRow.tsx`, `ThinkingRow.tsx`, `task-header/TaskHeader.tsx`, `ContextWindow.tsx`, `ui/progress.tsx`, `theme.css` — className/CSS only)
- [x] White rounded-corner backing behind the Caret icon in the chat (wrap `CaretCompactIcon`/`caret_icon.png` in a `bg-white rounded-*` chip where it renders in the chat — consistent with the tool-icon chip motif)

**De-Cline the user-facing surface:**

- [x] Replace user-facing "Cline" with the Caret product name across the webview — tool-approval headers in `chat/ChatRow.tsx` ("…edit this file", "…create a new file", "…read this file", "…execute this command", "…search the web", etc.), `BrowserSessionRow.tsx`, settings (`SettingsView.tsx` "About Cline", `AboutSection.tsx`, `FeatureSettingsSection.tsx`, model-picker help text), `ChatTextArea.tsx` Plan/Act copy
- [x] Replace user-facing "Cline" in extension-side strings the user reads (e.g. the `Cline tried to use … Retrying…` errors in `WriteToFileToolHandler.ts`, notifications)
- [x] Centralize the product name in one constant rather than hardcoding "Caret" in N places
- [x] **Preserve all internal identifiers** — `ClineMessage`/`ClineSay`/`ClineAsk`, `ClineDefaultTool`, `ClineProvider`, `.clineignore`, proto message/enum names, class/file names — renaming breaks the build

**Quiet design-mode file writes (background, no editor takeover):**

- [x] In **design mode only**, writes/creations under `.caret/` open the document headlessly (`vscode.workspace.openTextDocument`, no `vscode.diff` reveal, scroll/decoration no-op) so the live preview keeps focus — guarded on `isInDesignMode()` + a `.caret/` path check, isolated to `DiffViewProvider`/`VscodeDiffViewProvider`
- [x] Disk save (`saveDocument`) is unchanged, so Vite HMR updates the preview in realtime; the edit/create row still appears in the caret chat (handler `say("tool", …)` is independent of the editor)
- [x] Core `write_to_file`/`replace_in_file`/`apply_patch` handlers are byte-for-byte unchanged; normal coding mode and any non-`.caret/` path run the identical existing code (no regression)

**Orchestration + search:**

- [x] Enable + rebrand the existing parallel sub-agent engine (`SubagentToolHandler.ts`, up to 5 concurrent; `SubagentStatusRow.tsx` status-card display) — turn on `subagentsEnabled`, ensure it reads as Caret, verify tool requests/results surface in the chat. No multi-Task refactor.
- [x] Provider-agnostic / BYOK web search (default **Tavily** `api.tavily.com/search`, which returns cleaned per-result `content` natively — search + extraction in one call, no separate scraper) — add a `webSearchProvider` setting + secret `tavilySearchApiKey`, branch in `WebSearchToolHandler.execute()` so it works off Cline accounts and surfaces result content (not just links); existing Cline-account path and the `web_search` tool spec unchanged

**Deliverable:** Caret presents a distinct blue identity, the chat logo is legible, no user-facing "Cline" remains, design-mode edits land in `.caret/` and HMR the preview without hijacking the editor, and parallel sub-agents + provider-agnostic web search are available.

---

## ~~Phase 6: Collaboration + Deployment + Voice~~ — SUPERSEDED 2026-07-28

Scoped when Caret was a VS Code extension that owned its agent. Both premises changed.
See [CARET-V2-PLAN.md](./CARET-V2-PLAN.md) for the pivot and the engineering detail.
The one surviving idea is the *git branching abstraction for non-devs*, which turns out to
be the actual paid team product — it moves to Phase 11. Voice input is dropped.

---

# V2 — Desktop, agent-agnostic

Two decisions on 2026-07-28 reshape everything below:

1. **Caret stops owning the agent.** No bundled task loop. Caret exposes a local MCP server
   and is driven by whatever agent the user already runs (Claude Code, Codex, OpenCode,
   Kimi, GLM). Sync becomes an agent-invoked job.
2. **Caret becomes a standalone Electron desktop app**, not a VS Code extension or a
   VSCodium fork. The Open VSX extension is retired at its last published version.

Phases 7 and 8 ship almost nothing a user can see, and they are the entire difference
between capabilities that work and capabilities that are buggy. Do not skip them to get to
Phase 9.

---

## [ ] Phase 6: Desktop App + Agent Decoupling (v1)

**Gate — decide before writing code:**

- [ ] License for new code (recommendation: Apache-2.0 throughout; keeps SignPath eligibility)
- [ ] Thin auth stub present in v1 even while everything is free (retrofitting auth later is the painful part)
- [ ] One clean service-client seam so hosted features attach later without surgery
- [ ] Public commitment: the direct-manipulation editor is local-forever, free-forever

**Desktop shell (Electron — chosen over Tauri because Tauri's system webview renders WebKit on macOS and Chromium on Windows, so the same design would look different per machine):**

- [ ] App shell: windows, menus, native dialogs, preferences store (replaces `StateManager`/globalState)
- [ ] Project open: pick folder, detect or scaffold `.caret/`, recents
- [ ] De-vscode the design module — only 3 of 33 files couple to `vscode`: `preview-panel.ts`, `DesignMode.ts`, `SyncWatcher.ts`
- [ ] Electron window loads the Vite URL directly; the generated canvas in `.caret/lib/canvas/` needs no porting
- [ ] postMessage relay → Electron IPC; gRPC/proto controller plumbing retired
- [ ] Replace VS Code diff/editor integration including the Phase 5.5 quiet-write path
- [ ] Vite lifecycle, file watching (chokidar), git from the main process
- [ ] **Port `verify:design-shell`** — the 14-scenario harness is the reliability floor
- [ ] Ad-hoc codesign for Apple Silicon (free, but arm64 will not launch without it)
- [ ] Unsigned builds: macOS `.zip`, Windows `.exe`, Linux AppImage/`.deb`/`.rpm`

**Agent decoupling + MCP:**

- [ ] Agent-adapter boundary replacing every `controller.initTask()` call site
- [ ] Local MCP server over HTTP, auto-starting on project open
- [ ] Tools v1: read `.caret/` structure, pages, tokens, **flows and page states**, screenshots; write pages and components; sync worklist
- [ ] **`get_guide` tool** — `design_layer.ts` (the always-on design-mode system prompt: `useCaretState()`, `useCaretNavigator()`, flow authoring, caret-id rules) has nowhere to live once the bundled agent is gone. It migrates to an MCP resource, or every connected agent authors `.caret/` pages wrong.
- [ ] **The no-agent state** — canvas fully usable with nothing connected
- [ ] Client configs + docs: Claude Code, Cursor, Codex, OpenCode, Kimi, GLM
- [ ] Delete: `src/core/api` (84 files), `src/core/task` (86), `src/core/prompts` (115), most of `src/core/controller` (207), checkpoint manager, terminal, browser tool

**Parameter-model substrate (the part Phase 7 needs in order to ship anything):**

- [ ] Selection payload v2: caret-id, resolved path, computed styles, box geometry
- [ ] `Param` descriptor + registry
- [ ] Splice write primitive replacing recast for span replacements
- [ ] Build-time caret-id codemod: promote `page-precompute.ts`, append-only, parse-only + splice
- [ ] Generalize `InlineEditPayload` from `editType: "text"|"color"|"image"` to `{path, value}`
- [ ] Property panel: every CSS property, token-aware, override vs token visible

**Ship-readiness:**

- [ ] First-run onboarding: scaffold, token wizard, connect an agent
- [ ] Migration for existing `.caret/` projects
- [ ] Docs site + landing page (also the SignPath prerequisite)
- [ ] Crash and error surfaces without the VS Code notification host
- [ ] Deprecation notice shipped **in** the final Open VSX extension release
- [ ] Install instructions using the macOS Sequoia flow (System Settings → Privacy & Security → Open Anyway); the Control-click bypass was removed

**Deliverable:** Caret runs standalone, works with any MCP agent, edits far more than three properties, and ships unsigned on macOS/Linux/Windows.

---

## [ ] Phase 7: Parameter Model complete

- [ ] Resolution chain: literal → binding-follow → literal-array-index → typed refusal with reason
- [ ] Lint rule + autofix for `dynamic-tailwind-class`
- [ ] Editor absorbs fragmented text, `dynamic-text`, `dynamic-image-src`, inline styles
- [ ] Instance discriminator so `.map()`-rendered content becomes editable
- [ ] Multi-select + bulk edit
- [ ] Unified undo/redo across inline and agent edits

**Deliverable:** `CARET_ID_RULES` + `INLINE_EDITING_RULES` shrink from twelve rules to roughly one (Tailwind's own constraint), and `/debug-ui-page` becomes a rare judgment-call tool rather than routine maintenance.

---

## [ ] Phase 8: Reverse Sync

- [ ] Design↔app mapping manifest (replaces the lone `lastSyncedCommit` field)
- [ ] App drift detection
- [ ] App→design sync path
- [ ] Incremental sync driven by the manifest instead of full re-reconciliation
- [ ] Framework-agnostic checkpoint: verified against Vue and Svelte, not only React

**Deliverable:** `.caret/` stops being able to silently lie. Prerequisite for both collaboration and CI drift diffs.

---

## [ ] Phase 9: Precision & Canvas Robustness

- [ ] Snapping, smart guides, align and distribute
- [ ] Drag to resize and reposition, writing back flexbox/grid rather than absolute offsets
- [ ] Layers panel mirroring the JSX tree
- [ ] Canvas perf: virtualized iframes, 60fps at 200+ artboards
- [ ] Full keyboard map

---

## [ ] Phase 10: Expressive Widgets

- [ ] Gradients (canvas-draggable stops), text gradients, shadows, blend modes, effect tokens
- [ ] Motion tokens, easing curve editor, timeline scrubbing, scroll-driven animation, flow-step transitions
- [ ] 3D: R3F scene addressing, transform gizmo, material panel, shader uniform sliders
- [ ] Lottie / Rive / glTF import into `.caret/assets/`

Explicitly **not** building: pen tool, vector illustration, raster painting, video compositing. Import, do not author.

---

## [ ] Phase 11: Share, then Collaboration

- [ ] **Share** — one-click hosted URL for a canvas or page. First hosted feature, first revenue, and the first increment of the team product (same infrastructure).
- [ ] Git branching abstraction for non-devs (PM sees "design draft for X") — the surviving idea from old Phase 6
- [ ] Permissions, review surface, stale design-branch notifications
- [ ] CI visual diffs: *"did the app drift from the design"*, compared semantically on resolved `Param` values, never pixels

**Deliverable:** desktop authors, web viewers. Engineers and designers work locally against the real repo; PMs and clients open a URL and install nothing.

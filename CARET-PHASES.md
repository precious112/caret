# Caret — Build Phases

Each phase delivers something usable and testable. Dependencies flow forward. Mark each phase as you complete and verify it.

**Status key:** `[ ]` = pending · `[~]` = in progress · `[x]` = complete

**Engineering detail and rationale live in [CARET-V2-PLAN.md](./CARET-V2-PLAN.md)** — start
with its §0.5, which reframes what Caret is for. [CARET-PLAN.md](./CARET-PLAN.md) and
[CARET-DECISIONS.md](./CARET-DECISIONS.md) are the V1 documents, kept as history; some of their
decisions are explicitly reversed below.

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

**Re-certify after any rendering-shell change:** `npm run verify:design-shell` — boots the generated shell on a fixture project and runs a browser suite (happy paths + adversarial corruption); all scenarios must PASS.

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

---

# V2 — the corrections have to stick

Reframed 2026-08-01, after establishing that precision editors amplify taste but do not supply
it, and that Caret's user is a frontend dev who is not good at design.

**Persona, pinned 2026-08-01:** a developer — comfortable with a repo, a terminal, and
connecting an agent — who is not good at design. Not a no-code end user. Onboarding may assume
a dev; the design surface must never assume design vocabulary.

**The problem every AI design tool has, in one sentence:**

> *"AI design is one-shot: the agent generates, you eyeball it, you fix the same problems by
> hand, and next session it makes them again."*

v0, Lovable, Bolt and Replit all regenerate from scratch each session, so every correction a
user makes evaporates. **`.caret/` does not.** It is a persistent design layer, in the repo,
under version control. That is the one thing Caret has that none of them do, and the whole
roadmap below is ordered around exploiting it.

**Four decisions, 2026-07-28 to 2026-08-03:**

1. **Caret stops requiring a particular agent** — *amended 2026-08-03.* The original form
   ("Caret stops owning the agent; MCP carries everything") is unimplementable for most of the
   product: MCP is client-initiated, and nearly every Caret feature starts with the user
   clicking something in Caret's window. The corrected split, by direction:
   - **Caret → agent** (sync, AI edit, overlay editor, interview, generate-and-pick): an
     **embedded coding backend** Caret drives through an agent SDK. Phase 6.4.
   - **Agent → Caret** (a user in their own terminal telling their agent to work on the design
     layer): the local **MCP server**, unchanged. This is MCP's whole scope — real, supported,
     and secondary.
2. **Caret becomes a standalone Electron app**, not an extension or a VSCodium fork. The Open
   VSX extension is retired at its last published version.
3. **The differentiator is persistence, not precision.** Direct manipulation is table stakes so
   the tool doesn't feel like a chat box; it is not the thing that makes output non-generic.
4. **The backend is an adapter, never a hard dependency on one vendor.** OpenCode's SDK is the
   reference implementation and ships bundled; Claude Code, Codex and Kimi attach behind the
   same seam using the user's existing subscription or key. Caret-hosted inference later is a
   provider config block, not an integration.

**What must be true for the output to stop looking generic** (documented consistently across
practitioner writing):

- Foundational rules are **always in context**, never fetched on demand. An agent asked to
  "build me a card" that has to *choose* to look up spacing and type will not, and will fill
  the gap from training data — confidently and wrongly.
- The design system is **machine-structured** (JSON) rather than prose. Benchmarks report
  roughly 80% fewer tokens and materially fewer hallucinations.
- Tokens are **live bindings**, not values copied at generation time — otherwise editing one
  changes nothing already made.
- Gaps between what is declared and what is built get **filled in confidently and incorrectly**,
  so drift is a correctness problem, not a tidiness one.

**Deferred pending the design-friction research** (user is running this hands-on): the supply
side — reference grounding, asset generation, typeface strategy. Replit answered it by building
in Mobbin's 600k real screens. Caret has no equivalent and should not guess at one. Phase 11
holds the seam.

---

## [~] Phase 6: Standalone + the inbound MCP surface

**Gate — settled 2026-08-01:**

- [x] License for new code: **Apache-2.0 throughout** (the repo already was; §11 requires an
      OSI licence without commercial dual-licensing for SignPath eligibility)
- [x] Thin auth stub — `desktop/main/services/`: a `CaretServices` interface whose only
      implementation refuses with a reason, so the local-forever commitment is written once
      rather than implied by absence
- [x] One clean service-client seam — same file; hosted features attach by registering an
      implementation
- [x] Public commitment: the direct-manipulation editor is local-forever, free-forever
      (stated in the README and in the refusal message itself)
- [x] MCP server security posture: per-project OS-assigned port + `.caret/.mcp.json`
      discovery file written 0600, bearer-token auth with constant-time comparison, and
      **any** `Origin` header refused (a browser has no business here, so there is no
      allowlist to get wrong). Verified by `verify:app` scenarios c and d.

**Desktop shell (Electron — Tauri's system webview renders WebKit on macOS and Chromium on
Windows, so the same design would look different per machine):**

- [x] App shell: windows, menus, native dialogs, preferences store (`desktop/main/prefs.ts` —
      atomic JSON in `userData`, same get/set shape as `StateManager`)
- [x] App chrome renderer — the window's own `webContents`; project picker, wizard, agent
      setup, notifications
- [x] Project open: pick folder, scaffold `.caret/`, recents, restore-last-session, and
      `caret <path>` from the terminal
- [x] De-vscode the design module — the 3 coupled files are gone: `DesignMode.ts` →
      `session.ts`, `preview-panel.ts` → `message-router.ts`, `SyncWatcher.ts` → chokidar.
      Host and agent access became **per project** (`services.ts`) rather than singletons,
      because two open projects would otherwise share one window's notifications.
- [x] Canvas as a `WebContentsView` on the Vite URL — **zero canvas porting**, as predicted.
      The generated canvas posts to `window.parent`, which is itself when top-level, so the
      canvas preload catches those on the same window and forwards them over IPC.
- [x] postMessage relay → IPC; proto/gRPC plumbing retired entirely
- [x] Replace VS Code diff/editor integration — the quiet-write path is moot with no editor to
      hijack; `openInEditor` reveals via `$EDITOR` or the OS
- [x] Vite lifecycle (now per-project, not a module singleton), chokidar watch, git from main
- [x] Pre-sync snapshot + "Undo sync" on plain git — `sync-snapshot.ts` writes a commit object
      with a throwaway index, so it touches neither the user's index nor their worktree, and
      restore is scoped to only the paths the sync actually changed
- [x] **`verify:design-shell` held throughout** — 16/16 before the refactor and 16/16 after
- [x] Ad-hoc codesign for Apple Silicon (`identity: null` in `electron-builder.yml`)
- [x] Unsigned builds: macOS `.zip`, Windows `.exe` + portable, Linux AppImage/`.deb`/`.rpm`

**Agent decoupling + MCP** *(scope corrected 2026-08-03: this section is the **agent-initiated**
path — an external agent driving the design layer from the user's terminal. Everything
**Caret-initiated** — sync, AI edit, overlay, interview — runs on the Phase 6.4 backend, and no
outbound feature may depend on an MCP client calling in):*

- [x] `AgentBridge` boundary replacing every `controller.initTask()` call site — the interface
      survives as the seam; its outbound implementation is Phase 6.4's backend, and the
      MCP-side task queue (`takePendingTasks`, the `agent:task` event) is deleted with it
- [x] Local MCP server over HTTP, auto-starting on project open
- [x] Tools v1: `get_project`, `get_page`, `get_tokens`, `get_flows`, `get_screenshot`,
      `get_sync_worklist`, `get_guide`, `create_page`, `write_page`, `update_tokens`,
      `write_flow`, `start_sync`, `complete_sync` (`get_params`/`set_param` land with Phase 8)
- [x] **Always-on foundational context via repo rules files.** `AGENTS.md`, `CLAUDE.md` and
      `.cursor/rules/caret-design-layer.mdc` generated from `foundation.json` + the authoring
      rules, regenerated on every token change, spliced into a marked block so the user's own
      content survives. Tool results echo the foundational JSON as a backstop.
- [x] **Structured (JSON) context for the machine; prose only where judgment is needed** —
      `rules/context.ts` splits the two
- [x] **Watch-and-heal write model** — chokidar on `.caret/` runs the caret-id codemod +
      validation on any change, whoever wrote it. Verified: an externally written page with no
      caret-ids and an inline style is healed with no MCP tool involved, and a second pass
      writes nothing.
- [x] **Edit-provenance event log** — `.caret/.provenance.jsonl`, actor + action + file,
      gitignored (local observation, and it would conflict on every branch)
- [x] Sync completion fallbacks — `complete_sync` with the syncId, `detectSyncAddressed`
      (coarse until Phase 9's manifest, and only ever used to *offer*), and a manual
      "mark synced" control
- [x] **The no-agent state** — every agent-requiring feature refuses with a per-feature
      explanation rather than failing silently
- [x] Client configs + docs: Claude Code, Cursor, Codex, OpenCode, Kimi, GLM. **Only the
      Claude Code path was exercised against a real client**; the rest follow each client's
      documented format and are marked untested in the docs rather than presented as equally
      certain. The dedicated real-client suite was retired 2026-08-03 when MCP stopped being
      the mechanism the product depends on — it cost real inference per run to certify a
      secondary path.
- [x] Deleted: `src/core/api`, `src/core/task`, `src/core/prompts`, `src/core/controller`,
      `webview-ui`, `cli`, `standalone`, `evals`, `walkthrough`, `proto`, `src/generated`,
      checkpoint manager, terminal, browser tool

**Ship-readiness:**

- [x] First-run onboarding: launcher window → pick folder → scaffold → wizard (gated on
      missing foundations) → connect an agent
- [x] Migration for existing `.caret/` projects (`migrate.ts` — gitignore lines, stale
      pending-sync records, regenerated shell)
- [x] Crash and error surfaces without the VS Code notification host
- [x] Install instructions using the macOS Sequoia flow, not the removed Control-click bypass
      (`docs/install.md`)
- [ ] Docs site + landing page (also the SignPath prerequisite) — the landing page lives in
      `precious112/caret-landing-page`
- [ ] Deprecation notice shipped **inside** the final Open VSX extension release — needs a
      publish against the retired extension, whose source this branch no longer contains

**Findings kept from the retired real-client suite** (it registered the server with the actual
`claude` CLI before being removed 2026-08-03): the documented `mcp add` command works verbatim;
a tool that **blocks 45 seconds on a human** still receives its answer; and a real client
**does deliver image content to the model** — an agent read a random word off a rendered page
with `get_screenshot` as its only permitted tool. That last one is what makes every
"look at it and judge it" interaction viable.

**App-level reliability floor:** `npm run verify:app` — launches the real Electron binary and
asserts on disk, over HTTP, and by driving the chrome UI: launch, MCP auth/origin refusal,
rules generation and user-block survival, watch-and-heal and idempotence, provenance, the
interview surfaces, screenshot capture, and the asset pipeline. A scenario only counts as
driving the app if a user could reach the same state by clicking — a harness that supplies the
counterpart (an MCP call, a queued task) certifies the half it wrote, nothing more.

**Deliverable:** Caret runs standalone; an external agent pointed at the MCP server reads and
writes the design layer safely, always with the project's foundations in context.

---

## [~] Phase 6.4: The coding backend — Caret owns the loop

**Added 2026-08-03.** Every Caret-initiated feature — sync, AI edit, the overlay editor, the
interview, Phase 7's generate-and-pick — needs Caret to hand work to an agent, and MCP cannot
carry that direction. So Caret embeds a coding backend behind an adapter seam and drives it
itself. This phase blocks 6.5's interview rewrite, 6.7's authored-SVG lane, and all of Phase 7.
Engineering detail in [CARET-V2-PLAN.md](./CARET-V2-PLAN.md) §4.4 — **read it in full before
implementing; the wire surfaces, event mappings and auth flows are specified there, not here.**

**The seam:**

- [x] `CodingBackend` interface in `src/core/design/agent/backend.ts`: `availability()`,
      `startSession()`, and `structured()` (one-shot, JSON-schema-constrained — carries the
      interview). Sessions expose `send()` streaming normalised `BackendEvent`s,
      `respondToPermission()`, `abort()`, `close()`.
- [x] `AgentBridge` call sites route through it; the dead MCP-outbound plumbing
      (`takePendingTasks`, the `agent:task` chrome event, the queue in `createBridge`) is
      **deleted**, not left beside the new path
- [x] `NoBackendError` refusals name the fix ("Open Settings → Backend…"), per feature, same
      posture as the existing no-agent messages

**OpenCode — the reference adapter, ships first:**

- [x] Binary **bundled with Caret, pinned**, spawned from the app bundle — never resolved from
      `PATH` (a user upgrading their own OpenCode must not change what Caret executes).
      `build/before-pack.cjs` stages the binary for the *target* platform and arch, which is
      not the build machine's; x64 always ships the `-baseline` build, because plain x64 needs
      AVX2 and a packaged app cannot know its future CPU.
- [x] **No `@opencode-ai/sdk` dependency — corrected 2026-08-03.** Caret talks to the pinned
      server over HTTP with shapes transcribed from its own live `/doc`. Two reasons, both
      found by running it: the published SDK at the *identical* version number disagrees with
      the binary it ships beside (the server emits `permission.asked`/`permission.replied`
      where the SDK declares `permission.updated`, and the SDK's prompt body has no `format`
      field though the route accepts one), and the SDK's server launcher spawns `opencode`
      from `PATH`, which this phase forbids. One source of truth — the server that is
      running — beats two that drift.
- [x] Server secured like Caret's own MCP endpoint: loopback, OS-assigned port, random
      per-launch password. HTTP Basic with the username `opencode`; Bearer is refused.
- [x] Config passed **inline** to the embedded instance. Caret never writes
      `~/.config/opencode/*`; it *reads* the user's existing credentials so a signed-in
      OpenCode account is picked up without a second login.
- [x] One session per activity (a sync, a brainstorm, an edit) — never one long thread
- [x] Event types and response shapes pinned from the live OpenAPI before the sidebar was
      built. Also pinned there: structured output is delivered as a **forced `StructuredOutput`
      tool call whose input is the object** — there is no text part carrying JSON, so parsing
      the reply finds nothing.
- [x] `structured()` is native where the model supports it and **falls back to prompt-and-parse,
      flagged `emulated`**. Native json_schema is a *model* capability, not a server one: a
      reasoning model cannot be given a forced tool choice, and some providers' speculative
      decoding has no grammar support. Both were observed on the bundled backend's own models.
- [x] **Caret's permission handler is the enforcement boundary.** Backend agent/permission
      config (Plan agent, glob rules) is the first line only — upstream has open issues where
      subagents inherit none of the parent's `edit: deny`. Caret answers every permission
      request itself: `.caret/**` writes auto-approved (fixed, not configurable), app-path
      writes denied outright in a read-only session, and prompted per the user's toggle
      (default: ask, with "don't ask again for this project") in a write session. The rules are
      a pure function with its own unit tests, because a write that should not have happened
      cannot be re-run.

**Chat surface:**

- [x] Collapsible chat sidebar: streamed text, collapsed thinking, tool-call lines, file-change
      list, permission prompts, stop (= abort). Dismissible at will. Treatment settled 2026-08-05
      against three alternatives built and compared at real width — see §4.4's three rules:
      the composer holds its own controls, colour is reserved for what is waiting on an answer,
      and turns group.
- [x] Chat history: sessions listed per project, and an old session **replayed through the same
      reducer that built it live** — a history panel with its own parser is a second
      implementation that eventually disagrees with the first.
- [x] The sidebar lists the **files a session changed**. A diff *viewer* is deferred to the
      Phase 8 undo work; the pre-task git snapshot remains the canonical recovery mechanism
      (it is what "Undo sync" restores from), and the backend's diff endpoint stays enrichment,
      never the source of truth.
- [x] Works in design mode for brainstorming sessions, not only for sync

**Setup and auth (each backend gets both paths — account login first, API key fallback):**

- [x] Detection ladder: bundled OpenCode always present → detect installed CLIs (`claude`,
      `codex`, `kimi`) and their auth state → offer that backend's own login → paste-a-key
      last. A detected, signed-in CLI shows as "found — use it", one click.
- [x] Claude auth state is read from `claude auth status`, which prints JSON and **costs no
      inference** — the only honest way to answer "is this signed in" without spending the
      user's credits to find out. Billing disclosure at the point of choice: account auth
      draws the separate Agent SDK credit pool, not normal Claude Code limits.
- [x] The setup screen names routes, never prices or quotas (they drift)
- [x] A backend whose CLI is missing shows an honest "install this first" state with the
      command — never a dead or half-working option. Commands are **shown to run, not run for
      you**: these flows want a real terminal, and one spawned from a GUI with nowhere to type
      is a dead end. "Check again" re-probes.
- [x] Provider ladder through OpenCode: BYOK (any provider) · OpenCode Go (subscription) ·
      OpenCode Zen (credits). Caret-hosted inference later is an OpenAI-compatible `baseURL`
      provider block — config, not integration (§11 boundary).

**Secondary adapters — written to spec, flagged `(untested)` until subscriptions exist:**

- [x] Claude Agent SDK adapter (`@anthropic-ai/claude-agent-sdk`). Its `canUseTool` hook is
      Caret's boundary, so the rules hold there as they do on OpenCode.
- [x] Codex adapter (`@openai/codex-sdk`) *(untested)* — **no interactive permission callback
      exists.** Its safety model is a sandbox mode plus an approval policy chosen up front, so
      Caret enforces by sandbox (`read-only` for plans, `workspace-write` otherwise, approvals
      `never`) rather than by answering requests. Consequence, stated in the UI: the per-write
      "ask" toggle does nothing on this backend.
- [x] Kimi adapter (`@moonshot-ai/kimi-agent-sdk`) *(untested)* — no native structured output;
      the emulation's post-validation is load-bearing there
- [x] GLM: **no adapter.** Z.ai ships no embeddable agent SDK (ZCode is an app); GLM
      subscribers connect through the OpenCode adapter's provider config, which Z.ai supports
      day-one. Revisit only if a ZCode SDK appears.

**Sync, restored to the V1 contract on the backend (spec: §4.4 + `caret/main` history):**

- [x] Preflight and one-click git fixes carry over unchanged
- [x] Plan phase: read-only session, worklist prompt (no file contents); the plan streams into
      the sidebar for review
- [x] Apply: same session switches to write mode; app-path permissions per the user's toggle
- [x] **Caret advances the bookmark in its own code on apply** — never by instructing the
      model to write `sync-state.json` — and **only when the apply actually changed a file**.
      A turn that ends cleanly having written nothing is common (an agent that explores until
      its budget runs out), and advancing there drops the design change silently instead of
      re-offering it next sync
- [x] Pre-sync snapshot and "Undo sync" unchanged

**Policy:**

- [x] Direct edits to `.caret/` are an **anti-pattern, tolerated and healed, never
      recommended**: watch-and-heal stays exactly as is, and the first genuinely direct write
      in a session raises a once-per-session notice pointing at the visual editor.
      `connect-an-agent.md` stops describing direct writes as a supported path. Writes made by
      Caret's own backend mid-turn are recorded as `agent`, not `external` — from the watcher's
      side they look identical to someone editing the file by hand, and Phase 7 mines that
      distinction to tell taste from machine output.

**Certification — cold launch, click-only, no harness-supplied counterparts.** The scenarios
that spend inference are pointed at a model deliberately (`CARET_VERIFY_MODEL`), fall back to a
zero-cost model when the backend offers one, and **skip rather than fail** when neither exists —
a Caret with no credentials is a supported state, and a red suite would call that broken. A run
with skips never reports as certified:

- [x] From a fresh profile with the bundled backend: type an instruction in the chat → the
      design source changes to exactly that, and the transcript records that Caret answered the
      write permission itself and why
- [x] Click Sync → a plan streams in → **the app is byte-for-byte unchanged while the plan is
      waiting for approval** → apply → the app follows the design and the bookmark advances
- [x] With no backend configured: the chat refuses with its named fix, and so does sync
- [x] `npm run verify:backend` certifies the adapter on its own — availability, schema-bound
      answers, a write that lands, and a **denied** write that does not

**Deliverable:** clicking things in Caret causes an agent to do them. The user connects a
subscription or key once, or uses the bundled default, and never opens a terminal.

---

## [~] Phase 6.5: The foundation interview (token wizard v2)

**Re-scoped 2026-08-06 — the model runs the interview.** The 2026-08-03 shape (Caret-owned
fixed steps, model confined to ranking a curated enum) was built, certified, and rejected at
review: fixed questions cannot tailor themselves to what the user is building, and the point
of the interview is that every question and option is informed by the description. The
inversion: **the AI decides what to ask; Caret decides what a question is allowed to look
like.** The curated library is demoted to reference material in the prompt.

**The widget vocabulary is the contract.** Every question the model composes must be one of a
fixed set of kinds, each with a purpose-built surface: `options` (specimen cards), `color`
(swatches + **colour picker, hex field, eyedropper** as the built-in escape hatch), `font`
(type specimens + Google Fonts search), `scale` (two poles, stepped, the specimen morphs
live), `chips`, `text`, `boolean`, `assumptions` (inferences confirmed in one screen instead
of asked one by one). Freedom over content, none over presentation.

- [x] Conductor: one `structured()` call per turn → `ask` (a widget payload) or `finish`
      (parameters). Malformed turns are retried **once, quoting the validator's complaint**;
      then an honest error screen with retry / finish-now / presets.
- [x] Question budget: aim 4–7, hard cap 10; "Just finish it" available to the user from the
      second question on; skip ("you decide") on every question.
- [x] Recommended option preselected on every question; reasons grounded in the user's own
      description, rendered under the cards.
- [x] Finish is **parameters, never a file**: families, brand hex, neutral, surface, ratio,
      base size, spacing unit, radius character, restraint rule. `finalizeProposal` validates,
      clamps, and derives every scale with `generateTokenScale` — the committed
      `foundation.json` has exactly the token editor's shape. `TypographyTokens` gained
      optional `displayFamily`/`displayFallback` for the heading face.
- [x] Scratch (`.caret/.interview.json`, gitignored, healer-ignored): description, transcript,
      the question currently on screen, a finished proposal — resume is free, no model call.
      Cleared on commit.
- [x] No backend → the wizard says so and offers the other doors; it does not fake an
      interview it cannot run.
- [x] Three tabs on the Foundation surface: **Interview** (the wizard, default) ·
      **Presets** (the 2026-08-03 deterministic flow, kept for full-control users) ·
      **By hand** (token editor). The MCP interview tools stay as the external-agent path.
- [ ] Re-runnable with blast radius shown — needs Phase 7's live bindings; re-running today
      overwrites, so the surface warns before the first commit rather than after.

**Gate (working-agreement exception 2):** the user runs the wizard on a real project and rates
the output before this phase closes.

**Deliverable:** a developer with no design vocabulary describes what they're building, answers
a handful of questions composed *for that description*, and lands on foundations worth
protecting — with an escape hatch on every question that is a real control, never a prompt box.

---

## [~] Phase 6.6: Assets — supply, tagging, and `@` references

**Added 2026-08-02.** The design layer has type, colour, spacing, and (7.5) components. It has
nothing for the actual *content*: the photograph in the hero, the logo, the product shot, the
icon set, the background video. So an agent asked to build a landing page emits a grey
placeholder `<div>` or a stock URL, and the user's own files have no way in at all.

That is a supply gap of the same kind as typefaces, and it belongs **before** Phase 7: "make
corrections stick" means little while the thing the user keeps correcting is *"you used a grey
box again."* Engineering detail in [CARET-V2-PLAN.md](./CARET-V2-PLAN.md) §4.6.

- [x] `.caret/assets/` + `index.json` manifest — under git like the rest of the design layer.
      Per entry: tag, file, kind, mime, intrinsic dimensions, bytes, content hash, alt text,
      a one-line **character description**, and `origin` provenance.
- [x] **The description is the load-bearing field.** Dimensions do not tell an agent that a
      photograph is dark, wide, and has empty space top-left — which is what decides whether
      it can carry overlaid text. Written by the user, or proposed by the agent from the
      pixels. Descriptions survive a byte change to the file — they describe the slot.
- [x] Asset library surface in the chrome: drag-and-drop, native picker, tag rename with
      validation, description/alt editing, delete. **Certified by driving the UI from a cold
      launch** — thumbnail decodes from the design server, a description typed in the row
      reaches `index.json` and the rules files, a refused rename restores the field, a real
      drop lands and Remove takes the file with it. A drop carries **bytes as well as a path**:
      Electron removed `File.path` in v32, so the path-only handler silently did nothing for
      every drop, and an image dragged out of a browser or a mail client never had a path to
      give in the first place.
- [x] **The index is always-on context** — tag · kind · dimensions · description, one line
      each, in the generated rules block; the Phase 6.4 backend gets the same lines injected
      into its system prompt directly. Pixels stay pull-only.
- [x] Vite serves `.caret/assets` at `/caret-assets/<file>` — path-confined after URL
      decoding; encoded traversal refused
- [x] `@tag` expands to the **resolved entry inline** (path, dimensions, description) before
      any instruction reaches an agent, in the shared prompt builder so every edit surface
      gets it. Unknown tags are kept verbatim and flagged — never silently dropped.
- [x] `@` picker in the AI-edit box and overlay editor: thumbnail autocomplete over the index,
      served fresh from `/__caret/assets-index`. One attach-to-an-input implementation for both
      surfaces, because the AI-edit box is react-grab's and lives in a shadow root — it cannot
      be a component, and a second implementation would drift on what a tag is. Enter chooses
      the asset without also sending the instruction (both handlers sit on the same element).
- [x] Fit is the agent's judgment, not a crop tool's: `fitWarning` (upscale >1.5×, aspect gap
      >2×) joins the expanded reference — the selection payload now carries the target's
      rendered box, and an overlay edit uses the painted region as its box. The prompt states
      the measured size and tells the agent it may **refuse**, which matters more (a 400×400
      asset in a 2400px hero should get a reason, not an upscale)
- [x] MCP: `list_assets`, `get_asset` (returns pixels + metadata, tolerates a leading `@`,
      refusals name the tags that do exist), `describe_asset`
- [x] Watch-and-heal indexes assets written directly into `.caret/assets/` by any author —
      dimensions probed from file headers, hash computed, tag derived from filename, rules
      regenerated. Same tolerated-and-healed posture as pages.
- [x] Sync prompt tables every referenced asset and instructs the copy into the app's own
      public directory with the path rewritten — never a hotlink to `/caret-assets/`
- [ ] Sync records each asset copy in the mapping so Phase 9 can detect drift (lands with the
      Phase 9 manifest)
- [~] Kinds: raster, SVG, video and 3D (`glb`/`gltf`) are all assets on the same terms —
      stored, tagged, served, `@`-referenceable, synced. What differs is only the library
      thumbnail. **Video shows a real frame** and that frame is kept, so `get_asset` hands an
      agent a look at a video rather than a sentence about one — the browser decoded it to
      display the row, so extracting it costs nothing and needs no ffmpeg on the user's
      machine. A poster is a **derived file** (`.caret/assets/.posters/`, gitignored,
      healer-ignored, dropped when the video's bytes change), not an asset with its own tag:
      a poster is a view of a decision, not a second decision. **3D stills are deferred** —
      they need a WebGL renderer in the chrome, and ~1MB of dependency for a 112×80 thumbnail
      is not a trade worth making before anything else needs one.
- [x] **Agent vision, certified.** `get_screenshot` captures a fresh isolated render (settled:
      fonts ready, images decoded), refuses unknown pages by naming the ones that exist, and
      pairs the image with a text sibling so a client that drops image content degrades
      honestly. Certified against a real client: an agent read a random word present in the
      fixture only as character codes, with `get_screenshot` its only permitted tool.

**Deliverable:** the user's own assets are first-class citizens of the design layer, and
`@hero-shot` means the same thing to a person, the visual editor, and any connected agent.

---

## [ ] Phase 6.7: Generated assets — guided generation, never a prompt box

**Added 2026-08-02.** The other half of asset supply: the user has no photograph, no icon set,
no texture, and stock imagery is its own kind of generic. Engineering detail in
[CARET-V2-PLAN.md](./CARET-V2-PLAN.md) §4.7.

**The rule, and it is Phase 6.5's rule unchanged:** the user is never handed a prompt box. They
answer questions about what they want; **Caret** composes the prompt from a curated recipe
library; the model returns N variants; the user points at one. A prompt box hands the taste
problem straight back to the person who does not have it, and "cinematic, 8k, hyperdetailed" is
precisely what makes generated imagery legible as generated.

- [ ] Curated **asset recipe library** (`src/core/design/asset-library/`), same shape as the
      foundation library: id, name, "use when", kind, tags from the shared vocabulary,
      composed-for aspect ratios, a prompt **template**, and an explicit `avoid` list of the
      documented slop tells
- [ ] **Recipes read `foundation.json`.** A project on `deep-technical` gets a dark, cool,
      low-key image; one on `warm-earth` gets warm neutrals and no pure white. A generated
      asset that fights the palette is worse than no asset — and this is the first place the
      foundation *produces* something rather than merely describing it.
- [ ] Reuse the 6.5 interview surface — the same Caret-owned step machine and pick screens;
      here the specimens are pictures, and the recipe narrowing runs through the backend's
      `structured()` with recipe ids in the enum, exactly like foundation candidates

**Four lanes, by what the asset actually is. Only one of them costs money.**

- [ ] **Raster → Google Gemini image ("Nano Banana").** One adapter over the `@google/genai`
      SDK, two backends: **API key** is the shipped path; **Vertex AI with `gcloud` ADC** is a
      test-only switch configured through env/prefs and absent from the UI. The SDK takes
      Caret's proxy-aware `fetch`, and the adapter normalises the model ids that differ between
      backends.
- [ ] **Decorative vector → code, not a model.** Seeded parametric generators for grainy and
      mesh gradients, grain and noise overlays, halftone and dither, geometric patterns,
      organic shapes, section dividers and wordmark treatments. Free, instant, deterministic,
      and **tunable after the fact** — a parameter set is diffable and correctable where a
      4KB path string is neither. Variants cost an integer, so generate-and-pick is free here.
- [ ] **Icons → curated open sets, installed.** Lucide, Phosphor, Radix, Heroicons. Generation
      is the wrong tool for icons: a set's value is internal consistency, and one-shot
      generation destroys it across stroke weight and corner treatment. Uses the 7.5 install
      path, so icons land as editable source and recolour to foundation tokens.
- [ ] **Logos and marks → backend-authored SVG in a render-compare loop.** A Phase 6.4 session
      emits SVG; Caret renders it in isolation, screenshots it, and feeds the image back into
      the session beside the reference; the model corrects and re-emits. Caret drives the loop
      and decides when to stop — the loop is the product, not the first emission, because blind
      path emission is the case where "models are bad at SVG" is actually true. Optionally
      seeded by a deterministic raster trace, which gives structure to clean up instead of
      blank coordinates.
- [ ] **Transparency comes from the model, not a matting step.** Gemini returns transparent PNG
      for icon-style prompts; code generators and authored SVG have no background to remove.
      Where a genuine photographic cutout is needed, chroma-key against a flat background Caret
      chose at generation time — deterministic, no model, no licence.
- [ ] **BYO API key, OS keychain, never in `.caret/`.** This is the monetization boundary
      already written down (§11): the local editor is free forever; hosted inference is the
      paid side. Three of the four lanes need no key at all, so the phase is usable before any
      account exists. A hosted "just make it" button is a Phase 12 revenue item, not a
      dependency of this phase.
- [ ] Post-process: resize to the composed-for ratios, emit `webp`/`avif` alongside, strip
      EXIF, write through the 6.6 pipeline so a generated asset is an asset like any other
- [ ] Provenance is complete and honest: model, recipe id, the answers given, the resolved
      prompt, and cost — recorded in `index.json`, labelled in the UI, SynthID left intact

**Deliverable:** a developer who cannot take a photograph or draw an icon still ships a landing
page whose imagery matches its own foundations — without ever writing a prompt, and without
needing an API key for anything but photographs.

---

## [ ] Phase 7: Make corrections stick

**The differentiator.** Everything here exists to stop the user fixing the same thing twice.
Nothing in this phase is possible for a tool that regenerates from scratch each session.

**Design session required before implementation** — these bullets are direction, not spec
(CARET-V2-PLAN §1 marks this phase "designed together"). Do not build from the checklist alone.

- [ ] **Tokens become live bindings.** Generate Tailwind `@theme` from `foundation.json`, so
      pages reference `bg-brand-500` rather than a copied hex. Today `design_layer.ts:110`
      instructs the agent to inline the value, which means editing a token changes nothing
      already generated. Includes typography; font *loading* moves out of per-component
      `@import` into the generated entry CSS. Open for the design session: what sync writes
      when the app has its own design system — map `brand-*` onto the app's tokens where an
      equivalent exists, else emit the generated `@theme` into the app's entry CSS; never ship
      a class that resolves to nothing.
- [ ] **Corrections get captured.** When the user overrides the same thing repeatedly by hand,
      offer to promote it — into a token, or into the always-on rules. This is the direct fix
      for "next session it makes them again", and it is the single highest-value item in the
      plan. Mines the Phase 6 edit-provenance log; promotions land in the generated rules
      files, so they reach every future agent session.
- [ ] **Rules are versioned with the design.** They live in `.caret/`, under git, reviewable in
      a PR, and travel with the project.
- [ ] **Generate-and-pick.** For anything that cannot be said precisely in words, N variants
      render and the user points at one. Pointing needs no design vocabulary, which is exactly
      right for a non-designer. Replit ships this as "Ambient Intelligence"; treat it as table
      stakes rather than a novelty. Plumbing: somewhere for variants to render (variant pages
      or page states) and a compare-and-pick canvas surface. **Primary path: Caret orchestrates
      it directly on the 6.4 backend** — N sessions or N turns, one per variant, no cooperation
      required. A `propose_variants` MCP tool + rules-file instruction remains for external
      agents, which Caret can only make it easy and expected for, not force.
- [ ] **A deterministic acceptance checker Caret runs** — not an agent honor-system self-check
      (an agent that must *choose* to self-check will not; same failure mode as pull-only
      `get_guide`). Most slop tells are computable on the rendered page: contrast (axe-core),
      identical card rows (DOM structure comparison), a border on everything (count), missing
      focus/empty/error states (page-states metadata). **Caret runs it after every backend
      session that wrote pages and feeds failures back into the session** — the owned loop
      means the checker is enforced, not requested. It is also exposed as a `run_design_checks`
      MCP tool the rules files tell external agents to call before finishing, and surfaced on
      the canvas regardless of whether anything called it. The slop-tell list is versioned in `.caret/` and
      extensible by captured corrections. **Gains asset checks once 6.6 lands:** a placeholder
      element where an asset was asked for, a missing `alt`, and an image whose intrinsic size
      is wildly mismatched to its rendered box — all computable, all common.

**Deliverable:** a correction made once is a correction the agent respects from then on.

---

## [ ] Phase 7.5: Component supply — the curated catalog

**The supply gap, answered for components.** Reference screenshots (Replit's Mobbin answer) make
an agent *reproduce* what it saw. A component library makes the quality **transfer as code**, in
the medium `.caret/` is already written in — no translation loss. For a code-based tool that is
the strictly better answer, and unlike the rest of Phase 11 it does not wait on the friction
research: the candidates already exist and the user is already collecting them. Engineering
detail in [CARET-V2-PLAN.md](./CARET-V2-PLAN.md) §5.5.

**Research + curation gate — do this first, then stop and wait:**

- [ ] Survey candidate libraries: micro-interactions and transitions, loaders, effects
      (ASCII, halftone, grain, displacement), hero/section compositions, animated primitives
- [ ] For each, verify programmatic access **by running it**, not by reading the marketing page:
      does the CLI/registry install work headlessly, is there a public repo, what is the licence
- [ ] Produce the review table — name · what it's for · distribution shape · install command ·
      licence · repo · registry endpoint reachable · editable once installed · **rendered
      specimen** (taste is being judged, not just mechanics)
- [ ] **User reviews the full list and picks what ships.** Nothing enters the catalog without
      that pass — curation is the entire value; an unreviewed catalog is just more averaging.

**Two tiers (settled 2026-08-01):**

- [ ] **Shipped catalog** — curated, user-reviewed, versioned with Caret. This is the allowlist:
      pinned versions, licence per entry, one-line "use when" per component.
- [ ] **Per-project `.caret/`** — what the agent actually installed for *this* project, with
      provenance (library, version, component, source URL, licence). Under git, so the choice
      persists across sessions like every other correction.

**Integration rules:**

- [ ] **Use the install path, never the read path.** The agent never fetches a docs site at
      generation time — bot walls, JS-rendered docs and moved URLs are dependencies Caret does
      not control. It installs, then reads the resulting source locally, forever.
- [ ] **Two-axis filter**: *ingestible* (installs programmatically, public repo, readable
      licence) **and** *editable once installed* (source lands in `.caret/`, takes caret-ids,
      colours rebindable to `foundation.json`). Both required; they fail independently.
- [ ] On install: rebind hardcoded colours/type to foundation tokens where they match, and let
      the Phase 6 watch-and-heal codemod stamp caret-ids (it fires on any `.caret/` write, so
      installed components become visually editable with no extra machinery)
- [ ] **Opaque npm packages degrade honestly** — wrap in a `.caret/components/` wrapper that
      owns props and tokens, mark the interior `writable: false` with a reason. Never a silent
      dead zone in the canvas.
- [ ] Catalog **index** (names + "use when") goes in the always-on rules files; full prop APIs
      are read on demand from installed source. An agent that must *choose* to check the
      catalog will hand-roll a spinner instead — same failure mode as pull-only `get_guide`.
- [ ] **Restraint budget: roughly one signature move per page**, enforced in the rules and
      checked by the Phase 7 acceptance checker. A micro-interaction library is a slop
      *accelerant* without this — "a bounce animation on every hover" is on the documented
      slop-tell list, and the reference designs won on restraint everywhere but one move.
- [ ] Supply-chain posture: allowlist only, pinned versions, explicit user consent on a
      library's first install into a project

**Deliverable:** the agent reaches for a genuinely good loader, effect or section instead of
hand-rolling a generic one — from a set the user personally approved, installed as editable
source that the token system and the canvas both understand.

---

## [ ] Phase 8: The shared human/agent surface (parameter model)

The vocabulary that lets a hand and an agent express the same change with the same precision.
A human drags a handle and sets `overshoot: 56%`; an agent writes `overshoot: 56%`.

**Design session required before implementation** (CARET-V2-PLAN §1: designed together before
code).

- [ ] Selection payload v2: caret-id, resolved path, computed styles, box geometry
- [ ] `Param` descriptor + registry; **index `caret-id → node` once per parse**, keyed to the
      file's content hash (measured: 115ms → 3.1ms for a panel-sized batch, and a stale index
      splices silently into wrong offsets)
- [ ] Splice write primitive replacing recast for span replacements
- [ ] Build-time caret-id codemod: promote `page-precompute.ts`, append-only, parse-only + splice
      — **the watch-and-heal half lands early, in Phase 6**; this phase extends it to the full
      Param substrate
- [ ] Generalize `InlineEditPayload` from `"text"|"color"|"image"` to `{path, value}`
- [ ] Property panel: every CSS property, token-aware, override vs token visible
- [ ] Resolution chain: literal → binding-follow → literal-array-index → typed refusal
- [ ] Lint rule + autofix for `dynamic-tailwind-class`; editor absorbs fragmented text,
      `dynamic-text`, `dynamic-image-src`, inline styles
- [ ] Instance discriminator so `.map()` rows are editable (look edits reach all rows, content
      edits reach one)
- [ ] Multi-select + bulk edit; **unified undo across inline and agent edits** (git-based —
      the checkpoint shadow-git is gone with the task loop)
- [ ] **Every parameter needs a name an agent can write as precisely as a hand can drag.**
      `bouncy` above the bezier, `aurora / warm / grainy` above four stacked radials. If a
      parameter has no such name, it is defined at the wrong altitude.

**Deliverable:** the authoring contract shrinks from twelve rules to roughly one, and
`/debug-ui-page` becomes a rare judgment call rather than routine maintenance.

---

## [ ] Phase 9: Stop the design layer lying (reverse sync)

- [ ] Design↔app mapping manifest, **recorded at translation time, never inferred**
- [ ] Bidirectional drift detection from content hashes
- [ ] App→design sync path, producing a reviewable proposal and never a silent write
- [ ] Incremental sync driven by the manifest instead of full re-reconciliation
- [ ] Conflict presentation — surface, never auto-merge
- [ ] Framework-agnostic checkpoint: verified against Vue and Svelte, not only React

**Deliverable:** prerequisite for both collaboration and CI drift diffs, and the fix for
declared-vs-built gaps being filled in confidently and wrongly.

---

## [ ] Phase 10: Direct manipulation that earns its place

Deliberately minimal. This is what stops Caret feeling like a chat box with a preview — not
what makes the output good.

**Designed together before build** — resize is specified (CARET-V2-PLAN §5) but flagged for
joint design; walk the feel checkpoints (video clips) with the user rather than building and
merging solo.

- [ ] Resize: layout-context resolver walking a **chain** (classification is one level,
      attribution is not), axis-aware (`width:auto` fills, `height:auto` hugs), preview channel
      chosen from context, **neighbourhood verification**, settle protocol + epsilon
- [ ] Explicit hug / fill / fixed modes rather than inferring intent from a drag
- [ ] Encoding policy inferred from the repo's existing conventions
- [ ] Layers panel mirroring the JSX tree
- [ ] Canvas perf: virtualized iframes, 60fps at 200+ artboards
- [ ] Keyboard map

**Explicitly deferred** — snapping and smart guides, gradient stop editing, motion timelines
and easing editors, 3D and shader parameter exposure. All are precision tools for people who
already know what they want. Revisit only once the supply side (Phase 11) exists, because a
beautiful gradient editor does not help someone who cannot choose a gradient.

---

## [ ] Phase 11: Supply — the ingredients

**Gated on the design-friction research.** The question this phase answers: where does a
non-designer get a typeface, an asset and a composition that are not generic? Do not guess at
the shape before that research lands.

**Mostly answered already:** foundations are Phase 6.5 (the interview), the *component* half is
Phase 7.5 (the curated catalog), and as of 2026-08-02 the *asset* half is Phases 6.6 and 6.7
(the asset library and guided generation). What remains gated is below.

Known sub-problems:

- **Grounding** — reference designs the agent can consult. Replit bought this (Mobbin, 600k
  screens, built in). Options: a curated open library, an MCP integration, or nothing. **This
  is now the largest genuinely unanswered piece**, and the one the friction research is for.
- **Generation** — grainy gradients, halftone treatments, split wordmarks. All are code, so
  Caret can own them outright and expose them as tunable parameters. **Largely superseded by
  Phase 7.5** (integrating existing libraries is far cheaper, and their prop APIs already
  expose the parameters) **and by Phase 6.7** for anything raster or vector. What stays here
  is whatever neither the catalog nor a generation recipe can cover.
- **Typeface** — the highest-leverage single decision in every reference design reviewed, and
  the one a dev reliably gets wrong by defaulting to Inter. Licensing is the hard part.
- **Composition recipes** — the reference footers shared one layout and differed only in skin.

---

## [ ] Phase 12: Share, then collaboration

- [ ] **Share** — one-click hosted URL for a canvas or page. First hosted feature, first
      revenue, and the first increment of the team product (same infrastructure).
- [ ] Git branching abstraction for non-devs ("design draft for X") — the surviving idea from
      the original Phase 6, and the actual paid team product
- [ ] Permissions, review surface, stale design-branch notifications
- [ ] CI visual diffs: *"did the app drift from the design"*, compared on resolved `Param`
      values, never pixels

**Deliverable:** desktop authors, web viewers. Engineers and designers work locally against the
real repo; PMs and clients open a URL and install nothing.

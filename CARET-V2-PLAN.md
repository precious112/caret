# Caret V2 — Engineering Plan

Companion to [CARET-PHASES.md](./CARET-PHASES.md). That file tracks *what* and *when*; this
one is *how* and *why*. Decisions live here so they don't have to be re-derived.

**Status:** A and B are specified and ready to build. D has its reliability argument below.
C, E and Widgets are deliberately stubs — those get designed in conversation before code.

---

## 0. The pivot

Two decisions, 2026-07-28:

1. **Caret stops owning the agent.** No bundled task loop. A local MCP server exposes the
   design layer and any agent drives it.
2. **Caret becomes a standalone Electron app.** Not an extension, not a VSCodium fork.

### Why (landscape)

The market split three ways and only the extremes make money. **Own no agent, be
infrastructure:** Paper ($34M Series A 2026-07-23; 23-tool bidirectional local MCP server),
Anima (repositioned from Figma plugin to an API embedded in Bolt.new and Replit). **Own the
agent totally:** Lovable (~$6.6B), Builder Fusion. **The unprofitable middle** is bundling a
mediocre agent nobody chose you for: Onlook (26k stars, hosted still waitlist), Subframe,
Tempo ($7.5M since 2023, now selling a services tier). Swapping Cline for OpenCode SDK would
have kept Caret in the middle.

**The open lane is framework-agnostic + real local codebase + BYO agent.** Paper is
framework-agnostic but touches no real code. Onlook, Subframe and Tempo touch code but are
React/Tailwind-locked. Nobody holds both.

### Why `.caret/` makes BYO-agent possible

The design-layer separation splits Caret in two. The **canvas half needs no LLM at all** —
it's visual editing of a React app whose shape Caret controls. The **sync half is a
well-scoped agent job**: read these files, read those, reconcile. If Caret edited app source
directly (Onlook's model) the agent would have to be fused in.

### Why desktop is not Onlook's mistake

Onlook migrated Electron→web citing install size, users needing a local dev environment, and
support cost debugging user machines. They paid by replacing filesystem access with a
CodeSandbox container, giving up the exact moat. Caret's move is *IDE-fork → purpose-built
desktop*, which sheds the fork tax while keeping local filesystem access. Every friction
Onlook cited applies harder to a VSCodium fork than to a focused app.

---

## 1. Working agreement

| Track | Ownership |
|---|---|
| **A** Desktop shell | Claude end-to-end. Surface decisions only. |
| **B** Agent decoupling + MCP | Claude end-to-end. Surface decisions only. |
| **C** Parameter model | **Designed together before code.** Detailed proposal → discussion → build. |
| **D** Reverse sync | Claude end-to-end, but the design is written up and justified first. |
| **E** Precision | **Designed together.** Visualized where hard. |
| **Widgets** | **Designed together.** Visualized where hard. |
| **F** Ship-readiness | Claude end-to-end. |

**Testing.** Claude tests every phase via `playwright._electron` (verified available in the
installed 1.58.1). Automated coverage is functional and filesystem-level; the decisive
assertion for Caret is almost always *"did the source file change to exactly this, and did
nothing else move"*. Claude cannot test feel, taste, Windows/Linux behaviour, macOS Sequoia
Gatekeeper, or real agent judgment.

**Halt-and-notify.** When something needs a human look or a manual test, Claude stops and
says so rather than guessing past it.

**Feel checkpoints.** Playwright records video. At feel-critical moments (drag-resize,
snapping, timeline scrubbing, gradient stop dragging) Claude produces a short clip for
judgment rather than deferring all UX feedback to the end. Resize is the single riskiest
interaction on the list; discovering it feels wrong after Phase 9 is built is expensive.

**Final acceptance** is the user attempting to reproduce high-end designs and judging whether
the tool makes that easy.

**Branch:** work happens on `caret/learning`, merged to `caret/main` when green. Strip
aggressively; `caret/main` remains the reference for how anything originally worked.

---

## 2. Architecture

```
┌─────────────────────────── Electron main ───────────────────────────┐
│  window/menus  ·  prefs store  ·  project open  ·  git              │
│  Vite lifecycle  ·  chokidar watch  ·  file-mutation-queue          │
│  ┌───────────────────────────┐   ┌──────────────────────────────┐   │
│  │ design core (host-free)   │   │ MCP server  127.0.0.1:PORT   │   │
│  │ src/core/design/* (30/33) │◄──┤ tools + get_guide            │   │
│  └───────────────────────────┘   └──────────────▲───────────────┘   │
└─────────────────────────────────┬───────────────┼───────────────────┘
                          IPC     │               │  HTTP
┌─────────────────────────────────▼──────────┐    │
│ Electron renderer                          │  Claude Code · Codex
│   loads http://localhost:<vite>/  directly │  OpenCode · Kimi · GLM
│   = generated canvas in .caret/lib/canvas/ │
│      └── iframes .caret/pages/*/index.tsx  │
└────────────────────────────────────────────┘
```

### The finding that sizes Track A

**Only 3 of 33 files in `src/core/design` import `vscode`:** `preview-panel.ts`,
`DesignMode.ts`, `SyncWatcher.ts`. Zero of the nine `src/core/controller/design/*` handlers
do. The design core is already host-agnostic.

And `preview-panel.ts:399-419` shows the VS Code webview is a ~20-line shell:
`<iframe src="http://localhost:${port}/">` plus a bidirectional postMessage relay. The canvas
app itself is **generated code** written into `.caret/lib/canvas/` by
`rendering-shell/canvas-template.ts` and served by Vite.

Consequences:

- Electron's `BrowserWindow` loads the Vite URL **directly**. No iframe shell.
- `CanvasApp`, `CanvasView`, `PageThumbnail`, `FocusedPageView`, `OverlayPainter`,
  `CaretStateContext`, `CaretNavigator`, `SimulationView` need **zero porting**.
- **Flows and simulation come along free.** Their footprint is in `canvas-template.ts` and
  `vite-config-template.ts`, both generators, plus `flow-meta.ts` which is plain Node fs.
- The port is 3 files of `vscode` coupling, plus a new host, plus retiring the proto/gRPC
  controller plumbing in favour of IPC.

### Deletion inventory

| Path | Files | Fate |
|---|---|---|
| `src/core/design` | 33 | **moves** (3 need de-vscoding) |
| `src/core/controller/design` | 9 | **moves** (already host-free) |
| `src/core/api` | 84 | delete |
| `src/core/task` | 86 | delete |
| `src/core/prompts` | 115 | delete, except `design-rules.ts` + `design_layer.ts` → `get_guide` |
| `src/core/controller` (rest) | ~198 | delete |
| `webview-ui/src` | 338 | delete, except `components/design-wizard` |
| `cli/`, `standalone/`, `evals/`, `walkthrough/`, `proto/` | — | delete |

---

## 3. Track A — Desktop shell

**Runtime: Electron.** Tauri uses the system webview: WKWebView on macOS, Chromium on
Windows, WebKitGTK on Linux. The same design would render differently depending on which
machine Caret is installed on, which is disqualifying for a WYSIWYG tool. WebKitGTK also lags
badly on the modern CSS Tailwind 4 emits (`@property`, `color-mix`, `oklch`). Electron bundles
a Chromium you control and that matches what most visitors use.

### A1. Shell
Windows, menus, native dialogs. Preferences store replacing `StateManager`/globalState —
a JSON store in `app.getPath('userData')`, with the same get/set shape so call sites barely
change.

### A2. Project lifecycle
Pick folder → detect or scaffold `.caret/` (`ensureCaretDirectoryExists` already handles
this idempotently) → `npm install` inside `.caret/` if needed → boot Vite → open window.
Recents list. Multiple project windows.

### A3. De-vscode the three files
- `preview-panel.ts` → `CanvasWindow`: a `BrowserWindow` loading the Vite URL. The
  postMessage relay becomes `ipcMain`/`ipcRenderer`. The `openTextDocument`/`showTextDocument`
  path (line 276-282) becomes "reveal in the user's editor" via `shell.openPath` or a
  configured `$EDITOR`.
- `DesignMode.ts` → app lifecycle. Its `vscode.Disposable[]` contract becomes a plain
  teardown array. The existing lifecycle mutex and vite-crash surfacing carry over unchanged.
- `SyncWatcher.ts` → chokidar instead of `vscode.FileSystemWatcher`. Keep the 1500ms debounce.

### A4. IPC and the proto retirement
The extension↔webview gRPC-over-message-passing layer exists to cross the VS Code webview
boundary. Electron IPC crosses the same boundary natively, so `proto/` and
`src/generated/*` are deleted rather than ported. The design message protocol in
`rendering-shell/messages.ts` (already a plain discriminated union with runtime validators)
is kept as-is and carried over IPC.

### A5. Reliability floor
`scripts/verify-design-shell.ts` boots the generated shell on a fixture and runs 14 browser
scenarios. **It must be ported before any refactor lands**, extended with an Electron launch
path. Losing it during the migration is the expensive mistake available here.

### A6. Builds
electron-builder. macOS `.zip` + Homebrew Cask, Windows `.exe` + Scoop, Linux
AppImage/`.deb`/`.rpm`. Ad-hoc codesign for Apple Silicon is mandatory and free — arm64
binaries will not execute unsigned, and the failure looks like a corrupt download.
**Configure signing hooks now with credentials absent**, so adding SignPath (free for OSS)
or the $99 Apple cert later is a secrets change rather than a pipeline rebuild.

---

## 4. Track B — Agent decoupling + MCP

### B1. The adapter boundary
Every `controller.initTask(prompt)` call site becomes an outbound request on an
`AgentBridge` interface. Today's callers: `sync-orchestrator.ts` (design→app sync),
`ai-edit-handler.ts` (visual AI edits), the overlay editor, and the flow-restructure nav sync.

```ts
interface AgentBridge {
  connected(): boolean
  request(task: { kind: 'sync' | 'visual-edit' | 'flow-sync', prompt: string,
                  context?: unknown }): Promise<void>
}
```

Two implementations: `McpBridge` (surfaces the task to a connected agent) and
`NullBridge` (returns a "connect an agent to do that" prompt). Every feature that used to
call the task loop now degrades honestly instead of silently failing.

### B2. MCP server
Local HTTP on a fixed port, auto-started on project open, same shape Paper uses. Tools v1:

| Read | Write |
|---|---|
| `get_project` — `.caret/` structure, page + flow inventory | `create_page` |
| `get_page` — source of one page | `write_page` |
| `get_tokens` — foundation tokens | `update_tokens` |
| `get_flows` — flow graph + page states | `write_flow` |
| `get_screenshot` | `set_param` *(lands with Track C)* |
| `get_params` *(lands with Track C)* | |
| `get_sync_worklist` — the changed-design worklist | |
| `get_guide` — authoring rules | |

### B3. `get_guide` is not optional
`src/core/prompts/system-prompt/design_layer.ts` is the always-on design-mode system prompt.
It teaches `useCaretState()`, `useCaretNavigator()` + `<a href="/<page-id>">` navigation, flow
file generation, and embeds `CARET_ID_RULES` + `INLINE_EDITING_RULES`. With the bundled agent
gone this content has no delivery path. It becomes the `get_guide` tool. **Without it every
connected agent authors `.caret/` pages incorrectly** and inline editing silently breaks.
Treat as blocking, not polish.

### B4. Sync becomes an agent job
`sync-orchestrator.ts` keeps all its preflight logic (git state assessment, bookmark reading,
`hasDesignChangesSince` gating, pending-sync registration, pre-sync checkpoint). Only the
final `controller.initTask(prompt)` changes to `bridge.request({kind:'sync', prompt})`.
`buildSyncPrompt` is unchanged. The plan/act bookmark advance in `sync-completion.ts` needs a
new completion signal now that there is no local task lifecycle — the agent calls a
`complete_sync` tool.

### B5. Clients
Claude Code plugin + `claude mcp add`, Cursor, Codex, OpenCode, Kimi, GLM. One docs page each.
Once the server speaks MCP this is documentation, not architecture.

---

## 5. Track C — Parameter model *(design together — stub)*

The substrate everything expressive depends on. **`data-caret-id` stops being the whole
address and becomes the first segment of a path**, which makes this additive rather than a
rewrite: the codemod still stamps ids, `findJSXElementByCaretId` still works, and each new
capability is a resolver for a path suffix.

```
hero-cta                                  the element
hero-cta/style/background/stop[1]/color   a leaf inside a parsed value
hero-cta/motion/hover/t[0.4]/scale        a value at a point in time
hero-cta/box/width                        geometry
stage/scene/Lamp/material/emissive        past the canvas boundary
list-row[3]/style/padding                 one instance of an iterated template
```

Three axes the DOM alone cannot express get added: **time**, **scene graph**, **instance**.

### Source writes, runtime verifies

An earlier draft said "read from the runtime, write to the source". That is right for colour
and quietly wrong for everything else, because **computed style is a lossy projection**: it
gives the effective value but not which authored declaration produced it.

- `p-4 md:p-8` — computed style at the current viewport returns one number and no hint which
  class produced it.
- px → scale step is ambiguous (`16px` could be `p-4`, `p-[16px]`, inherited, or a token) and
  depends on the root font size, which `entry-template.ts:279` sets via `--caret-font-base`.
- Shorthand collapses: `p-4` reads back as four separate longhand properties.
- Typography is *overwhelmingly inherited*, so computed style routinely reports an ancestor's
  value with no signal the element declares nothing.

So invert it:

| | role |
|---|---|
| **Source** (`className`) | parse to candidate utilities, resolve which is *active* for the current viewport + state → this is `Param.source`, the splice span |
| **Runtime** (`getComputedStyle`) | the effective value for display, **and a check** that source resolution was right |

**The disagreement is the reliability mechanism.** Agreement means write confidently.
Disagreement means something else is in play (inline style, a CSS file, a class on a wrapping
component) so emit `writable: false` with a reason instead of writing the wrong thing.

This is only reliable because `.caret/` is a controlled environment: known Tailwind, known
breakpoints, and a known current viewport (viewport presets, Phase 4). The class list *is*
the declaration list and utilities are single-purpose, so expanding them is exact. In an
arbitrary app you would have to walk `document.styleSheets` and replay the cascade.

**Consequences.** Match tokens from the *source*, not the computed value — `p-4` names step 4
unambiguously and `bg-brand-500` names its token directly, so reverse-lookup from px or hex is
only a fallback for arbitrary values. Responsive edits target **the variant that is currently
active**, shown in the panel as *"editing `md:` · 768px and up"*. Inherited values get the
same two-way choice as tokens: edit here (add a declaration) or jump to the ancestor
(`origin: 'inherited'` exists for this).

```ts
interface Param {
  path:   string
  type:   'color' | 'length' | 'easing' | 'vec3' | 'enum' | 'number' | 'string'
  value:  unknown        // canonical, read from the runtime
  source: { file: string; start: number; end: number } | null   // the splice span
  origin: 'literal' | 'token' | 'inherited' | 'computed' | 'data'
  writable: boolean
  reason?: string
}
```

Every update is a **splice** (see §8). `origin: 'data'` + `writable: false` + reason *is* the
dynamic-content answer, so it needs no special case.

### Token binding — settled 2026-07-28

**The gap found while designing this:** tokens are currently *copied by value*.
`design_layer.ts:110-119` instructs the AI to write the seed as a Tailwind arbitrary value
(`bg-[#1a2b3c]`) and says *"use tokens for data/logic, not for className styling"*. So
`caretTokensPlugin` serves `foundation.json` over `virtual:caret-tokens` with HMR, but
**changing a token today changes nothing in already-generated pages**. Tokens are a
generation-time seed, not a live binding, and `origin: 'token'` would never be true.

**Fix: generate Tailwind 4 `@theme` from `foundation.json`.** Pages write `bg-brand-500`
instead of `bg-[#3b82f6]`. Change the JSON → regenerate the CSS → every element updates via
HMR with no page rewrites. Tailwind 4 is already pinned (`scaffold.ts:53`) and
`entry-template.ts:270` already does `@import "tailwindcss"` with a `--caret-*` `:root` block.

Includes **typography** (`--font-*`, `--text-*`, `--leading-*`, `--tracking-*`,
`--font-weight-*`); `FoundationTokens.typography` already carries family, fallback,
scaleRatio, baseSize and scale. One split while in there: **the token is not the loading.**
Family belongs in `@theme`; the actual font `@import` moves out of per-component CSS
(`design_layer.ts:113`) into the generated entry CSS — per-component imports duplicate
requests, cause FOUT, and can't be deduped.

Secondary benefit: `bg-brand-500` carries semantic meaning that maps onto the app's own design
system during sync. `bg-[#1a2b3c]` is a magic number the agent has to guess about.

**This breaks inline colour editing in three ways, all fixable:**

1. **Silent no-op.** `isTailwindColorClass` (`ast-editor.ts:263`) tests
   `TAILWIND_COLOR_NAMES.has(parts[0])` against Tailwind's built-in palette. `brand` is never
   in it, so `bg-brand-500` isn't recognised, `replaceTailwindColorClass` returns `null`, and
   the edit fails silently. → Make the recogniser token-aware: built-ins ∪ generated `@theme`
   names, derived from the same file.
2. **No token path.** `ast-editor.ts:276` unconditionally writes `${prefix}[${newHex}]`, so
   every edit is a detach by construction. → See the write policy below.
3. **Picker opens on the wrong colour**, since no hex is parseable from the class. → Read the
   resolved value from the runtime. (This already mis-behaves today for named Tailwind
   colours like `bg-blue-500`.)

**Write policy — default follows the entry point.** A modal after a native picker would
violate the inline-editing rule, so let the gesture imply intent and make the alternative one
click:

- **Inline** (right-click one element) — you are pointing at one thing → default **detach**.
- **Panel** (a labelled row reading `background: brand-500`) → default **edit the token**.

After an inline edit, a non-blocking toast: *"Detached from `brand-500`. Change the token
instead? (47 elements)"*. Rationale is **blast-radius asymmetry**: a wrong detach hits one
element and is visible immediately; a wrong token edit silently changes 47 elements across 8
pages. Default to the recoverable action. Caret can compute those counts exactly by scanning
`.caret/`, which Figma cannot. Also offer to bind when a picked colour exactly matches an
existing token.

**Accepted risk:** if inline is the primary interaction, defaulting to detach erodes the token
system. Mitigated but not removed by the one-click promotion and a per-page detached-override
count in the panel. Observable beats silent.

### Resize is the exception — needs three extra layers

The read/verify half transfers. The write half does not:

- **There is often no responsible declaration.** Width can be *emergent* from a layout
  algorithm (block fills parent, `flex-1` derives from siblings, grid item from the parent's
  `grid-cols-*`, inline-block from content). Colour, padding and type always resolve to a
  declaration somewhere; size may not.
- **The write target may not be the selected element** — often it's the parent's
  `grid-cols-*` or `gap-*`, or a sibling's `flex-grow`.
- **Many encodings produce identical pixels**: `w-[247px]`, `basis-[247px]`,
  `flex-[0_0_247px]`, `col-span-2`, a parent `gap` change.
- **The gesture is continuous**, so it needs optimistic DOM preview during the drag and a
  single source commit on release. That inverts the usual write→HMR→see flow and is where the
  echo loop is most dangerous, so provenance matters most here.
- **The gesture is lower-bandwidth than the intent.** A drag usually means "fill the
  container" or "hug the content", not "247 pixels". Writing the pixel value captures the
  render and destroys the intent, and the layout then breaks at every other viewport.

**Additions:** a **layout-context resolver** (flow / flex child / grid item / absolute /
content-driven) that runs first and determines the candidate write targets including the
parent; a **write policy** choosing among encodings, visible and overridable; a
**preview/commit split**.

**Recommendation: expose intent, don't infer it.** Explicit sizing modes in the panel —
hug / fill / fixed → `w-auto`, `flex-1`/`w-full`, `w-[Npx]`. The drag writes a fixed value;
the mode selector carries the constraint.

> Third time the same move is the answer: record the mapping at sync time rather than infer
> it; show the blast radius rather than guess token intent; expose the sizing mode rather than
> deduce it from a drag. **When the information isn't in the gesture, put it in the interface.**

The verifier matters most here: write `w-[247px]`, and if the element still isn't 247px
because a parent constraint wins, say *"width is controlled by the parent's grid"* and offer
to edit that — rather than a silent no-op.

**Still open for the conversation:** canonical value forms to prevent round-trip churn; edit
provenance for the echo loop; undo across asynchronous multi-file agent edits.

**Visualizations planned:** the resolution chain; the instance discriminator; the
layout-context resolver + encoding choice for resize.

---

## 6. Track D — Reverse sync

### The problem
`.caret/` can push but never pull. `hasDesignChangesSince` only watches `.caret/`
(`sync-orchestrator.ts:95` even documents this: *"an unrelated app commit moves HEAD but
doesn't change the design"*), so app drift is structurally invisible. `SyncState` is one
field, `lastSyncedCommit`, so there is no record of what maps to what and every sync
re-derives the whole correspondence. Left alone, `.caret/` rots into a lying artifact — the
exact Figma failure mode the design layer exists to fix.

### Why the proposed solution is reliable

The shape is not novel. It is the **reconciliation loop** from infrastructure-as-code:

- **Terraform** — state file maps declared intent to real resources; `plan` computes drift;
  `refresh`/`import` pull reality back into state. Structurally identical.
- **Prisma** — schema is truth, `db pull` introspects the real database back into it.
- **Kubernetes controllers** — desired versus observed state, reconciled continuously.
- **Source maps** — the canonical mapping between two representations of one thing.

**Where a naive port would fail, and the fix.** Terraform's mapping has exact identity (a
resource ID). Design↔app has none, so re-deriving correspondence by matching content is fuzzy
inference — that is the version that would be unreliable.

So don't infer it. **Record the mapping at translation time.** When the agent performs a sync
it already knows the correspondence: it read `.caret/pages/checkout/index.tsx` and wrote
`src/routes/checkout/page.tsx`. Capture that as it happens. This turns an intractable
inference problem into bookkeeping, and bookkeeping is reliable.

### Manifest sketch

```jsonc
{ "version": 1,
  "lastSyncedCommit": "abc123",
  "entries": [{
    "designPath": ".caret/pages/checkout/index.tsx",
    "appPaths":   ["src/routes/checkout/page.tsx", "src/components/CheckoutForm.tsx"],
    "syncedAt":   "abc123",
    "designHash": "…",           // content hash at last sync
    "appHashes":  { "src/routes/checkout/page.tsx": "…" }
  }]
}
```

Drift is then a hash comparison, in both directions, with no inference:
design changed → forward sync; app changed → drift; both → conflict, surfaced not merged.

### Sequenced work
1. Manifest schema + write it during forward sync (agent reports mappings via a tool).
2. Bidirectional drift detection from hashes.
3. Incremental sync — only entries whose hashes moved, replacing full reconciliation.
4. App→design generation for drifted entries.
5. Conflict presentation. **Never auto-merge**; surface and let a human choose.
6. Framework-agnostic checkpoint against Vue and Svelte, not only React.

### Honest risks
App→design generation is the genuinely hard step and it is agent-mediated, so quality varies.
Mitigation: it produces a reviewable proposal, never a silent write. Multi-file mappings
(one design page → several app files) make hashing coarse; if that proves noisy, narrow to
per-region hashes anchored on the mapping.

---

## 7. Tracks E + Widgets *(design together — stub)*

Blocked on C. Both get detailed proposals and visualizations before code.

**E's hard problem, named up front:** drag-to-resize write-back. A 40px drag can validly
become `w-[240px]`, a flex-basis change, a grid span, a gap adjustment, or an absolute
offset. All produce the same pixels; choosing wrong generates code the user resents. This is
a **policy engine, not a formula**, and it is the riskiest interaction in the plan.

**Widgets' hard problems:** time addressing for the timeline; 3D scene addressing with
raycast hit-testing past the `<canvas>` boundary (R3F components need the codemod to stamp
stable ids the way JSX elements get caret-ids, since a Three object has no HMR-stable
identity otherwise).

**Scope line:** for shaders and 3D the job is **parameter exposure, not authoring**. You or
the agent write the GLSL; Caret surfaces uniforms as live sliders and the camera as a gizmo.
Nobody authors a fragment shader through a GUI. Not building a pen tool, vector illustration,
raster painting or video compositing — import, don't author.

---

## 8. Cross-cutting: the splice primitive

Settled 2026-07-27. See `~/dev/self-learning/caret-learning/visualizations/splice-algorithm.html`
and `parse-strategies.html`.

All source writes are **span replacements**, applied by offset splice, never by
`recast.print()`:

```js
const ordered = [...edits].sort((a, b) => b.start - a.start)  // descending
let out = source
for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end)
```

**Why not recast.** `print()` cannot know which subtrees changed without checking, so it
diffs the whole tree against the original: O(nodes), not O(edits). Roughly 35ms versus 4ms on
a 600-line file, ~2s versus ~225ms on a 60-page sweep. Parse with `@babel/parser` for
*offsets only* and skip codegen entirely.

**Rules.**
- Offsets are **absolute character indices** (UTF-16 code units, matching Babel and
  `String.slice`). If SWC is ever swapped in for speed its spans are UTF-8 **byte** offsets;
  that needs conversion, not a drop-in.
- Apply **back-to-front** so earlier offsets stay valid.
- Recompute spans from disk every time; never cache across edits.
- Batch per frame, one splice pass, one write through `runExclusive` + `writeFileAtomic`.
- The id codemod is **append-only**: once an id is in source it is immutable, and the
  structural path only seeds fresh ids. This keeps reruns idempotent (no write → no HMR →
  no loop) and keeps `git log -- .caret/` clean.
- Recast is still correct for genuine restructuring. Splice is only valid because these
  operations are pure span replacement.

**Bug class this retires.** `editJSXText` at `ast-editor.ts:156-158` reads `leading`/
`trailing` off the JSXText node and writes them back; recast re-indents the reprinted
subtree; the next edit reads the inflated whitespace and re-injects it. Indentation grows one
level per edit, and `normalize()` at line 147 collapses whitespace so the stale-target guard
can never catch it. Splicing the *trimmed content span* never reads or writes the whitespace
at all, so the feedback loop cannot exist.

---

## 9. Authoring contract

`/debug-ui-page` enforces twelve rules across two classes, and most are editor limitations
dressed as authoring constraints. Three-way split:

| Rules | Owner |
|---|---|
| 7 locating rules (static/unique/missing ids, iterators, prop threading, own-line tags) | build-time codemod |
| `dynamic-tailwind-class` — real, but it's *Tailwind's* constraint (the JIT can't see it either) | lint rule + autofix |
| fragmented text, `dynamic-text`, `dynamic-image-src`, inline styles | absorbed into the editor as Param capabilities |

Target: twelve rules down to roughly one, and `/debug-ui-page` becomes a rare judgment-call
tool. A serious tool adapts to your code; Figma doesn't ask you to draw differently so the
select tool works.

---

## 10. Test strategy

`playwright._electron` (confirmed in 1.58.1). Electron testing uses the app's own binary, so
the missing-chromium-download issue in `verify-design-shell.ts:241-257` doesn't apply.

**Layers.** Unit (splice, codemod idempotence, resolution chain, manifest hashing) → the
ported 14-scenario `verify:design-shell` → Electron integration (launch, open, canvas, edit,
assert disk) → MCP protocol (pure HTTP, no GUI) → screenshot review.

**The decisive assertion is on disk.** "User dragged the picker to #ff0000" only matters if
the file now contains exactly that and *no other byte moved*. Explicit regressions for the
compounding-indentation bug, the write→HMR→read→write echo loop, and codemod idempotence
(second run writes nothing).

**Out of scope for automation:** feel, taste, Windows/Linux behaviour, Sequoia Gatekeeper,
real agent judgment. Feel gets video clips at checkpoints; the rest needs CI or a human.

---

## 11. Monetization boundary

Full reasoning in memory (`project-caret-monetization`). Pricing deferred; the *line* is not.

**Test:** does it cost real money to run AND genuinely require a server? Both yes = honest to
charge, and enforcement is automatic because the service is the product.

**Free forever:** the entire direct-manipulation editor. No key, no network, no account.
**Paid, in order:** Share → team collaboration (the product is *hiding git from non-devs*,
not multiplayer cursors) → CI drift diffs → hosted inference.

**Does not work:** metering the local MCP server. Paper can (closed binary, phones home);
an OSS binary cannot — anyone deletes the check. Study **Obsidian**, not Paper.

**Licensing constraint:** SignPath Foundation (free code signing for OSS) requires an
OSI-approved licence **without commercial dual-licensing**. Apache-2.0 + paid hosted services
is compatible. Open-core with proprietary modules in-repo is not.

---

## 12. Decision log

| Decision | Date | Rationale |
|---|---|---|
| Drop the bundled agent | 2026-07-28 | The unprofitable middle; parameter model *is* the MCP surface |
| Electron over Tauri | 2026-07-28 | System webview renders differently per OS; fatal for WYSIWYG |
| Strip in place on `caret/learning` | 2026-07-28 | Preserves design-layer history and Apache attribution lineage |
| Retire the Open VSX extension | 2026-07-28 | Last version stays published; deprecation notice ships *in* it |
| Port flows + simulation in v1 | 2026-07-28 | Core features, and nearly free — they live in generated templates |
| Splice over recast for span writes | 2026-07-27 | O(edits) not O(nodes); byte-exact; retires the indentation-compounding bug |
| Keep `data-caret-id` as the anchor | 2026-07-27 | Content-addressed. Fiber-path + source-position failed structurally: React 19 removed `_debugSource` (PR #28265), fiber paths shift under conditional rendering, line/col dies on every write |
| Codemod generates ids, not the model | 2026-07-27 | Prompt-enforced invariants drift; that's why Phase 3.5 and `/debug-ui-page` exist |
| Reverse sync records mappings, never infers | 2026-07-28 | Turns fuzzy inference into bookkeeping |
| Source writes, runtime verifies | 2026-07-28 | Computed style is a lossy projection; it can't name the responsible declaration. Disagreement between the two becomes the reliability check |
| Tokens bind via Tailwind 4 `@theme` | 2026-07-28 | Tokens are currently copied by value, so editing one changes nothing already generated. Also improves sync: `bg-brand-500` carries meaning, `bg-[#1a2b3c]` doesn't |
| Typography included in `@theme`; font loading centralised | 2026-07-28 | Per-component `@import` duplicates requests and causes FOUT |
| Token vs detach defaults by entry point | 2026-07-28 | Blast-radius asymmetry — default to the recoverable action, promote in one click |
| Resize exposes hug/fill/fixed | 2026-07-28 | The gesture carries less information than the intent |
| Discard Canvas UI / html-in-canvas | 2026-07-28 | WICG early stage, flag-gated, no Firefox/Safari position; output wouldn't ship. WebGL overlays are the shippable technique |
| Defer code signing | 2026-07-28 | Not build-blocking. SignPath free for OSS; Windows is not $500 |

### Still open

- Which of the four Gate items in Phase 6 are settled (licence, auth stub, service seam, local-forever commitment)
- Whether `cli/` is deleted or repurposed as a headless Caret client

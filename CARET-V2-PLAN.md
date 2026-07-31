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

### List items — two identities, and an index that must be built once

A repeated row has **no single source location**. The file holds one row's *appearance* and N
rows' *content*, in different places. So editing a list row is two operations, not one:

| edit | lands in | reaches |
|---|---|---|
| **look** (padding, colour, border) | the row template — written once | **all rows** |
| **content** (text, image src) | the data — one entry per row | **that row only** |

The defaults match intuition in both directions (retyping a label changes one row; nudging
padding keeps rows matching), which is why this feels fine in use despite being fiddly underneath.

**Three shapes, visually identical on screen:**

1. **Rows written out separately** — no machinery needed. Each row is an ordinary element with
   its own id and its own source span.
2. **One template + the data literal in the same file** — look is shared, content resolves to
   `items[N].field`. Both editable.
3. **One template + data from a server** — look behaves as (2); the content *is not in the file*.
   Emit `writable:false` with a reason, never a silent grey-out.

**Shape 2 dominates inside `.caret/`.** Design pages are self-contained React with no backend,
so any list they render must carry its own sample data inline. Shape 3 is mostly a property of
the *shipped app* after sync. Consequence worth designing for later: the design will show three
tidy rows while production has fourteen with longer strings — a "stress state" (long text, many
rows, empty) belongs in the Phase 4 page-states machinery.

**Rules:**

- **Identify a row by its key, not its index.** Position-based ids point at the wrong item after
  a reorder.
- **"Make this row different" is an explicit restructure**, never an outcome of dragging. Escaping
  a shared template means adding a condition or splitting the row out; a drag must not silently
  rewrite the template.
- **Data-driven styling is ambiguous.** If featured rows already look different, "edit this row's
  highlight" could mean *unfeature this item* or *change what featured looks like*. Ask.
- Panel line that removes the whole confusion:
  `row 2 of 3 · look shared with all rows · content from item 2`

#### Index the file once per parse, not once per lookup (measured 2026-07-30)

The single-edit chain is cheap: one walk to find the element, then pointer-following (parent
links) and a scope lookup — **0.4ms**. But the property panel resolves ~50 properties per
selection, and re-walking from the root each time is the real cost:

| page | 50 lookups, re-walking | one walk + an id→node map |
|---|---|---|
| typical (60 lines, 12 items) | 13.9ms | **0.6ms** |
| big list (200 items) | 49.4ms | **1.4ms** |
| large page (420 lines) | **115ms** | **3.1ms** |

115ms to select an element is a visible stutter. So: **build a `caret-id → node` index once per
parse**, then every lookup is a map hit (22–37× faster, and the gap widens with file size). Also
**resolve on click, never on hover** (hover highlighting needs only the DOM) and **once at
pointerdown, never per frame**.

**The risk here is staleness, not speed.** A cached index whose file changed underneath (HMR,
an agent edit, an external save) has every offset wrong and will splice into the wrong place
*silently*. Key the index to the file's content hash and discard on mismatch — hashing is ~30×
cheaper than parsing, so it is affordable on every access. This is the same rule as
"recompute spans from disk, never cache across edits", applied one level up.

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

**Additions:** a **layout-context resolver** (below); a **write policy** choosing among
encodings, visible and overridable; a **preview/commit split**.

#### The resolver walks, and returns a chain — not a target

**Classification is one level. Attribution is not.** Whether you are a flex item, a grid item
or a block in flow is decided solely by the parent's `display`, so the branch dispatch is
correctly one level up. But *where the size comes from, and where to write*, is not bounded:

- **Chained auto blocks.** A `width:auto` block takes its parent's content width; if that
  parent is also auto, the question forwards again. Verified in the visualization: three
  pass-through levels before anything declares a width. **One level up points at the wrong
  element.**
- **`position:absolute`** resolves against the *containing block* — nearest ancestor with
  `position` set, or one established by `transform`/`filter`/`contain`. Arbitrary distance,
  and it skips every intermediate element.
- **`display:contents`** on the parent means you are laid out as a child of the grandparent,
  so even classification must skip those ancestors first.
- **Component wrappers.** The DOM parent may be a `<div class="grid">` rendered inside
  `<Card>` in another file; finding the *source* to edit is a second hop.

So the resolver returns every participant:

```
level 0  the element      clicked        declares nothing
  +1     ancestor         pass-through   width:auto (decides nothing)
  +2     ancestor         pass-through   width:auto (decides nothing)
  +3     ancestor         constrainer    width:520px  ← the real target
```

**Termination is guaranteed**: stop at the first element that declares a size, is a flex/grid
container, is the containing block for an absolute descendant, or is the document root. Bounded
by DOM depth (typically <20), computed on selection rather than per frame, cached per selection.

Returning the chain is also better UX than picking one target: the panel can say *"this width
is decided by 3 things"* and let the user choose, instead of Caret guessing.

#### Height is in scope, and it is not symmetric with width

`resolveSizeContext(el, axis)` takes the axis, because the same keyword means opposite things:

| | `width: auto` | `height: auto` |
|---|---|---|
| normal flow | **fill** the parent (resolves *upward*) | **hug** the content (resolves *downward*) |
| flex row child | main axis — a *share* (`flex-1`) | cross axis — the **tallest sibling** (`align-items:stretch`) |
| grid item | the column track | the row, which is `auto` = **tallest item in the row** |

Verified on the same element in the visualization: width → `fill-chain` (436px, chain of 4),
height → `hug` (34px, chain of 2).

Three consequences:

- **Height branches differently.** It additionally consults `align-items`/`align-self` on a row
  flex parent, `grid-template-rows`/`grid-auto-rows`, and whether an ancestor has a *definite*
  height (percentage heights against an auto parent resolve to auto).
- **The default intent differs per axis.** Fixing a width is often legitimate (a sidebar, a card
  in a grid). Fixing a height usually is not — text grows when copy changes, gets translated, or
  the user's font size increases, so a pixel height clips or gaps. So `hug` should be the
  default for height far more often than for width, and dragging a bottom edge deserves more
  friction than dragging a right edge.
- **Aspect ratio couples them.** For images, video, canvas and 3D viewports, `aspect-ratio`
  means resizing one axis should offer to adjust the other. Height-specific concern.

*Deferred:* logical axes (`inline`/`block`) rather than physical width/height. Correct for RTL
and vertical writing modes, and Tailwind 4 supports the logical properties, but not v1-blocking.

**Recommendation: expose intent, don't infer it.** Explicit sizing modes in the panel —
hug / fill / fixed → `w-auto`, `flex-1`/`w-full`, `w-[Npx]`. The drag writes a fixed value;
the mode selector carries the constraint.

> Third time the same move is the answer: record the mapping at sync time rather than infer
> it; show the blast radius rather than guess token intent; expose the sizing mode rather than
> deduce it from a drag. **When the information isn't in the gesture, put it in the interface.**

#### Corrections from measuring a real browser (2026-07-30)

The sketch above was reviewed by re-running its own principle against Chrome rather than
trusting anyone's CSS knowledge. Four claims in it were wrong. All numbers below are measured,
not reasoned.

**1. `el.style.width` is not a valid preview channel for the flagship case.** Tailwind's
`flex-1` is `flex: 1 1 0%`, and when `flex-basis` is `0%` the flex algorithm never consults
`width`:

```
flex row, 520px, gap-3, siblings [flex-1, flex-1, w-120]
  baseline                      a=188  b=188
  el.style.width = '217px'      a=188  b=188   <- preview does NOTHING
  min/max-width clamp = 217px   a=217  b=159   <- works, siblings redistribute
  commit flex:0 0 217px         a=217  b=159   <- identical to the clamp
```

So the drag handle would move and the box would not. Two consequences:

- **The resolver must run at `pointerdown`, not `pointerup`.** The preview channel depends on
  the layout context, so the context must be known before the first frame. The prose above
  already said "on selection"; the code sketch in
  `visualizations/resize-write-policy.html` contradicts it and is wrong.
- **Preview and commit must share the encoding policy.** For a flex child the faithful preview
  is a `min-width`/`max-width` clamp, which the last two rows show produces *byte-identical
  geometry* to the `basis-[217px] shrink-0` commit. Rule: **the preview must never show a state
  the commit cannot reproduce.**

**2. A grid item with an explicit width does not snap back — it damages its neighbours.**
Measured across three track definitions:

| tracks | before | after `width:217px` | neighbourhood |
|---|---|---|---|
| `repeat(3,1fr)` | 165.33 | 217 | no overlap, but the **track grew and every sibling shifted** |
| `repeat(3,minmax(0,1fr))` *(what Tailwind emits)* | 165.33 | 217 | **overlaps the sibling** |
| `repeat(3,150px)` | 150 | 217 | **overlaps the sibling** |

In all three the item measures exactly what was written, so **element-level verification
passes on a visibly broken layout**. The snap-back-to-155 story in the visualization is not a
CSS behaviour at all — the demo produced it by never applying the width. That scenario needs
rewriting.

**3. Therefore a fifth failure mode exists, and it is catchable:** *write succeeds, target
verifies clean, a sibling breaks.* Fix is mechanical — snapshot sibling rects plus
`scrollWidth`/`scrollHeight` overflow state before commit, re-measure after, and flag
regressions ("now overflows its track", "sibling shrank 40%", "siblings shifted 52px").
**Verify the neighbourhood, not the node.**

**4. The verifier as sketched produces false positives, which is worse than no verifier.**

```
transition: width 400ms, 170px -> 217px
  measured 50ms in       175.88px   -> reports a mismatch that does not exist
  with transition:none   217px
grid 521px / 3 cols / 11px gap
  track width            166.33px   -> Math.round comparison is not integer-safe
```

So the verify pass needs a **settle protocol**, not just `await hmrSettled()`: suppress
transitions during measurement (`* { transition: none !important }` or await
`transitionend`), await `document.fonts.ready`, then a settled `requestAnimationFrame`. And
compare with an **epsilon (~0.5px)** on fractional values rather than `round(got) !== round(want)`.
A verifier that cries wolf produces exactly the haunted feeling the design exists to prevent.

**5. Verify across viewports, not just the current one.** `w-[217px]` can verify clean at the
active preset and break at `sm`. The viewport presets already exist, so re-measuring across
them is nearly free and catches part of the intent-destruction class that single-viewport
measurement structurally cannot.

#### Encoding policy: infer it from the codebase

A hardcoded preference is guessing at the user's conventions; reading the repo is not. Scan
`.caret/` for how comparable cases are already written and match them, because consistency with
surrounding code is most of what stops generated code feeling alien. Precedence:

1. **Explicit user intent** (the hug/fill/fixed mode) — always wins.
2. **Project convention** — if other flex children use `basis-*`, use `basis-*`.
3. **Context default** — the built-in policy per layout kind.

**Cold start matters:** a fresh project has no precedent, and the first write *seeds* the
convention every later write will copy. So the context defaults need to be the ones you would
want propagated, not merely the ones that happen to work.

The verifier still matters for the original case: write `w-[247px]`, and if the element isn't
247px because a parent constraint wins, say *"width is controlled by the parent's grid"* and
offer to edit that — rather than a silent no-op. But that is now the *easy* half. The hard half
is the write that succeeds and breaks something else.

**Still open for the conversation:** canonical value forms to prevent round-trip churn; edit
provenance for the echo loop; undo across asynchronous multi-file agent edits.

**Visualizations.** Built 2026-07-29 in `~/dev/self-learning/caret-learning/visualizations/`:
`resize-layout-context.html` (the resolver — 6 scenarios × 2 axes, real DOM and real
`getBoundingClientRect()`, chain output) and `resize-write-policy.html` (drag → choose →
commit → verify). **`resize-write-policy.html` needs correcting** — its `onPointerUp`
resolver order and its grid snap-back ending were both disproved by measurement on
2026-07-30; see the corrections above. `resize-layout-context.html` is unaffected. Still planned: the Param resolution chain; the instance
discriminator.

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
| Resolver walks and returns a chain | 2026-07-29 | Classification is one level, attribution is not — chained auto blocks, `position:absolute`, `display:contents`. One level up points at the wrong element |
| List rows have two identities | 2026-07-31 | Look lives in the row template (shared, all rows); content lives in the data (per-row). Identify rows by key not index. "Make this row different" is an explicit restructure, never a drag outcome |
| Index caret-id→node once per parse | 2026-07-31 | A single edit resolves in 0.4ms, but the panel does ~50 lookups; re-walking per lookup measured 115ms on a 420-line page vs 3.1ms indexed (22–37× faster). Resolve on click not hover, once at pointerdown not per frame. The real risk is a stale index splicing silently into wrong offsets — key it to the file content hash |
| Resolver runs at pointerdown, not pointerup | 2026-07-30 | The preview channel depends on the layout context, so the context must be known before frame 1 |
| Preview must be encoding-aware | 2026-07-30 | `el.style.width` is ignored on `flex:1 1 0%` (measured 188→188). A min/max clamp works and matches the `basis-*` commit exactly (217/159 both ways). Preview must never show a state the commit cannot reproduce |
| Verify the neighbourhood, not the node | 2026-07-30 | An explicit width on a grid item always applies (217px measured on all three track types) so element-level verification passes on a broken layout: `minmax(0,1fr)` and fixed tracks overlap, plain `1fr` grows the track and shifts every sibling |
| Verifier needs a settle protocol + epsilon | 2026-07-30 | `transition:width` measured 175.88px mid-flight → false mismatch. Fractional tracks measure 166.33px → `Math.round` is not integer-safe. A verifier that cries wolf is worse than none |
| Encoding policy inferred from the repo | 2026-07-30 | Explicit user mode > project convention > context default. Cold start seeds the convention, so defaults must be what you want propagated |
| Height is in scope, axis-parameterised | 2026-07-29 | `width:auto` fills (resolves upward), `height:auto` hugs (resolves downward). Same element gives opposite verdicts, so the resolver takes an axis and the write policy differs per axis |
| Discard Canvas UI / html-in-canvas | 2026-07-28 | WICG early stage, flag-gated, no Firefox/Safari position; output wouldn't ship. WebGL overlays are the shippable technique |
| Defer code signing | 2026-07-28 | Not build-blocking. SignPath free for OSS; Windows is not $500 |

### Still open

- Which of the four Gate items in Phase 6 are settled (licence, auth stub, service seam, local-forever commitment)
- Whether `cli/` is deleted or repurposed as a headless Caret client

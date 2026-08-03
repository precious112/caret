# Caret V2 — Engineering Plan

Companion to [CARET-PHASES.md](./CARET-PHASES.md). That file tracks *what* and *when*; this
one is *how* and *why*. Decisions live here so they don't have to be re-derived.

**Read §0.5 first.** It reframes what Caret is for, and sections 1–12 were written before it.

**Status by phase** (see [CARET-PHASES.md](./CARET-PHASES.md) for the checklists):

| phase | state |
|---|---|
| **6** Standalone + inbound MCP | **built**; outbound half moved to 6.4 (§3, §4) |
| **6.5** Foundation interview | **specified (§4.5)** — library content needs a curation session with the user |
| **7** Make corrections stick | **not yet specified** — the differentiator, designed together next |
| **7.5** Component supply | **specified (§5.5)** — gated on a user review of the candidate list |
| **8** Shared human/agent surface | specified (§5), missing the naming layer — see §0.5 Bridge 1 |
| **9** Reverse sync | specified with its reliability argument (§6) |
| **10** Direct manipulation (resize only) | specified (§5, resize subsection) |
| **11** Supply | **deliberately unspecified** — gated on the friction research |
| **12** Share, then collaboration | sketched (§11 monetization) |

**Deferred behind Phase 11, not dropped:** snapping, gradient editing, motion timelines, 3D,
shaders. Notes retained in §7.

---

## 0.5 What Caret is actually for (2026-08-01)

Everything below §1 was designed on the assumption that Caret is a design tool that needs to
reach Figma parity. That assumption was tested against four "expensive-looking" reference
designs and against the documented experience of people shipping AI-generated UI, and it does
not hold.

### Precision does not supply taste

Break down what made those four reference footers look expensive: **an asset, a typeface, and
one compositional move (crop something huge at the edge), sitting on a completely conventional
layout.** All four shared the same layout — text block top-left, link columns top-right, thin
divider, legal row, oversized wordmark bleeding off the bottom. No unusual grid, no clever
spacing, no decoration. The links are unstyled text.

None of it required a gradient stop dragged or an easing curve tuned.

A dev who cannot design, handed a gradient stop editor, produces an ugly gradient with
beautifully draggable stops. **Precision tools amplify taste; they do not supply it.** Track
C/E/Widgets as originally scoped is Figma parity — necessary so the tool isn't a chat box,
insufficient for Caret's actual user.

**Persona, pinned 2026-08-01:** a developer — comfortable with a repo, a terminal, and
connecting an agent — who is not good at design. Not a no-code end user. Onboarding may
assume a dev; the design surface must never assume design vocabulary.

The specific error: **we designed the manipulation without designing the vocabulary.** Gradient
stops draggable to the pixel but no notion of "aurora". Easing curves hand-editable but no
motion tokens. That is the human half of a two-sided surface, shipped as if it were the feature.

### The problem worth solving

> *"AI design is one-shot: the agent generates, you eyeball it, you fix the same problems by
> hand, and next session it makes them again."*

v0, Lovable, Bolt and Replit all regenerate from scratch. Corrections evaporate. **`.caret/`
persists** — in the repo, under git, reviewable in a PR. That is the one structural advantage
Caret has, and the roadmap is now ordered around it.

### The precision gap, and the two bridges

Human direct manipulation is a **closed loop**: see, adjust, see, twenty times a second. An
agent writing code is **open loop**: guess, write, hope. Language is lossy for continuous
perceptual values. So *"a bit bouncier"* is speakable but imprecise, and
`cubic-bezier(.34,1.56,.64,1)` is precise but unspeakable.

**Bridge 1 — name things at the right altitude.** `brand-500` not `rgb(255,107,107)`; `bouncy`
not the bezier; `aurora, warm, grainy` not four stacked radials; `hug/fill/fixed` not a pixel
width. Precise *and* speakable, and because the names live in the project's own token file,
agent and human share a vocabulary specific to this project. The parameter model is therefore
not merely how the panel edits — **it is the shared language**. Same parameter, two input
devices, one source of truth.

**Bridge 2 — when words fail, send options rather than instructions.** The agent produces N
variants; the human points at one. High bandwidth agent→human without needing high bandwidth
human→agent, and *pointing requires no design vocabulary*. Replit ships this as "Ambient
Intelligence"; treat it as table stakes.

### What the research says has to be true

- **Foundational rules always in context, never fetched on demand.** An agent asked to "build me
  a card" that must *choose* to look up spacing and type will not, and fills the gap from
  training data. This directly corrects the earlier `get_guide` design (§4 B3), which had the
  agent pull the guide when it wanted.
- **Machine-structured (JSON) over prose.** Reported ~80% token reduction and fewer
  hallucinations versus Markdown. `design_layer.ts` is currently all prose.
- **Tokens as live bindings, not values copied at generation time.** Otherwise editing a token
  changes nothing already made — which is exactly today's behaviour (`design_layer.ts:110`).
- **Declared-vs-built gaps get filled confidently and wrongly**, so drift is correctness work.

### The gap Caret has nothing for

Replit answered the grounding problem by building in Mobbin — 600,000+ real screens from 1,000+
apps, no separate account, so the agent references real work instead of averaging its training
data. Caret has no equivalent: no reference library, no asset generation, no typeface strategy.

**Deliberately unplanned.** The user is running hands-on friction research to establish whether
the sticking point is *"I can't describe what I want"* (a naming problem, solved by showing
options) or *"I know what I want and can't obtain it"* (a supply problem, solved by grounding).
Those point at different products. Phase 11 holds the seam; do not guess at its shape.

### What survives from the original design

All of it, re-ranked. The parameter model becomes the shared vocabulary rather than a panel
feature. Reverse sync becomes correctness rather than tidiness. Resize stays as table stakes.
Snapping, gradient editing, motion timelines and 3D are deferred behind the supply question,
because a beautiful gradient editor does not help someone who cannot choose a gradient.

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

**Track letters are historical.** Sections 3–7 below were written before the 2026-08-01
reframe and still use them. Map to the phases in
[CARET-PHASES.md](./CARET-PHASES.md) as follows:

| §  | Track | Phase | Ownership |
|---|---|---|---|
| §3 | A · Desktop shell | **6** | Claude end-to-end. Surface decisions only. |
| §4 | B · Agent decoupling + MCP | **6** | Claude end-to-end. Surface decisions only. Scope corrected 2026-08-03: agent-initiated path only. |
| §4.4 | *(new)* The coding backend | **6.4** | Claude end-to-end. Codex/Kimi adapters written untested until subscriptions exist. |
| §4.5 | *(new)* Foundation interview | **6.5** | Claude builds on the 6.4 backend; **the user runs it on a real project and rates it** (exception 2). |
| §4.6 | *(new)* Assets, tags, `@` refs | **6.6** | Claude end-to-end. Plumbing, not taste. |
| §4.7 | *(new)* Generated assets | **6.7** | Claude builds; **the user reviews the recipe library and rates real output.** Taste-rated, per exception 2 below. |
| — | *(new)* Make corrections stick | **7** | **Designed together.** Not yet specified — the differentiator; see §0.5. |
| §5.5 | *(new)* Component supply | **7.5** | Claude researches and proposes; **the user picks what ships.** |
| §5 | C · Parameter model | **8** | **Designed together before code.** Token binding moves to Phase 7. |
| §6 | D · Reverse sync | **9** | Claude end-to-end, design written up and justified first. |
| §5 | C · Resize subsection | **10** | **Designed together.** Specified; the rest of E is deferred. |
| §7 | E · Precision + Widgets | **deferred** | Behind Phase 11. See §7. |
| — | *(new)* Supply | **11** | Gated on the friction research. Unspecified by design. |
| §3–4 | F · Ship-readiness | **6** | Claude end-to-end. |

**Testing.** Claude tests every phase via `playwright._electron` (verified available in the
installed 1.58.1). Automated coverage is functional and filesystem-level; the decisive
assertion for Caret is almost always *"did the source file change to exactly this, and did
nothing else move"*. Claude cannot test feel, taste, Windows/Linux behaviour, macOS Sequoia
Gatekeeper, or real agent judgment.

**Every phase ends by using the app, not by running unit tests.** Launch the Electron binary,
open a project, walk the real flows — canvas, focus, an inline edit, a sync — and find the
broken ones. Unit tests are necessary and are not sufficient; the deliverable of this step is a
list of actual bugs found by operating the product.

**A scenario that supplies its own counterpart is not using the app.** Walkthroughs start from
a cold launch with nothing pre-connected and proceed by clicking only. If the harness injects
the other half of an interaction — an MCP call, a queued task, a file the UI was supposed to
create — that path is unverified regardless of how many assertions pass. The test for every
scenario: *could a user reach this state by opening the app and clicking?* The user's own
hands-on testing exists to judge UX and taste on features that already work — never to
discover that a flow dead-ends.

**Then continue to the next phase without checking in.** Set 2026-08-01. Asking after each
phase turns a long autonomous build into a chain of blocking handoffs. Two exceptions only:

1. **Testing is genuinely impossible** — needs real agent judgment, another OS, Gatekeeper, or
   a surface Playwright cannot reach. Say so plainly and hand over; never guess past it.
2. **A product-defining feature needs a taste rating** — the user builds something real with it
   and judges the output. That means the **Phase 6.5 foundation interview**, **Phase 7**
   correction capture / generate-and-pick / the acceptance checker, the **Phase 7.5** catalog
   (already gated on curation), and **Phase 10** resize feel. Infrastructure — the Electron
   shell, MCP plumbing, de-vscoding, reverse-sync correctness — ships autonomously once the
   app-level tests pass.

The "designed together" marks on Phases 7, 8 and 10 are a **separate, earlier gate**: design
before code. They do not change the post-phase rule above.

**Feel checkpoints.** Playwright records video, so feel-critical moments produce a short clip
for judgment rather than deferring UX feedback to the end. Resize (Phase 10) is the riskiest
interaction still in scope — discovering it feels wrong after it is built is expensive — and
the taste-rated features in exception 2 get the same treatment.

**Final acceptance** is the user attempting to reproduce high-end designs and judging whether
the tool makes that easy.

**Branch:** work happens on `caret/electron-opencode-migration` (the name is historical — it
predates the drop-the-bundled-agent decision; there is no OpenCode SDK anywhere in this plan),
merged to `caret/main` when green. Strip aggressively; `caret/main` remains the reference for
how anything originally worked.

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
│ Electron window                            │  Claude Code · Codex
│   app chrome renderer (projects, wizard,   │  OpenCode · Kimi · GLM
│   prefs, errors, interview surface)        │
│   + canvas WebContentsView                 │
│     → http://localhost:<vite>/  directly   │
│     = generated canvas in .caret/lib/canvas│
│        └── iframes .caret/pages/*/index.tsx│
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

- The canvas loads the Vite URL **directly** — as a `WebContentsView` inside a window whose
  chrome is an Electron-owned renderer. "Directly" survives (no iframe shell around the
  canvas, zero canvas porting); the chrome renderer exists because onboarding, the wizard,
  project open/recents, preferences and error surfaces need a host that is not generated code.
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
Windows, menus, native dialogs. The window is **app chrome** — its own renderer hosting
project open/recents, the wizard and interview surface, preferences and error surfaces — with
the canvas mounted as a `WebContentsView` pointed at the Vite URL. Preferences store replacing
`StateManager`/globalState — a JSON store in `app.getPath('userData')`, with the same get/set
shape so call sites barely change.

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

> **Scope corrected 2026-08-03.** MCP is client-initiated: a server can hold a tool call open
> for minutes, but it cannot start one. So this track covers the **agent-initiated** direction
> only — a user in their own terminal pointing their agent at the design layer. Everything
> **Caret-initiated** (sync, AI edit, overlay, interview, generate-and-pick) runs on the §4.4
> embedded backend, and no outbound feature may depend on an MCP client calling in. There is
> no `McpBridge`, no outbound task queue, and no "the agent will poll for work" mechanism —
> a long-polling `wait_for_work` tool was considered and rejected, because CLI agents return
> to a prompt after every turn and nobody is ever waiting.

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

Two implementations: a backend-based bridge (§4.4) and `NullBridge` (refuses with the
per-feature "connect a backend" message). Every feature that used to call the task loop
degrades honestly instead of silently failing.

### B2. MCP server
Local HTTP, auto-started on project open, same shape Paper uses. **Not a fixed global port**:
per-project port written to a discovery file so multiple open projects don't collide and
client configs point at the project, not the machine. **Bearer-token auth + Origin validation
are mandatory** — an unauthenticated localhost server that writes files is reachable by any
local process and, via DNS rebinding, by a malicious web page. Tools v1:

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

Phase 6.5 adds the interview tools (§4.5): `present_question`, `present_options`,
`commit_foundation`. Phase 7 adds `run_design_checks` (the deterministic acceptance checker)
and `propose_variants`.

### B3. Foundational context must be ALWAYS-ON, not a pull tool

> **Corrected 2026-08-01.** The design below had the agent *fetch* the guide when it chose to.
> Practitioner reporting names that exact pattern as a failure: asked to "build me a card", an
> agent gets component metadata and **ignores spacing, typography and colour, filling the gap
> from training data**. Foundational rules (tokens, spacing, type, caret-id rules) must be
> injected into every request, not offered as a tool call. Additionally, machine-facing context
> should be **structured JSON, not prose** (~80% token reduction, fewer hallucinations), so
> `design_layer.ts` splits: JSON for what the machine consults, prose only where judgment is
> genuinely required. `get_guide` survives for the prose half.

**Delivery mechanism (settled 2026-08-01): repo rules files, because MCP cannot inject.** An
MCP server exposes tools, resources and prompts; the *client* decides what enters context — no
server can force content into every request of an agent it does not own, so "injected into
every request" is not implementable at the MCP layer. The reliable channel is the one every
mainstream agent already auto-loads: **rules files in the repo.** Caret generates and maintains
`AGENTS.md`, `CLAUDE.md` and `.cursor/rules` from `foundation.json` + the authoring rules —
regenerated whenever tokens change, clearly marked as generated, and versioned with the design
(which Phase 7 wanted anyway; captured corrections land in the same files, which is how a
correction reaches every future session of every agent). Backstop: every MCP tool result
echoes the foundational JSON, so an agent that only touches the tools still gets re-anchored.

**What the original B3 got right, and still holds:**
`src/core/prompts/system-prompt/design_layer.ts` is the always-on design-mode system prompt.
It teaches `useCaretState()`, `useCaretNavigator()` + `<a href="/<page-id>">` navigation, flow
file generation, and embeds `CARET_ID_RULES` + `INLINE_EDITING_RULES`. With the bundled agent
gone this content has no delivery path. It becomes the `get_guide` tool. **Without it every
connected agent authors `.caret/` pages incorrectly** and inline editing silently breaks.
Treat as blocking, not polish.

### B4. Sync — Caret-initiated on the backend; MCP path for external agents

**The primary sync is Caret-initiated and specified in §4.4:** preflight → read-only plan
session → user review → apply in write mode → Caret advances the bookmark in its own code.
`sync-orchestrator.ts` keeps all its preflight logic (git state assessment, bookmark reading,
`hasDesignChangesSince` gating, pending-sync registration, pre-sync snapshot) and
`buildSyncPrompt` is unchanged — only the hand-off target changes.

**The pre-sync snapshot is re-implemented on plain git.** The current "Undo sync" restores
from the checkpoint shadow-git, which dies with the task loop (it is on the deletion
inventory). The replacement is a git ref/stash taken by the main process at sync start;
"Undo sync" restores app files from it and reverts the bookmark exactly as today. This also
removes the old limitation that rollback required the sync task to still be active.

**The external-agent path stays** — a user telling Claude Code "sync the design" pulls the
worklist via `get_sync_worklist` and reports completion via `complete_sync` with the syncId.
That is **honor-system**, and if the agent forgets, the V1 stuck-bookmark bug (every sync
re-reporting the whole design layer) returns. Fallbacks: hash-based detection that the
worklist entries were addressed (exact once the Phase 9 manifest exists; a coarse heuristic
before then), and a manual "mark synced" control. On the Caret-initiated path none of this
honor system exists: the bookmark advances deterministically on apply.

### B5. Clients
Claude Code plugin + `claude mcp add`, Cursor, Codex, OpenCode, Kimi, GLM. One docs page each.
Once the server speaks MCP this is documentation, not architecture.

### B6. The write model is direct-write + watch-and-heal

Nothing makes an external agent use `write_page` — Claude Code will edit `.caret/pages/*` with
its own file tools, bypassing the MCP write tools, the file-mutation queue and atomic writes.
The healing machinery treats that as the primary case so reliability never depends on agent
cooperation:

**Policy (settled 2026-08-03): direct edits to `.caret/` are an anti-pattern — tolerated and
healed, never recommended.** `.caret/` is Caret's surface; a person edits it through the visual
editor, an agent through the owned backend or the MCP write tools. Watch-and-heal stays exactly
as specified below (silently breaking on an outside edit would be worse than healing it), and
the first `external`-actor write in a session raises a once-per-session notice pointing at the
visual editor. Docs stop describing direct writes as a supported workflow.

- The chokidar watcher (A3) triggers the **caret-id codemod + validation on any external
  change** to `.caret/`. The build-time codemod moves forward from Phase 8; without it, v1
  ships with the Phase 3.5 reliability story regressed.
- Inline-edit splices already re-read from disk and key on the content hash (§5), so a
  concurrent agent write is caught rather than spliced over.
- Every change lands in the **edit-provenance log**: actor (inline / agent / external), file,
  param path where known, old → new value. Cheap to write now, impossible to reconstruct
  later — and it is the substrate Phase 7's correction capture mines.
- The MCP write tools stay as the *nicer* path (atomicity + validation for free, precise
  provenance), but they are an optimization, not the guarantee.

---

## 4.4 The coding backend (Phase 6.4)

**Decided 2026-08-03.** Caret embeds a coding agent behind an adapter seam and drives it
directly. This corrects the one unimplementable half of the 2026-07-28 pivot: "any agent over
MCP" works only for the direction where the agent initiates, and nearly everything Caret does
initiates in Caret's window. Owning the loop also restores capabilities BYO-agent could never
have: forced plan mode, an enforced acceptance checker, system-prompt context injection with no
rules-file indirection, and a chat surface inside the app.

Designs are code — multi-file React with shared components — and sync writes across the user's
whole app. Both are a *general* coding agent's job, which is why the backend wraps existing
agent SDKs rather than a bespoke loop.

### The seam

`src/core/design/agent/backend.ts`. All four adapters conform to this; anything a backend
emits that does not map onto it is dropped rather than passed through half-understood.

```ts
type BackendId = "opencode" | "claude" | "codex" | "kimi"

interface CodingBackend {
  readonly id: BackendId
  readonly displayName: string
  availability(): Promise<AvailabilityReport>   // installed? authenticated? remedy?
  startSession(opts: StartSessionOptions): Promise<BackendSession>
  /** One-shot, JSON-schema-constrained. Carries the interview and recipe narrowing. */
  structured<T>(req: StructuredRequest): Promise<StructuredResult<T>>
}

interface StartSessionOptions {
  workingDirectory: string
  mode: "read-only" | "write"     // read-only = plan phase; the agent may not write
  model?: string                  // backend's own namespace; omitted = backend default
  resumeSessionId?: string
  title?: string
}

interface BackendSession {
  readonly id: string
  send(input: { text: string; images?: string[] }): AsyncIterable<BackendEvent>
  respondToPermission(requestId: string, decision: "allow" | "deny" | "allow-always"): Promise<void>
  abort(): Promise<void>          // idempotent
  close(): Promise<void>
}

type BackendEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }                    // rendered collapsed
  | { type: "tool-start"; callId: string; name: string; summary: string }
  | { type: "tool-end"; callId: string; name: string; ok: boolean; summary?: string }
  | { type: "file-changed"; path: string }                // drives the diff list
  | { type: "permission"; requestId: string; tool: string; path?: string; summary: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: "done"; text: string }
  | { type: "error"; message: string; recoverable: boolean }
```

`StructuredResult` carries an `emulated` flag: backends without native schema support fake it
with prompt + parse + retry, and callers must know the guarantee is weaker there because the
post-validation becomes load-bearing. `NoBackendError` refusals name the fix per feature —
running with no backend is a supported state, and every feature that needs one says so plainly.

### The four adapters

| | OpenCode (reference) | Claude | Codex *(untested)* | Kimi *(untested)* |
|---|---|---|---|---|
| Package | `@opencode-ai/sdk` | `@anthropic-ai/claude-agent-sdk` | `@openai/codex-sdk` | `@moonshot-ai/kimi-agent-sdk` (+ `zod` peer) |
| Wraps | bundled `opencode` binary | `claude` CLI | `codex` CLI | `kimi` CLI |
| Session | `createOpencode()` → `session.create` / `prompt` / `prompt_async` | SDK session API | `startThread({workingDirectory})` / `resumeThread(id)` (persists in `~/.codex/sessions`) | `createSession({workDir, model, sessionId, executable})` |
| Streaming | `event.subscribe()` SSE | SDK message stream | `runStreamed()` async generator (`item.completed`, `turn.completed`) | `session.prompt()` → async-iterable `Turn` (`TurnBegin`, `ContentPart`, `ToolCall`, `ToolResult`, `ApprovalRequest`, `StatusUpdate`) |
| Read-only mode | Plan agent + permission config | plan mode | approval modes | permission events (no `yoloMode`) |
| Structured output | `format: {type:"json_schema"}`, `StructuredOutputError` on failure | forced tool use | `outputSchema` on `run()` | **none — emulated** |
| Abort | `session.abort` | SDK abort | thread abort | `session.close()` / interrupt |
| History | `session.list` + `session.messages` | SDK session list | `~/.codex/sessions` via `resumeThread` | `listSessions(workDir)` + `parseSessionEvents` |
| Auth | reads OpenCode's standard credential store | `claude auth login` / `setup-token`; keychain-backed | `CODEX_API_KEY` env injection, or CLI login | Kimi CLI login; config in `~/.kimi/` |

Codex and Kimi ship **written to spec and flagged untested** until subscriptions exist to test
against; their availability checks must say so rather than presenting them as equally proven.
**GLM gets no adapter**: Z.ai ships no embeddable agent SDK (ZCode is an application), and
GLM's coding plan works through OpenCode's provider config, which Z.ai supports day-one.
Revisit only if a ZCode SDK appears.

### OpenCode specifics

- **Bundled, pinned, spawned from the app bundle — never resolved from `PATH`.** A user
  upgrading their own OpenCode must not change what Caret executes. Per-platform binaries via
  `extraResources` in `electron-builder.yml` (mac arm64/x64 kept per-arch, not universal-doubled).
- **Inline config only.** Caret never writes `~/.config/opencode/*`; it *reads* the user's
  standard credential store so an existing signed-in account is picked up without a second
  login, and passes provider/agent/permission config to `createOpencode()` inline.
- Server surface used: `session.create` / `prompt` / `prompt_async`, `GET /event` (SSE),
  `GET /session/:id/diff`, `POST /session/:id/abort`, `POST /session/:id/permissions/:id`,
  `session.revert`/`unrevert`, `POST /session/:id/fork` (design-mode branching: explore a
  direction, fork back, try another).
- **Before the sidebar is built:** boot the server and read the live OpenAPI at `/doc`. The
  event vocabulary of `/event` and the response shape of `/session/:id/diff` are undocumented;
  pin both from the spec, never from assumption.

### Permissions — Caret is the enforcement boundary

Backend-native config (OpenCode's Plan agent, per-agent `edit: deny`, glob rules like
`".caret/**": "allow"`) is the first line only. Upstream has open issues where **subagents
inherit none of the parent's plan-mode restrictions**, so Caret answers every permission
request itself and the rule holds regardless of which agent or subagent asked:

- `.caret/**` writes: auto-approved. Fixed policy, not a setting.
- App-path writes in a `read-only` session: **denied**, always.
- App-path writes in a `write` session: per the user's toggle — default **ask**, with a
  "don't ask again for this project" option on the prompt.
- The pre-task git snapshot (Phase 6) is the recovery net beneath all of it.

### Sessions and the chat surface

- **One session per activity** — a sync, a brainstorm, an edit — never one endless thread.
  The history panel reads as a list of things the user did.
- Collapsible chat sidebar (UX reference: OpenCode's desktop app): streamed text, collapsed
  thinking, tool-call lines, a file-change list, permission prompts, a stop button (= abort).
  Dismissible at will; available in design mode for brainstorming, not only during sync.
- **Diffs are computed from Caret's own pre-task git snapshot** — canonical and
  backend-independent. Backend diff endpoints are enrichment, never the source of truth.
- Chat history rehydrates from the adapter's session APIs, listed per project.

### Context injection

The owned backend gets foundation tokens, the authoring rules and the asset index **injected
directly into its system prompt** — no rules-file indirection, no choice to skip it. The
generated rules files (B3) remain exactly as they are, for external agents; they stop being
the only delivery mechanism.

### Auth and setup

Detection ladder, in order: bundled OpenCode (always present) → installed CLIs (`claude`,
`codex`, `kimi`) probed for presence and auth state → that backend's own account login →
paste-an-API-key last. A detected signed-in CLI shows as "found — use it", one click.

- Claude account auth bills the **separate Agent SDK credit pool**, not normal Claude Code
  limits — disclosed in one sentence at the point of choice, not in docs.
- The setup screen names **routes, never prices or quotas** (they drift): "OpenCode
  subscription", "OpenCode credits", "your own API key", with links out.
- A backend whose CLI is absent shows an honest "install this first" state with the command —
  never a dead option. CLI login flows spawned from Electron are tested cold; if one needs a
  real terminal, the UI says "run this command", then detects the credentials it wrote.

### Providers and the monetization boundary

Through the OpenCode adapter: **BYOK** (any provider) · **OpenCode Go** (flat subscription) ·
**OpenCode Zen** (pay-as-you-go credits). Caret-hosted inference later is an OpenAI-compatible
provider block —

```json
{ "provider": { "caret": { "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "https://api.caret.dev/v1" } } } }
```

— configuration, not integration, which keeps §11 exactly where it is: the local editor free
forever, inference the paid side.

### Sync on the backend

1. Preflight unchanged from V1 (git states, one-click fixes, `hasDesignChangesSince` gating).
2. Pre-sync snapshot captured.
3. Worklist prompt built (`buildSyncPrompt`, no file contents — the agent reads current
   sources itself).
4. **Plan phase:** `read-only` session; the plan streams into the sidebar; app writes are
   denied at Caret's permission boundary no matter what the agent config says.
5. User reviews. Rejecting ends the session; nothing was written.
6. **Apply:** the session switches to `write` mode; app-path permissions follow the user's
   toggle; diffs accumulate in the sidebar from the snapshot.
7. **Caret advances the bookmark in its own code on apply** — never by instructing the model
   to write `sync-state.json`. The honor-system `complete_sync` exists only on the external
   MCP path (B4).

---

## 4.5 The foundation interview (Phase 6.5)

**Decided 2026-08-01; mechanism re-decided 2026-08-03.** The token wizard stops being a form
the user fills in and becomes a **guided interview rendered natively in Caret's chrome, run by
Caret on the §4.4 backend**. Rationale: the wizard is the single moment Caret can inject taste
— the highest-leverage anti-slop lever available before the Phase 11 research lands — and a
form assumes the user already knows what to put in it, which is precisely what Caret's persona
does not. The 2026-08-01 form ("an agent-led flow the connected agent initiates") is
superseded: nothing in the product can cause an external agent to begin, so the flow was
unreachable by construction.

**Caret owns the state machine; the model supplies judgment.** Caret sequences fixed steps.
Per step it calls `structured()` with the user's product description, the decisions so far,
and the step's full curated candidate set — and the model returns a ranking with reasons. The
model never decides what comes next, never invents an option, and never writes a file.

**The flow:**

1. Entry: one field — *"Describe what you're trying to build."* The only typing in the flow.
2. Steps, in order: typeface pairing · colour direction · brand colour · density/spacing ·
   corner character · border-and-elevation weight. Adding steps is a user decision — question
   fatigue produces worse foundations than five good questions, so the description carries the
   inference and steps exist only where inference genuinely cannot.
3. Per step, `structured()` requests a ranking of 3 from the candidate set, one plain-language
   reason each, grounded in the description — "dashboards get read for hours, so this is sized
   for long sessions", never design jargon. The schema constrains it:

   ```json
   { "type": "object", "required": ["ranking"], "properties": { "ranking": {
     "type": "array", "minItems": 3, "maxItems": 3, "items": {
       "type": "object", "required": ["id", "reason"], "properties": {
         "id":     { "enum": ["<the step's curated ids, verbatim>"] },
         "reason": { "type": "string" } } } } } }
   ```

   The **`enum` is the anti-slop floor moved into the request**: a model cannot name a
   typeface or hex outside the library because the schema rejects it before Caret sees it.
   Post-validation stays regardless — schema-valid is not semantically valid (duplicate ids,
   an id from a previous step).
4. The step renders as specimens (existing surface: real typeface loaded, palette on real
   components, density as the same card at three sizes) with the **top recommendation
   preselected** and its reason shown. Pressing straight through yields a good foundation,
   not a default one.
5. **"None of these" is the user's override, never the model's** — the full Google Fonts list
   for type, a picker for colour. After an override, later steps are asked to pair around the
   user's choice. The model stays confined to the curated set at all times.
6. Every answer persists per step (scratch state under `.caret/`, gitignored, cleared on
   commit). A crash or abandoned backend at step 5 resumes at step 5.
7. Final screen: a real page rendered with the whole chosen foundation — not a swatch sheet.
   Confirm, or step back.
8. Commit builds `foundation.json` locally from the curated pieces plus `generateTokenScale`
   and regenerates the rules files. The model never writes it.

**The curated library is what makes this non-slop.** The model's judgment only *narrows* the
space; it never invents. Every pickable option — typeface pairing (licensing-clean), palette
recipe, radius/spacing/density preset — is curated in advance, so the floor is high no matter
which backend or model is connected. Library content is a curation session with the user, not
a generation task.

**Degradation, per step and total.** A `structured()` failure (including `StructuredOutputError`
and emulated-backend parse failure) degrades that one step to the deterministic tag-based
narrowing — same screens, no grounded reasoning line. **No backend at all** runs the entire
interview in that mode. The interview never dead-ends on backend state, and the old
"interview disabled until an agent connects" gate is gone.

**Both audiences, one file.** A pro skips the interview at any point into direct token editing
(the existing wizard widgets); a non-designer never leaves the describe-and-point flow. Both
paths write the same `foundation.json`, which Phase 7's live bindings then make load-bearing.

**The MCP interview tools survive as the external-agent path.** `present_question`,
`present_options` (library ids only, invented ids refused) and `commit_foundation` stay, with
the `foundation_interview` prompt and rules-file instruction, so a user driving Claude Code
from a terminal can still run a foundation session. The in-app interview does not use them.

**Re-running.** On an existing project, a re-interview produces a token-change *proposal* with
blast radius shown (Phase 7 machinery), never a silent reset.

---

## 4.6 Assets — supply, tagging, and `@` references (Phase 6.6)

**Decided 2026-08-02.** The design layer describes *how things look* and says nothing about
*what is in them*. Ask any connected agent for a landing page and it emits a grey placeholder
box or a stock URL, because those are the only options it has. Meanwhile the user's own
photographs, logos and icons cannot enter the design layer at all.

**Why this comes before Phase 7.** Phase 7 exists so a correction made once is respected
afterwards. If the correction the user keeps making is *"that grey box should be my product
shot"*, there is nothing to make stick — the asset has no identity to persist. Assets are a
prerequisite for the thing Phase 7 is about, not a nice-to-have alongside it.

### Storage

`.caret/assets/<file>` plus `.caret/assets/index.json`, under git like the rest of the layer.

```json
{
  "tag": "hero-shot",
  "file": "hero-shot.png",
  "kind": "image",
  "mime": "image/png",
  "width": 2400,
  "height": 1350,
  "bytes": 412889,
  "hash": "sha256:…",
  "alt": "Two people at a workbench, shot from above",
  "description": "wide, dark, empty space top-left",
  "origin": { "type": "uploaded" },
  "addedAt": "2026-08-02T09:14:22Z"
}
```

`tag` is the `@` name: unique, kebab-case, validated on write. `hash` gives dedupe and lets the
Phase 9 mapping detect a changed asset without re-reading pixels.

**`description` is the field that makes the feature work.** `2400×1350` does not tell an agent
that the image is dark and has room for a headline top-left, which is the only fact that
decides whether text can sit on it. The user can type it; the agent can propose it from the
pixels; either way it is *stored*, so it is not re-derived every session.

**Large binaries in git** is the obvious objection. The position: assets are design decisions
and belong with the design, the same argument as everything else in `.caret/`. Caret warns
above a size threshold and points at Git LFS rather than inventing its own store.

### Delivery — the always-on rule, third application

The index (tag · kind · dimensions · description, one line each) goes into the generated rules
block next to the foundation tokens. Pixels and full metadata stay pull-only behind
`get_asset`. This is the same reasoning as §4 B3 and §5.5 Retrieval: an agent that must
*choose* to enumerate assets will not bother and will emit a placeholder, confidently.

### The `@` reference

`@` in the AI-edit box and the overlay editor opens a thumbnail picker. **What travels to the
agent is the resolved entry, expanded inline** — path, dimensions, description — not the token
`@hero-shot`. Sending a token and trusting the agent to resolve it is the pull-tool failure
mode with extra steps, and it fails silently: the agent invents an asset that fits the name.

**Fit is the agent's judgment.** It has the intrinsic aspect ratio and the target box geometry
from the selection payload, so cover/contain/focal-point is a decision it is equipped to make.
The part Caret must supply is the ability to **refuse**: a 400×400 asset dropped into a 2400px
hero should produce a stated reason, not a silent upscale. Refusal is a feature here for the
same reason `NoAgentConnectedError` is.

### Serving and sync

Vite serves `.caret/assets` at `/caret-assets/`, so a page written by any author renders in the
canvas with no build step. Sync copies each referenced asset into the app's public directory,
rewrites the path, and records the copy in the mapping — without that record, Phase 9 reverse
sync sees an unexplained binary and reports drift forever.

### MCP surface

`list_assets`, `get_asset(tag)` → image content plus metadata, `add_asset`, `describe_asset`.
Watch-and-heal indexes anything written into `.caret/assets/` directly, probing dimensions and
deriving a tag from the filename — direct write stays a first-class path, as it is for pages.

### Kinds

Raster, SVG, video and 3D (`glb`/`gltf`) are all assets on identical terms: stored, tagged,
served, `@`-referenceable, synced. How a page *uses* one is the page's own code, rendered in the
canvas iframe like any other markup — Caret has no per-kind rendering path to build.

Only two things vary by kind. The **library thumbnail**: a poster frame for video, a rendered
still for a model. And what an agent receives from `get_asset`: pixels for raster and SVG, the
poster for video and 3D, plus metadata in every case.

### Agent vision is a prerequisite, and is certified

The overlay editor, an agent judging a generated asset, and an agent describing an upload all
require the connected agent to receive real pixels. Emitting MCP `image` content is not
sufficient evidence — the client decides what reaches the model — so this is certified against
a real client rather than assumed: an agent read a word off a rendered page where the word
existed in the fixture only as character codes, was random per run, and `get_screenshot` was
its only permitted tool. (The dedicated real-client suite was retired 2026-08-03 with MCP's
demotion; the finding stands, and the same guarantee on the owned backend is covered by §4.4.)

---

## 4.7 Generated assets — guided generation, never a prompt box (Phase 6.7)

**Decided 2026-08-02.** §4.6 solves *the user has an asset*. This solves *the user has none*,
which is the common case for the pinned persona and the reason landing pages built by
developers look the way they do.

### The rule

**The user never gets a prompt box.** They answer questions about what the asset is for; Caret
composes the request from a curated recipe library; N variants come back; the user points at
one. This is Phase 6.5's mechanism transplanted, and the justification transplants with it: a
prompt box returns the taste problem to the person who does not have it, and the resulting
`cinematic, 8k, hyperdetailed, trending on artstation` is exactly the artefact that makes
generated imagery legible as generated.

### The recipe library

`src/core/design/asset-library/`, deliberately the same shape as `foundation-library/`. One
recipe type across all four lanes — what varies is how a recipe is *realised*, which keeps the
interview, the narrowing and the pick surface identical regardless of what produced the pixels:

```ts
interface AssetRecipe {
	id: string
	name: string                      // "Overhead workbench"
	use: string                       // when to reach for this
	kind: "photo" | "texture" | "pattern" | "gradient" | "mark"
	lane: "raster" | "generator" | "iconset" | "authored"
	tags: string[]                    // the SHARED vocabulary — LIBRARY_TAGS
	aspects: string[]                 // the ratios this was composed for
	realise(input: RecipeInput): RecipeRequest  // a prompt, generator params, or a brief
	avoid: string[]                   // negative constraints: the documented slop tells
	pairsWith: { palettes: string[] } // ties output to the committed foundation
}
```

Sharing `LIBRARY_TAGS` with the foundation library is load-bearing, not tidiness: a project's
committed vibe tags narrow the asset recipes directly, with no second vocabulary to keep in
sync. Tag matching is exact, so the vocabulary is published and a query overlapping nothing is
refused — an unmatched query ranks every candidate zero and degenerates to declaration order,
which is indistinguishable from a real narrowing.

**Recipes read `foundation.json`.** `deep-technical` produces a dark, cool, low-key image;
`warm-earth` produces warm neutrals and no pure white. An asset that fights the palette is
worse than no asset. This is also the first point in the codebase where the foundation
*produces* rather than *describes*, which is the direction Phase 7 takes further. It binds
hardest in the generator lane, where palette tokens are literally the function's inputs.

### Four lanes, chosen by what the asset is

A single "generate an image" pipe is the wrong abstraction. What produces a good photograph,
a good gradient, a good icon set and a good logo have nothing in common, and only one of them
needs an API.

**1. Raster → Google Gemini image ("Nano Banana").** `gemini-2.5-flash-image` and
`gemini-3-pro-image`. Image *editing* and multi-reference composition are the capabilities that
matter: "match this palette" and "another asset in the same style" are edits, not fresh
generations.

**2. Decorative vector → code.** Seeded parametric generators, owned outright: grainy and mesh
gradients, grain/noise overlays, halftone and dither treatments, geometric patterns, organic
shapes, section dividers, wordmark treatments.

The argument is not primarily cost. A model emitting `d="M12.4 88.1c…"` produces something no
one can edit or verify — the agent cannot adjust it, the visual editor cannot address it, the
diff is meaningless, and a subtly wrong result can only be regenerated, not corrected. A
generator call is a parameter set: deterministic, re-runnable, diffable, and **tunable after
the fact**, which is the Phase 8 parameter model arriving early. Generate-and-pick also stops
costing money and latency — twelve variants is twelve integers.

**3. Icons → curated open sets, installed.** Lucide, Phosphor, Radix, Heroicons. An icon set's
value is internal consistency; asking a model for a gear, then a bell, then a user yields three
stroke weights and three corner treatments, which is the one property that made the set worth
having. Uses the §5.5 install path, so icons arrive as editable source and recolour to
foundation tokens.

**4. Logos and marks → backend-authored SVG in a render-compare loop.** Two different tasks
hide under "can a model draw vector": emitting paths from a text description alone, and
reproducing a reference. The second has a ground truth, so it converges — emit, render, look,
correct.

The loop is the product, not the first emission, and **Caret drives it on a §4.4 session**: the
model emits SVG, Caret renders it in isolation and screenshots it, then sends the screenshot
back into the same session as an image input beside the reference; the model corrects and
re-emits. Caret decides when to stop, not the model. Optionally seeded by a deterministic
raster trace, which yields messy but structurally correct paths to clean up rather than blank
coordinates. Backends whose adapter cannot pass image inputs cannot run this lane and must say
so rather than running the loop blind.

### The Gemini adapter

One adapter over the `@google/genai` SDK, two backends selected by config:

```ts
new GoogleGenAI({ apiKey })                              // shipped path
new GoogleGenAI({ vertexai: true, project, location })   // test-only, gcloud ADC
```

The Vertex backend exists so the project can be exercised against Vertex-only credits. It is
configured through env/prefs, never surfaced in the UI, and the only user-facing field is the
API key. The adapter normalises the model ids that differ between backends, and the SDK is
given Caret's proxy-aware `fetch` per the network rules.

### Transparency

From the model, not from a matting step: Gemini returns transparent PNG for icon-style prompts,
and lanes 2–4 have no background to remove. For a genuine photographic cutout, chroma-key
against a flat background Caret chose at generation time — deterministic, no model download, no
licence, and reliable precisely because the background is ours.

### Keys and the monetization boundary

**BYO API key, stored in the OS keychain, never written to `.caret/`.** This follows §11 rather
than deferring it: the local editor is free forever, hosted inference is the paid side.
Generation costs cents on the user's own key. A hosted "just make it" button is a Phase 12
revenue item and must not become a dependency of this phase — the same discipline as the
`CaretServices` refusal stub.

### Output handling

Generated results go through the §4.6 pipeline, so a generated asset is an asset like any
other: resized to the composed-for ratios, `webp`/`avif` emitted alongside, EXIF stripped,
indexed, taggable, `@`-referenceable. `origin` records model, recipe id, the answers given, the
resolved prompt, and cost. The library labels generated assets as generated and SynthID is left
intact — a tool arguing for honest output should not strip provenance from its own.

---

## 5. Track C — Parameter model → **Phases 7, 8 and 10**

> **Split by the 2026-08-01 reframe.** *Token binding* moves up to **Phase 7** (it is the
> mechanism that makes corrections persist). *Source-writes-runtime-verifies*, *list items* and
> the *index-once* rule are **Phase 8**. *Resize* is **Phase 10**. Nothing here is dropped.
> What is missing and matters most: **every parameter needs a name an agent can write as
> precisely as a hand can drag** — `bouncy` above the bezier, `aurora` above four stacked
> radials. See §0.5, Bridge 1.

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

**Sync translation (provisional — confirm in the Phase 7 design session):** once pages say
`bg-brand-500`, sync must decide what the app receives, because the app does not have Caret's
`@theme`. Default policy: map onto the app's own design system where an equivalent token
exists (the rules files give the agent the token table, so `brand-500` is meaningful), else
emit the generated `@theme` block into the app's entry CSS so the classes resolve. **Never
ship a class that resolves to nothing** — that is a sync correctness bug, and it is checkable
mechanically.

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

## 5.5 Component supply — the curated catalog (Phase 7.5)

**Decided 2026-08-01**, prompted by the user's own collection of these libraries — which is the
friction research producing a signal: the gap is partly supply, and supply for a code tool is
component libraries, not reference screenshots.

### Why this beats the Mobbin answer, for Caret specifically

Reference screens make an agent **reproduce** what it saw — it looks at pixels and writes its own
approximation, and the loss in that translation is exactly where slop re-enters. A component
library **transfers** the quality as code, in the medium `.caret/` is already written in. Zero
translation. Replit needed screens because it had no other channel; Caret's design layer *is*
React source, so the higher-fidelity channel is available and cheaper.

Bonus that lands directly on §0.5 Bridge 1: **a library with a good prop API is a pre-built
parameter namespace.** `<AsciiEffect variant="glitch" glitchIntensity={0.05}>` is already named
at the right altitude — speakable by a human, writable by an agent, renderable as panel sliders
by the Phase 8 Param model. Adopting such a library solves the naming problem for that domain
outright, instead of Caret designing `aurora` from scratch.

### The install path, not the read path

The obvious integration — have the agent read the library's docs site when it needs a component —
is the wrong one, and not only because those sites block bots. It makes generation depend on
third-party infrastructure Caret does not control: bot rules change, docs go JS-only, URLs move,
a library gets acquired. Any of those silently degrades output quality with no error.

These libraries already ship a machine interface that isn't the docs site: **the installer.**
Amicro's whole pitch is a single CLI command; that CLI reads a JSON registry endpoint. There is a
structural guarantee in that — **a library cannot bot-block its own install endpoint without
breaking its own product**, so the install path stays machine-accessible in a way a marketing
page never does. So: the agent installs, the source lands in the repo, and from then on it reads
local files forever with no network in the loop.

Discovery is then the only thing that ever touched a website, and it becomes a **local catalog
curated once** rather than a per-session crawl. Bot-blocking degrades from "blocks the feature"
to "made curation mildly annoying, once."

### Two axes, failing independently

| axis | test | fails when |
|---|---|---|
| **ingestible** | installs headlessly; public repo; readable licence | JS-only docs, no repo, no registry, unclear licence |
| **editable once installed** | source lands in `.caret/`; takes caret-ids; colours rebindable to `foundation.json` | opaque npm package, minified dist, styles locked in the bundle |

`npm install thinking-orbs` passes the first and fails the second: it installs perfectly and is
still a dead zone in the canvas — the user clicks it and the property panel has nothing. That is
the Param model's `writable: false` case applied to a whole subtree. A copy-in library behind an
aggressive marketing wall is the *better* candidate of the two. Rank on both axes, not on how
nice the website is.

### Two tiers

**Shipped catalog** (in Caret's bundle, versioned with the app) — the allowlist. Per entry:
name, what it's for, install command, pinned version, licence, repo, one-line *use when* per
component, and the axis verdicts. Curated by the user; see the gate below.

**Per-project `.caret/`** — what the agent actually installed for *this* project, with full
provenance (library, version, component, source URL, licence). Under git, reviewable in a PR,
travelling with the repo. This is what makes a component choice **persist** the same way every
other correction does — pick a loader once, and next session's agent uses that loader rather
than inventing a new one.

### On install

1. Run the library's own installer into `.caret/components/`.
2. **Rebind** hardcoded colours and type to `foundation.json` tokens where they match; leave
   genuinely bespoke values alone and record them as detached.
3. The Phase 6 watch-and-heal codemod fires automatically (it triggers on any `.caret/` write),
   so installed components get caret-ids and become visually editable with no extra machinery.
   This composition is why Phase 7.5 is cheap.
4. Record the provenance entry.

Opaque packages that can't be copied in are **wrapped**, not embedded: a `.caret/components/`
wrapper owns the props and token bindings, and the interior reports `writable: false` with a
reason. Honest degradation, never a silent grey-out — the same rule as everywhere else.

### Retrieval

The catalog **index** — names plus one-line *use when* — goes in the always-on rules files
(§4 B3). Full prop APIs are read on demand from installed source. The split matters: an agent
that must *choose* to consult a component catalog will not, and will hand-roll a spinner from
training data. That is the pull-only `get_guide` failure mode, and the index is cheap enough to
carry always.

### Restraint is the taste, and this is where it can go wrong

A library of premium micro-interactions is a **slop accelerant** applied indiscriminately.
"A bounce animation on every hover" is on the documented slop-tell list; the four reference
designs won by being totally restrained everywhere except one move. So the rules carry a
**budget — roughly one signature move per page** — and the Phase 7 acceptance checker flags
violations. Stated plainly: the catalog raises the floor on *element* quality and does nothing
for composition; without the budget it makes output worse, not better.

### Supply chain

An agent installing packages into a real repo is an attack path. Allowlist only, pinned
versions, explicit user consent the first time a library enters a project. No open search, no
arbitrary registry URLs.

### The curation gate

Claude surveys candidates and **verifies programmatic access by running it**, not by reading the
marketing page. The review artifact is a table — name, purpose, distribution shape, install
command, licence, repo, registry reachable, editable-once-installed, plus a **rendered
specimen**, because what is being judged is taste and not just mechanics. **The user picks what
ships.** Nothing enters the catalog otherwise: curation is the entire value, and an unreviewed
catalog is just averaging with extra steps.

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

## 7. Tracks E + Widgets — **DEFERRED behind Phase 11**

> **Deferred 2026-08-01**, not dropped. Snapping and smart guides, gradient stop editing,
> motion timelines and easing editors, 3D scene addressing and shader parameter exposure.
>
> **Why:** these are precision tools for people who already know what they want. A beautiful
> gradient editor does not help someone who cannot choose a gradient. Reviewed against four
> reference designs, none of them needed any of this — they needed an asset, a typeface and one
> compositional move (§0.5). Revisit only once the supply side (Phase 11) exists.
>
> **Resize is the exception and stays in scope** as Phase 10, because without some direct
> manipulation Caret is a chat box with a preview. Its full design is in §5.

Notes retained for whenever this is picked back up:

**Widgets' hard problems:** time addressing for a timeline (nothing on screen *is* the
animation — at any instant you see one frame); 3D scene addressing with raycast hit-testing
past the `<canvas>` boundary, where R3F components need the codemod to stamp stable ids the way
JSX elements get caret-ids, since a Three object has no HMR-stable identity otherwise.

**Verified 2026-07-31, worth not re-deriving:** `document.getAnimations()` exposes CSS
animations, CSS transitions and JS-driven animations alike, with durations, easings and
keyframes, and `currentTime` can be set to scrub. So freezing and stepping through an animation
needs no instrumentation. Unchecked: how much of Framer Motion routes through the browser's
animation engine versus its own JS loop — if a chunk is invisible, a timeline has holes.

**Gradients, measured 2026-07-30:** the browser rewrites gradient values on read (13 of 15 test
cases), converting hex and named colours to `rgb()`, expanding double-position stops so the stop
*count* changes, and evaluating `color-mix` down to a frozen value. So the file is the only
trustworthy representation. Also: a gradient value cannot be split on commas, because a colour
can contain them. A fill **stack** (Figma's fill list) matters far more than a good single-
gradient editor — measured that mesh-plus-grain is one element with five background layers and
zero child elements.

**Scope line if resumed:** for shaders and 3D the job is **parameter exposure, not authoring**.
You or the agent writes the GLSL; Caret surfaces uniforms as live sliders and the camera as a
gizmo. Not building a pen tool, vector illustration, raster painting or video compositing —
import, don't author.

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
| 7 locating rules (static/unique/missing ids, iterators, prop threading, own-line tags) | build-time codemod (lands in Phase 6 as watch-and-heal — see §4 B6) |
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
| Persistence is the differentiator, not precision | 2026-08-01 | Every AI design tool is one-shot — corrections evaporate each session. `.caret/` persists in the repo under git. Roadmap re-ordered around exploiting that |
| Foundational context always-on, never pull-only | 2026-08-01 | An agent that must choose to look up spacing and type will not, and fills the gap from training data. Corrects the earlier `get_guide` design |
| JSON for machines, prose for judgment | 2026-08-01 | ~80% token reduction and fewer hallucinations vs Markdown; `design_layer.ts` is currently all prose |
| Capture corrections into the design layer | 2026-08-01 | The direct fix for "next session it makes them again", and only possible because the design layer persists. Highest-value item in the plan |
| Generate-and-pick as a first-class interaction | 2026-08-01 | Pointing needs no design vocabulary, which suits a non-designer. Replit ships it as "Ambient Intelligence" — table stakes, not novelty |
| Supply (grounding/assets/type) deferred, not dropped | 2026-08-01 | Replit answered it by building in Mobbin's 600k screens. Caret has no equivalent and should not guess before the friction research lands |
| Snapping, gradients, motion, 3D deferred | 2026-08-01 | Precision tools for people who already know what they want. A gradient editor does not help someone who cannot choose a gradient |
| Phases run autonomously, gated on app-level testing | 2026-08-01 | Each phase ends by driving the real app in Playwright, then continues without checking in. Stop only when testing is impossible, or when a product-defining feature needs the user to build with it and rate it |
| Encoding policy inferred from the repo | 2026-07-30 | Explicit user mode > project convention > context default. Cold start seeds the convention, so defaults must be what you want propagated |
| Persona pinned: a developer who is not good at design | 2026-08-01 | Not a no-code end user. Onboarding may assume a dev; the design surface must never assume design vocabulary |
| Always-on context ships as repo rules files | 2026-08-01 | MCP cannot inject into a client's context. `AGENTS.md`/`CLAUDE.md`/`.cursor/rules` are auto-loaded by every mainstream agent and versioned with the design; tool results echo the JSON as backstop |
| Direct-write + watch-and-heal is the write model | 2026-08-01 | External agents bypass MCP write tools; chokidar-triggered codemod + validation makes reliability independent of agent cooperation. Codemod moves Phase 8 → 6 |
| Edit-provenance log lands in Phase 6 | 2026-08-01 | Correction capture needs history to mine; cheap now, impossible to retrofit |
| Acceptance bar is a deterministic checker Caret runs | 2026-08-01 | An agent that must choose to self-check will not — same failure mode as pull-only `get_guide`. Contrast, identical rows, border-count and missing states are all computable on the rendered page |
| Pre-sync snapshot re-implemented on plain git | 2026-08-01 | The checkpoint shadow-git dies with the task loop; "Undo sync" and unified undo must survive |
| `complete_sync` backed by hash detection + manual control | 2026-08-01 | Honor-system completion re-opens the V1 stuck-bookmark bug |
| Token wizard becomes an agent-led foundation interview | 2026-08-01 | Plain-language questions, curated options, the user points. Curation bounds the agent's taste, so the floor is high regardless of the connected agent — the supply-side v0 without waiting on Phase 11 |
| App chrome renderer + canvas `WebContentsView` | 2026-08-01 | "Load Vite directly" left onboarding/wizard/prefs with no host; the canvas still needs zero porting |
| MCP server: per-project port, token auth, Origin checks | 2026-08-01 | A fixed port collides with multi-window; an unauthenticated localhost write server is a DNS-rebinding hole |
| Component libraries are the supply answer for a code tool | 2026-08-01 | Reference screens make the agent *reproduce*; a library *transfers* quality as code in the medium `.caret/` already uses. Higher fidelity and cheaper than Mobbin-style grounding |
| Install path, never the read path | 2026-08-01 | Docs sites block bots, go JS-only and move; a library cannot bot-block its own install endpoint without breaking its own CLI. Install, then read local source forever |
| Two-axis library filter: ingestible + editable | 2026-08-01 | They fail independently — an opaque npm package installs cleanly and is still a dead zone in the canvas; a copy-in library behind a bot wall is the better candidate |
| Catalog ships with Caret; installs recorded per project | 2026-08-01 | Curation is global and user-reviewed; the per-project set is under git so a component choice persists like every other correction |
| One signature move per page, enforced | 2026-08-01 | A micro-interaction library is a slop accelerant otherwise — "bounce on every hover" is a documented slop tell, and the reference designs won on restraint |
| Height is in scope, axis-parameterised | 2026-07-29 | `width:auto` fills (resolves upward), `height:auto` hugs (resolves downward). Same element gives opposite verdicts, so the resolver takes an axis and the write policy differs per axis |
| Discard Canvas UI / html-in-canvas | 2026-07-28 | WICG early stage, flag-gated, no Firefox/Safari position; output wouldn't ship. WebGL overlays are the shippable technique |
| Assets are a design-layer primitive | 2026-08-02 | Type, colour and spacing describe how things look and say nothing about what is in them, so an agent emits a placeholder. Assets land before Phase 7: "make the correction stick" is empty while the correction is "that grey box should be my product shot" |
| `@tag` expands before it reaches the agent | 2026-08-02 | Sending the token and trusting a lookup is the pull-tool failure mode, and it fails silently — the agent invents an asset that fits the name |
| The asset description is stored, not derived | 2026-08-02 | Dimensions do not say "dark, wide, room top-left", which is the only fact deciding whether text can sit on it |
| Guided generation, never a prompt box | 2026-08-02 | A prompt box returns the taste problem to the person who does not have it. Same mechanism and same justification as the 6.5 interview |
| Four generation lanes, not one pipe | 2026-08-02 | Photographs, gradients, icon sets and logo marks share no production method. Only the raster lane needs an API, so three lanes work before any account exists |
| Decorative vector is code, not a model | 2026-08-02 | A 4KB path string is uneditable and unverifiable; a parameter set is diffable, correctable and tunable. Variants cost an integer instead of an API call |
| Icons come from curated sets, never generated | 2026-08-02 | A set's value is internal consistency, which one-shot generation destroys across stroke weight and corner treatment |
| Logos are authored in a render-compare loop | 2026-08-02 | Reproducing a reference converges because there is a ground truth; emitting paths blind does not. The loop is the product, and it needs `get_screenshot` |
| Gemini adapter: API key ships, Vertex is test-only | 2026-08-02 | One `@google/genai` SDK, two constructor configs. Vertex + gcloud ADC exists to exercise Vertex-only credits and is never surfaced in the UI |
| Recraft dropped | 2026-08-02 | No API free tier, and its app free tier is public-images/non-commercial. Lanes 2–4 cover what it was for |
| Refusals name the actual cause | 2026-08-02 | `get_screenshot` answered "is the canvas running?" for every failure including the ones where it was. The only consumer is an agent, and a causeless refusal is a dead end for it |
| MCP's scope is agent-initiated work only | 2026-08-03 | MCP is client-initiated; a server cannot start a conversation, and a long-polling `wait_for_work` tool fails the actual usage pattern — CLI agents return to a prompt after every turn, so nobody is ever waiting |
| Caret embeds a coding backend | 2026-08-03 | Sync, AI edit, overlay, interview and generate-and-pick all initiate in Caret's window. Amends "Caret stops owning the agent": Caret stops *requiring* a particular agent; it cannot stop *having* one |
| Backend is an adapter seam, four implementations | 2026-08-03 | `CodingBackend` in `backend.ts`; OpenCode reference + Claude, Codex, Kimi. Designs are multi-file code and sync writes the whole app — a general coding agent's job, so wrap existing SDKs rather than build a loop |
| OpenCode SDK is the reference backend, bundled and pinned | 2026-08-03 | MIT, richest documented surface, native `json_schema` output, session diff/fork/revert APIs. Bundled binary spawned from the app — never `PATH` — so what Caret executes is what Caret tested |
| GLM gets no adapter | 2026-08-03 | Z.ai ships no embeddable agent SDK (ZCode is an app); GLM's plan works through OpenCode's provider config, which Z.ai supports day-one |
| Caret's permission handler is the enforcement boundary | 2026-08-03 | Backend agent config is advisory: upstream issues show subagents inheriting none of plan-mode's `edit: deny`. `.caret/**` auto-approved (fixed); app writes denied in read-only sessions, per user toggle (default ask) in write sessions |
| One session per activity; diffs from Caret's git snapshot | 2026-08-03 | History reads as things the user did, not one thread; snapshot diffs are canonical and backend-independent, backend diff APIs are enrichment |
| Interview is a Caret-owned state machine | 2026-08-03 | Supersedes the agent-led mechanism, which nothing in the product could initiate. Model ranks curated candidates inside a schema whose `enum` is the ids — the anti-slop floor moved into the request. "None of these" is the user's override, never the model's |
| Owned backend gets context injected in the system prompt | 2026-08-03 | Rules files were the workaround for not owning the client; they remain for external agents only |
| Both auth paths for every backend, account login first | 2026-08-03 | Detect installed CLIs and their auth state before offering key entry; Claude's credit-pool billing disclosed at the point of choice; setup screen names routes, never prices |
| Caret-hosted inference is a provider block | 2026-08-03 | OpenAI-compatible `baseURL` config through the OpenCode adapter — monetization is configuration, not integration; §11 boundary unchanged |
| Direct `.caret/` edits are an anti-pattern | 2026-08-03 | Tolerated and healed, never recommended; once-per-session notice on the first external write. The visual editor and the backend are the supported paths |
| Sync keeps V1's plan→review→apply contract | 2026-08-03 | Plan phase in a read-only session, user reviews, apply switches to write; Caret advances the bookmark in its own code on apply — honor-system completion exists only on the external MCP path |
| Defer code signing | 2026-07-28 | Not build-blocking. SignPath free for OSS; Windows is not $500 |

### Still open

- Which of the four Gate items in Phase 6 are settled (licence, auth stub, service seam, local-forever commitment)
- Whether `cli/` is deleted or repurposed as a headless Caret client
- The curated foundation library contents (typeface pairings, palette recipes, presets) — a
  curation session with the user, before Phase 6.5 ships
- Which component libraries make the shipped catalog (§5.5) — Claude researches and proposes
  with specimens; the user decides. Candidates already noted from the user's collection:
  Amicro (micro-interactions/transitions, CLI install, open source), Componentry (effects incl.
  ASCII), HeroUI Pro (design systems), Collect UI (loaders), thinking-orbs (npm — likely fails
  the editability axis, useful as the wrapper test case)
- The sync-translation policy for bound tokens (§5) is provisional — confirm in the Phase 7
  design session

# Caret — Planning & Design Log

> **SUPERSEDED 2026-08-01 by [CARET-V2-PLAN.md](./CARET-V2-PLAN.md).** This is the V1 planning
> log, kept for history and for the reasoning behind the two-layer architecture, which still
> holds. Two things in here are now explicitly reversed:
>
> - **"Sync is one-way (design → app) for V1 … the design layer will go stale; this is
>   accepted."** No longer accepted. Drift is a correctness problem — a declared-vs-built gap
>   gets filled in by an agent confidently and wrongly. Reverse sync is Phase 9.
> - **Caret as a VS Code extension owning its own agent.** Caret is now a standalone Electron
>   app driven over MCP by whatever agent the user already runs.
>
> The Foundational Note below about scope (Caret's features are for the *user's* projects, not
> Caret's own UI) still stands.

Living document. The original spec (below) is a starting point; sections above it capture the evolving design.

---

## Foundational Notes

- **Scope of Caret's features:** Everything Caret provides (token config, design standardization, plan mode, overlay editor, etc.) is for **the projects users build with Caret** — not for Caret's own UI. When designing a feature, the "user" is a developer/designer/PM building their own product. Caret's own UI is just a coding harness; it does not need to dogfood its own design-system layer.

## Current Direction

### Two-layer architecture (supersedes V1's "one layer" thesis)

Caret splits the frontend work into two distinct layers that live in the same repo:

- **Design layer** — standardized to **React**, regardless of what framework the user's actual app uses. This is the *first layer of interaction*: designers/devs/PMs work here first to define page structure, components, and flow. Functions as "Figma frames + assets as code, version-controlled in parallel with the app."
- **Application layer** — the user's actual shipped app, in whatever framework they choose (Vue, Svelte, Angular, React, etc.). Caret stays unopinionated about this layer's architecture.

### Why two layers (rationale)

- Detecting "pages" reliably across N frontend frameworks is intractable; standardizing the design layer on React collapses that surface area.
- The user's actual app stays unopinionated — no forced architecture, no friction with their preferred meta-framework.
- The design layer's predictable structure unlocks richer features: page labels, navigable simulation of user flows, permission-tiered web platform access, etc.
- The "duplication" cost is real but bounded; the flexibility win is larger.

### Workflow shape

1. Plan mode produces designs in the React design layer.
2. Developer **syncs** design layer changes into the application layer (AI-assisted diff/patch).
3. PMs/designers edit the design layer via Caret's web platform under permission tiers; devs are notified and sync into the app.
4. Caret **facilitates** sync and surfaces drift; it does not enforce consistency. Same trust model as Figma → real app today — the PM verifies the live URL matches the design.

### Resolved follow-ups

- **Sync direction:** one-way (design → app) for V1. Revisit bidirectional later if usage data justifies the complexity.
- **Design layer location:** lives in `/.caret` at the repo root. Excluded from production builds, but **must** be tracked by version control (otherwise Caret's web platform can't read it).
- **Token config scope:** shared across both layers. Enforced directly in the design layer; indirectly enforced in the app layer because the app simply implements what the design specifies.
- **Design–implementation mode toggle:** even when one person plays both designer and engineer roles, the workflow is to hop into design mode for UI work and switch back to implementation mode to have the AI sync the design into the app code. The two-layer separation is a workflow boundary, not just an org-chart boundary.

### Branching model

- Design changes live on **feature branches**, not directly on main. Sync runs on the same branch, so design + app code changes land together in one PR.
- Main is always design ↔ code in sync (modulo the accepted drift caveat from earlier). Branches are where they're temporarily out of sync.
- Web platform abstracts git for non-devs: a PM sees "design draft for X feature," not "branch." Auto-creates branches behind the scenes (mirrors Figma's branching UX).
- Web platform defaults to showing **main** (the consistent shipped state) and lets users toggle into in-flight design branches.
- `.caret/sync-state.json` is per-branch. New branches inherit main's sync state; sync on a branch updates the file on the branch; merging into main advances main's sync state naturally.
- Caret surfaces stale "design branches awaiting sync" for visibility — soft signal, not a hard block.

### Sync mechanic — V1 design

- **Shape:** sync is a specialized plan-mode invocation. AI analyzes both layers, produces a plan covering UI translation **plus** any business-logic / state / routing / API / data-shape changes the design implies, dev reviews and accepts.
- **Change tracking:** git-based. A small `.caret/sync-state.json` file records `{ lastSyncedCommit: <hash> }`. Sync flow reads this, runs `git log .caret/ <hash>..HEAD` to find design changes since last sync, then feeds the diff plus full current state of both layers into the AI to build the plan. On successful sync, update the file to current HEAD and commit.
- **First-ever sync:** no state file yet → treat whole design layer as new.
- **Provider-agnostic:** git plumbing works on any host (GitHub, GitLab, Bitbucket, local-only). GitHub-specific integration (OAuth, webhooks, PR-aware notifications) lives one tier up in the **web platform**, not in the sync mechanic itself.
- **Plan scope vs diff:** AI uses the git diff for *intent* but analyzes full current state of both layers for the plan — a small design diff can imply large app changes (e.g., one new button → favorites store + persistence + route).
- **Trigger:** both manual ("sync now" command) and auto-prompt when Caret detects new commits to `.caret/` since the last sync.
- **Acceptance granularity:** whole plan only for V1. Add per-step acceptance later if users ask.
- **Infeasibility handling:** plan mode honestly surfaces when the design implies something the current architecture can't support without a refactor, instead of forcing a half-baked patch.

### Token config schema — V1 design

**Imperative tokens (V1 must-have):**

1. **Brand / aesthetic descriptor (prose).** Highest-leverage input. Short description shaping AI taste during generation (e.g., "clean dashboard SaaS, slightly playful, flat over skeuomorphic").
2. **Color.** Brand + neutral scale + semantic (success/warning/error/info). Light/dark mode is V2 unless user opts in.
3. **Typography.** Font family + size scale. Weights default sensibly.
4. **Spacing scale.** Base unit (4px or 8px) + scale steps.
5. **Radius scale.** ~5 steps. Defines feel disproportionately.

**Lower priority but in core schema:** component density, motion opt-in.

**Defer / auto-derive:** elevation (derive from vibe + density), icon library (sensible default), per-component tokens (V2 — designed for retrieval from day one).

**Wizard UX (capture flow):** hybrid — hardcoded outer flow with AI assistance for branching and smart defaults (e.g., "modern e-commerce → here are 3 starter palettes"). Reuse the existing onboarding pattern (`webview-ui/src/components/onboarding/`); generalize it into a reusable `Wizard` component if scope allows, otherwise copy-paste.

**Wizard widget design — unifying principle:** *pick the character, auto-generate the scale, allow override.* Don't make users type 11 color shades or 10 spacing values; make them pick 1-2 high-level decisions and surface the generated scale for tweaking.

**Per-token widget shapes:**

- **Vibe descriptor** — free text + tag chips (`modern`, `playful`, `dense`, `editorial`, `enterprise`, etc.) + optional reference-app picker for inspiration. Tags + references give the AI structured signal; free text adds nuance.
- **Color** — brand color picker + neutral character selector (`warm / cool / true / slight tint`) that auto-generates the 11-step neutral scale + semantic defaults shown as preview with per-step override.
- **Typography** — searchable Google Fonts picker + system-font fallback + custom-upload (advanced). Scale picked by ratio (`1.125 minor third`, `1.25 major third`, etc.) with live multi-size preview.
- **Spacing** — base unit toggle (4px / 8px) + scale preview, defaults to a Tailwind-like progression with optional per-step edits.
- **Radius** — character slider (`sharp → soft → round → pill`) with live component preview, auto-generates the 5-step scale.

**Across all widgets:** always show a live preview of representative components (button, card, input, body text) updating in real time. The preview *is* the validation.

**Implementation notes:** shadcn/Radix primitives in `webview-ui/` cover most of these (slider, select, popover, tabs). Custom widgets to build: color-with-auto-scale, Google-Fonts picker, live preview surface. Rest is composition.

**Format & retrieval:**

- **JSON, split by namespace into separate files** under `.caret/tokens/`. Filesystem-as-namespace.
- **Foundation tokens always injected:** `.caret/tokens/foundation.json` (vibe, color, typography, spacing, radius, density). ~5K-token tax accepted.
- **Component-level tokens retrieved on demand:** `.caret/tokens/components/button.json`, `card.json`, `input.json`, etc. Loaded only when generating that component.
- **Stable namespaced identifiers** (`color.brand.500`, `component.button.primary.bg`) make retrieval queryable.
- V1 implementation can full-inject everything; the file split is the retrieval boundary, so upgrading to retrieval later requires no schema rewrite.
- Build-time translators emit downstream formats (Tailwind config, CSS variables, Style Dictionary) from the JSON source of truth.

### `.caret/` directory structure

**Layout:**

```
.caret/
├── tokens/
│   ├── foundation.json
│   └── components/...
├── pages/
│   ├── checkout-cart/
│   │   ├── index.tsx          # React component
│   │   └── meta.json          # id, title, type, states, tags
│   ├── checkout-payment/
│   └── checkout-confirmation/
├── flows/
│   ├── checkout.flow.json     # ordered graph referencing page IDs
│   └── onboarding.flow.json
├── components/                 # shared design components (Button, Card, etc.)
├── layouts/                    # shared layouts (auth shell, dashboard shell)
├── assets/                     # images, icons
├── thumbnails/                 # cached page screenshots for canvas rendering
└── sync-state.json
```

**Two-tier model: pages + flows.** Mirrors Figma's frames + prototype mode.

- **Pages** are self-contained React components with co-located `meta.json` (id, title, type, states, tags). Each page is a route-equivalent in Caret's rendering shell.
- **Flows** are explicit graph definitions in `.caret/flows/*.flow.json`, referencing pages by ID and declaring the path through them. A page can appear in multiple flows. Restructuring a flow is a one-file edit on the flow definition; pages don't move, the graph changes.

**Per-page `meta.json` example:**

```json
{
  "id": "checkout-payment",
  "title": "Payment Details",
  "type": "form",
  "states": ["empty", "filled", "error", "loading", "success"],
  "tags": ["checkout", "payment"]
}
```

**Per-flow file example:**

```json
{
  "id": "checkout",
  "name": "Checkout",
  "steps": [
    { "page": "checkout-cart", "next": ["checkout-payment"] },
    { "page": "checkout-payment", "next": ["checkout-confirmation"], "onError": ["checkout-payment"] },
    { "page": "checkout-confirmation", "next": [] }
  ]
}
```

**JSX navigation vs flow graph — two views on overlapping info:**

- **JSX navigation** is the runtime — `<Link>`, `router.push`, etc. Includes everything (happy path, back buttons, sidebar nav, escape hatches, edge cases). This is what makes the preview clickable.
- **Flow graph** is the curated narrative — the canonical journey through a user task. Powers the flow editor, simulation, and visualizations. Stays clean because it's about *narrative*, not exhaustive navigation. A page can have JSX `<Link>` to somewhere outside its flow without polluting the graph.

**Flow restructuring workflow:**

1. Dev/designer drags a page in the flow editor.
2. Caret updates `flows/<flow>.flow.json` (cheap, one-file edit).
3. Caret prompts via AI: "I changed the flow; want me to update navigation in `Cart.tsx` and `Payment.tsx` to match?"
4. AI generates the JSX-side patch; dev reviews and accepts.

Same plan-based pattern as design→app sync, smaller scope. Flow graph and JSX stay in loose sync via AI assist, not via parsing.

**States are interactive modes, not separate page artifacts.** Caret deviates from Figma's snapshot model here — interactive code lets us do better.

- States are **modes the page can render in** (empty / filled / error / loading / success / etc.), driven by prop, route param, URL query, or dev-tool override.
- The web platform exposes a **state selector** in the preview (dropdown / URL param) so a designer/PM can jump to "error state" without having to trigger it manually. In design mode it's an inspection tool; in dev mode a debug aid.
- The `states` array in `meta.json` is the contract: tells the AI what variants need to exist during generation, tells the web platform what to populate the selector with, tells the dev/designer what's available.

**Caret provides the rendering shell.** Pages are plain React components; routing comes from the directory structure interpreted by Caret's own preview/render layer. No Next.js / Remix / TanStack Router — the design layer's "framework" is Caret itself. Keeps the structure predictable enough to power flow-editor and simulation features.

### Plan mode for design work

**No distinct "deep plan mode." Reuse Cline's existing plan/act toggle applied to design context.**

- **Act mode = quick path.** Multimodal input → AI generates a draft React page (or pages) directly into `.caret/pages/` → iterate visually via canvas overlay editor + component editor + chat. Default for single-page work and refinements.
- **Plan mode = considered path.** Same toggle Cline already has. Especially valuable for multi-page generation: AI proposes a plan (page list + shared components to hoist + flow structure) for review before committing to 10 pages of code.

The plan/act toggle is general; nothing about the multi-page case requires new modes. UI generation's cost calculus (fast regen, self-evident output) means most work runs in act mode. Plan mode earns its keep when the task is large enough that "review before generating" beats "generate and revert."

**Multi-page consistency comes from infrastructure + generator behavior, not a separate workflow:**

| Consistency dimension | Mechanism |
|---|---|
| Visual (color, type, spacing, radius) | Foundation tokens (always injected) |
| Components (Button, Card, forms) | `.caret/components/` — AI references shared components across pages |
| Layouts (auth shell, dashboard shell) | `.caret/layouts/` |
| Voice / tone | Vibe descriptor in foundation tokens |
| Navigation | `.caret/flows/` + JSX nav |
| State patterns (error / empty / loading) | Shared components |

**Generator behavior requirement: AI must hoist shared patterns into `.caret/components/` before building pages.** Otherwise page 1's inline `Button` and page 2's inline `Button` drift apart and we lose consistency. This is a behavior of the generation strategy, not a separate UI mode.

**Multimodal inputs (any mode):**

- Text descriptions
- Reference URLs / app names ("like the Linear inbox")
- Screenshots / images dragged in
- Hand-drawn sketches (paste image or draw rough in a minimal built-in canvas)
- Voice input
- Project-page-as-template ("like our existing Settings page but for Billing")

Sketching is **one input mode among many**, not the centerpiece.

**Bidirectional sketching is ditched.** Reasons:

1. Bidirectional brainstorming is preserved by conversation — canvas isn't the only bidirectional medium.
2. AI rendering React is strictly higher fidelity than AI sketching.
3. Disambiguation is cheaper via text confirmation + fast regen than via shared sketch.
4. The strongest steelman case (multi-page flow diagramming) is already covered by explicit `flows/*.flow.json` + AI editing the flow file.
5. tldraw licensing + bidirectional protocol complexity is significant cost for marginal benefit.

**tldraw is deferred.** A minimal custom canvas (HTML5 canvas, basic brush + paste-image) suffices for sketches-as-one-input. Revisit tldraw only if multi-page spatial flow diagramming becomes a clear V1 feature *and* its specific strengths (infinite canvas, shape relationships) justify the license cost.

**AI's response to ambiguity is always real rendered UI, not a sketch.** When AI proposes layout options, it generates 1-3 actual React variants, not wireframes.

### Design layer technology

**React stays.** Preact eliminated (shadcn/Radix compat broken, React 19 closed bundle gap). Plain HTML/CSS/JS eliminated (lower ceiling for complex designs, loses component model). React + hybrid canvas is the right balance.

**Why React wins for the design layer:**
- shadcn/ui, Framer Motion, and the full React ecosystem enable complex, impressive designs — the design layer is where users want high-fidelity output
- AI generates React better than any other framework (most training data)
- React Grab (Aiden Bai) provides Fiber-based element selection → exact source mapping, extensible via plugin system
- React 19 bundle size (~10KB gzipped client-only) is acceptable

**Hybrid canvas rendering:**

The canvas displays all pages (Figma-style overview) with only the focused page running live React. All other pages are **cached screenshot thumbnails**.

- **Focused page:** live React, fully interactive, editable via visual editor.
- **All other pages:** static screenshot images (`<img>` tags). Zero React overhead.
- **Click a thumbnail** → mount React for that page (live), unmount + screenshot the previously focused page.

**Screenshot capture pipeline — no batch rendering, no spikes:**

Screenshots are captured as a **byproduct of normal workflow**, never in batch:
- AI generates a page → page is already rendered → screenshot captured as side effect → cached to `.caret/thumbnails/<page-id>.png`
- User focuses a page to edit → user navigates away → screenshot on unfocus → cache updated
- Tokens change globally → background worker re-renders pages **one at a time** in a hidden off-screen iframe → max spike: one React app at a time
- Canvas opens → loads cached images from disk → zero React rendering needed
- Pages never rendered yet → placeholder (title + color from `meta.json`)

Screenshots captured at full resolution; zooming into the canvas is crisp up to 1:1. Beyond that, clicking focuses the page and mounts live React.

**Visual editing — forked React Grab + layered editing UX:**

**React Grab** (MIT, ~7.1k stars, by Aiden Bai) is a context extraction tool, not a visual editor. It taps into React's Fiber tree to map any hovered DOM element back to its exact source file, line number, component name, component stack trace, and HTML source. Caret forks React Grab and extends it into a full editing experience.

**Three-tier editing UX:**

1. **Simple edits (instant, no AI round-trip).** For text, colors, and images — the most common micro-edits. React Grab's Fiber access provides the exact source location to write changes back to.
   - **Text:** double-click text element → inline contentEditable → type new text → writes back to source file at the exact line.
   - **Color:** select element → color picker shows current value → pick new color → writes back.
   - **Images:** select image → file picker / drag-drop to swap → writes back.
   - These feel instant. No reason to wait for an AI response to change "Submit" to "Continue."

2. **Complex edits (AI-assisted).** For structural changes, layout rework, animations, adding new components, etc. Floating text/voice affordance appears at cursor on element selection → user describes the change → Caret's AI receives React Grab's rich context (component name, props, tree position, source file + line, token config) directly via the plugin system's `transformAgentContext` hook (not clipboard) → AI modifies source code → change renders live via Vite HMR.

3. **Edge cases (canvas overlay fallback).** For elements React Grab can't select (portals, dynamically rendered elements, deeply nested structures). User paints/highlights a region → AI receives screenshot with mask → locates corresponding code. Safety net, not the default.

**React Grab fork modifications:**
- Wire context output directly into Caret's AI pipeline (bypass clipboard, use plugin hooks)
- Add inline editing layer for text, color, image properties (direct source write-back)
- Add floating text/voice affordance UI for complex AI-assisted edits
- Extend selection UX to integrate with Caret's web platform chrome (state selector, viewport toggle, etc.)

**Web platform architecture:**

- **One codebase, two deployment targets.** The web platform contains the rendering shell, canvas, visual editors, and design editing UX.
- **In VS Code:** rendered as a webview for design mode. Reads/writes `.caret/` from local filesystem. Git operations happen locally.
- **Self-hosted:** same web platform deployed as a web server. Connects to remote repo (GitHub API or server-side clone). Multiple users access via browser. Dev sets up once for the team.
- **Collaboration is git in both cases.** No feature restrictions between IDE and self-hosted — both produce git commits on branches. The IDE version can sync org-wide too.
- **Cloud version deferred.** Self-hosted for V1; cloud when Caret has traction.

**Rendering engine:** Vite dev server. Each `.caret/pages/*/index.tsx` becomes a route. HMR for near-instant edit feedback.

### Canvas views and simulation

**Default canvas view:** page thumbnails arranged in a grid or user-positioned layout. Clean and scannable — no flow arrows, no visual noise. Can be organized by tags, flow grouping, or manually drag-positioned by the user. Base canvas is a zoomable/pannable container with positioned thumbnail images.

**Flow view (user-toggled):** same canvas, but flow connection arrows overlay on top, drawn from `flows/*.flow.json` data. Color-coded per flow when multiple flows exist (e.g., checkout = blue, onboarding = green). Edges are interactive: drag to restructure → updates `.flow.json` → AI prompts to update JSX navigation to match. React Flow (or similar graph library) mounts as an overlay layer only when flow view is active — it is not the canvas foundation.

**Simulation mode ("run as app"):** hides canvas/editor chrome, shows a single page in a device frame, navigation works between pages via JSX links. User clicks through the app as a real user would. States are interactive (forms fill, buttons respond, modals open).

- **Viewport presets:** desktop (1440px, 1280px), tablet (768px), mobile (390px, 375px). Implemented by resizing the rendering iframe/container — CSS media queries in design components respond naturally.
- **Desktop ↔ mobile toggle** persistent in the toolbar, available in both canvas view (thumbnails render at that viewport) and simulation mode.
- **Device frame overlay (optional, not V1-critical):** cosmetic iPhone/Android/iPad frame around the viewport.
- **Implication: pages should be responsive by default.** AI generates responsive designs; token config could include breakpoint definitions. User can also explicitly design mobile-specific variants.

### Web platform permissions — V1 design

The two-layer architecture simplifies this significantly. Since `.caret/` is decoupled from app code, editing designs can't break the application. Safety comes from **git, not permissions**: changes land on branches, go through PRs, full audit trail via version control.

- **Edit (default).** Anyone with web platform access can modify anything in `.caret/` — pages, flows, tokens, components, layouts, assets. No granularity needed at the file/directory level for V1.
- **Read-only (opt-in).** Admin restricts specific members when desired. View the design, browse flows, inspect pages — but can't commit changes.
- **No "style-edit-only" tier for V1.** The V1 spec's tiered access (style-edit vs view-only vs full code) was designed for a world where design edits could touch app code. That risk no longer exists.

**Supersedes:** V1 spec's PM/dev access boundary concern, which was flagged as a medium risk requiring "explicit architectural definition." The two-layer split resolves it architecturally.

### Voice input

BYOK model — user provides their own speech-to-text API key (Whisper API, Deepgram, or similar) in Caret settings. Voice transcribes to text, text feeds into the same pipeline as typed input. No special voice-specific handling beyond transcription. Available in both the floating edit affordance (visual editing) and the chat/plan mode input.

### Self-hosted web platform deployment

- Connects to the repo via **GitHub API** (V1 is GitHub-only).
- Distributed via **Docker** (proper web app requiring configuration: custom host URL, public or private network access). npm distribution also viable if Docker is overkill for some users.
- Requires standard web app setup: GitHub OAuth for auth, environment config for repo connection, host URL.

### Monetization (deferred)

Not a concern for V1. If the project gains traction post-launch, potential revenue paths:
- Paid LLM inference APIs (so users aren't stuck with BYOK)
- Cloud-hosted web platform (removes self-hosting hassle)

### Still open

- React-app special case: do we offer any "promote/share component" optimization when the user's app is also React, or treat it the same as any other framework? (Defer — not V1.)
- How exactly we capture "vibe" in the wizard — freeform text, controlled picker, reference-app examples, or a mix.
- Token consumption format in the design layer (CSS variables? Tailwind? Direct JS import?) — implementation detail for the token system phase.

## Decisions Log

Moved to [CARET-DECISIONS.md](./CARET-DECISIONS.md) to keep this file readable. New decisions append there.

## Open Questions

_Track unresolved design questions here. Move to Decisions Log once resolved._

## Next Steps

Build phases with checklists: [CARET-PHASES.md](./CARET-PHASES.md)

---

## Original Spec V1 (reference — will diverge)

> Preserved verbatim from the initial product spec. Treat as starting context, not source of truth.

### Problem

The design → Figma → code pipeline is a double-translation problem. AI now collapses prototyping and implementation into one step, making a separate design canvas redundant. Existing AI coding tools generate UI but have no standardization layer, producing visually inconsistent output that drifts across a project. No tool has merged these concerns into a single coherent harness.

### Target Users — V1

- Solo developers / indie hackers
- Early-stage startup teams (2–5 people)
- No dedicated designer on team
- Any frontend framework

### Core Thesis

Design and frontend implementation should be one layer, not two. The view layer — kept architecturally separate from business logic and API consumption — serves as both the design artifact and the shipped code. A persistent design token config, injected into the AI's context selectively, replaces the design system role Figma partially played. The caret is the point where input becomes output — where design intent becomes running code.

### Full Workflow

1. **Design config setup** — Developer defines token config once per project: typography scale, color semantics, spacing, component conventions. Stored as a structured file in the repo. This is the standardization layer. Relevant token subsets are injected per generation context to avoid bloating the context window.
2. **Design-aware plan mode** — Developer or PM opens plan mode, built on top of Cline's plan mode and extended for design work. Freehand sketch canvas (tldraw) plus AI conversation to define page structure, navigation, and key interactions. AI reads sketches via vision. Output is planning intent, not a deliverable.
3. **AI code generation** — AI generates frontend component code grounded to the token config. The view layer is architecturally enforced as separate from API consumption and business logic from the start.
4. **Visual editing + finishing** — Developer or PM selects components on the rendered UI and sends edit requests via text or voice. Two editor modes available depending on context and framework.
5. **Collaborative review** — Rendered UI is accessible on a platform with tiered access. PM and client get style-edit or view-only mode. Developer has full code access. The view/logic boundary is enforced at the architecture level, not by convention.

### Visual Editor Modes

**Component editor — React only**
Fork of Aiden Bai's open source React visual editor. Component-tree aware, deep structural edits, precise selection of React elements. Extended with voice input mode — developer speaks edit requests directly to the AI agent. Power mode for React projects.

**Canvas overlay editor — Framework agnostic**
A transparent canvas overlaid on the rendered UI. Developer uses a paintbrush tool to highlight any region of the UI, then sends an edit request via text or voice. The AI receives a screenshot with the highlighted region as a mask and locates the corresponding code via codebase context from the harness. Works on any framework and any deployed URL. Default editor for V1.

### Architecture Constraints

- View / logic hard separation
- Token config as segmented context injection
- Multimodal AI required (vision)
- Canvas overlay editor is framework agnostic
- Component editor is React power mode

### Open Source Foundations

| Component | Details |
|---|---|
| Coding harness | Fork of Cline — extended with design-aware plan mode, token context injection, and overlay editor integration |
| Component editor | Fork of Aiden Bai's React visual editor — extended with voice input and AI edit mode |
| Canvas overlay editor | Built from scratch — transparent canvas div, paintbrush selection, screenshot capture, POST to AI with image + highlighted region mask. Small build surface, leverages AI vision. |
| Wireframing canvas | tldraw SDK — AI agent starter kit used for bidirectional plan mode. Commercial license required for production; 100-day free trial covers V1 development. |

### Risks

- **High** — Token config design is underspecified. This is the core differentiator and needs the most design work before any code is written.
- **High** — Integration debt across three forked projects with independent roadmaps. Define clear ownership boundaries and minimise surface area touched in each fork.
- **Medium** — Canvas overlay editor depends on AI accurately locating code from a visual region. Requires codebase context from the harness. Failure modes increase in unfamiliar or poorly structured codebases.
- **Medium** — tldraw commercial license cost needs to be factored into unit economics before V1 ships to production users.
- **Medium** — PM / dev access boundary is blurry at the component level. Needs an explicit architectural definition before the collaboration platform is built.

### Open Questions Before Build

- Token config format + schema
- Exact view / logic boundary definition
- PM access model at component level
- Monetisation model
- tldraw licensing cost vs alternatives

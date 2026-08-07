# Caret — Backlog

Deferred issues and tech debt that are non-blocking (a fallback covers them) but worth fixing later.

---

## Design layer re-dirtied after the completion auto-commit (precompute + dep-lock churn)

**Status:** deferred · **Severity:** cosmetic (sync correctness unaffected)

**Symptom:** A design task completes and auto-commits the `.caret/` layer, but clicking **Sync** afterward still reports "uncommitted design changes."

**Root cause (confirmed in `test-frontend/test1`):** `onDesignTaskCompleted` commits correctly — `design: auto-checkpoint` commits exist — but `.caret/` is re-dirtied *after* the commit by Caret itself:
- The precompute hook (`precomputeAndApply` → `precomputePage`, AST-based) runs **on page focus** (only call site: `src/core/design/rendering-shell/preview-panel.ts`, the `page-focused` handler) and injects `data-caret-id="…"` attributes into page source when you browse the canvas. The git diff showed exactly this (`+ <span data-caret-id="span-1" …>`) plus whitespace re-serialization.
- One-time `.caret/package.json` / `package-lock.json` churn from dependency installs (e.g. framer-motion) by the rendering shell.

**Why deferred:** the commit fallbacks make it non-blocking —
- the sync preflight detects uncommitted `.caret/` and offers a one-click, `.caret/`-scoped commit before syncing;
- manual commit always works.

So sync is never at risk; the only downside is an occasional "uncommitted changes" popup for Caret's own instrumentation noise.

**Proposed fix (when picked up):**
- At completion, precompute **only the changed/uncommitted** `.caret/pages/**/*.tsx` (not every page — it's the same idempotent precompute that would run on first focus, just batched into the commit), so the committed snapshot already has caret-ids and later browsing is a no-op.
  - `getUncommittedDesignPageFiles(cwd)` in `src/utils/git.ts` (`git status --porcelain -uall -- .caret/pages/`).
  - `precomputeFiles(paths)` in `src/core/design/visual-editing/post-generation-hook.ts` (reuse `precomputeAndApply`).
  - Call from `onDesignTaskCompleted` (`src/core/design/sync/sync-completion.ts`) before `commitDesignLayer`.
- Secondary: add `package-lock.json` to the design-layer `.gitignore` (`CARET_GITIGNORE` in `src/core/design/scaffold.ts`) to stop lock churn.

---

## Generated photographs are not emitted as AVIF

**Status:** deferred · **Severity:** none today · **From:** Phase 6.7

**Symptom:** §4.7 asks for `webp`/`avif` emitted alongside a generated photograph. WebP ships; AVIF does not.

**Why:** Chromium **decodes** AVIF and does not **encode** it — `canvas.toDataURL("image/avif")` returns a PNG data URL — and `nativeImage` has no AVIF path either. Encoding it needs a native module (`sharp`, or libavif directly), which means an ABI rebuild per Electron version on every platform Caret ships to.

**Why deferred rather than done:** WebP is supported by every browser Caret's users target, and the saving that mattered is already taken — 1466KB of PNG became 108KB of WebP in a real run, a 13× reduction. AVIF would improve on that by perhaps a further 20%, for a native dependency in the build. That is the wrong trade while the file is already small.

**When picked up:** the seam is `postProcessPhotograph` in `desktop/main/image-post.ts`, which already isolates crop → resize → encode. Only the encode step changes, and the fallback chain (WebP → JPEG) is the pattern to extend.

---

## 3D assets (`glb`/`gltf`) have no still image

**Status:** deferred, deliberately · **Severity:** cosmetic in the library, real for agents · **From:** Phase 6.6

**Symptom:** a `.glb` shows the text badge `3D` in the asset library, the `@` picker and the chat composer, where a video shows a real frame. `get_asset` hands an agent the model's metadata and a sentence, never a look at it.

**Why the other kinds work:** raster and vector are their own thumbnail, and video costs nothing extra — the browser already decoded a frame to display the row, so the poster is captured from the element that was going to render anyway (`desktop/renderer/src/views/AssetsView.tsx`) and stored as a derived file in `.caret/assets/.posters/`.

**Why 3D doesn't:** nothing in the chrome can rasterise a glTF scene. It needs a WebGL renderer (three.js + a loader, ~1MB), plus decisions a video frame never forces — camera placement, framing, lighting, and a background that suits both light and dark rows. That is a rendering feature wearing a thumbnail's clothes.

**Why deferred rather than dropped:** 3D is a first-class asset on every other term (stored, tagged, served, `@`-referenceable, synced), so only the preview is missing. Revisit **after Phase 6.7's generation lanes land** — if a lane ever produces or edits 3D, the renderer stops being a 1MB dependency bought for a 112×80 thumbnail and becomes shared infrastructure. Picking it up before then is paying full price for the smallest possible benefit.

**When picked up:** reuse the poster pipeline as-is (`setPoster` in `src/core/design/assets/store.ts`, `assets:setPoster` in `desktop/main/ipc.ts`, PNG data-URL only) — it was written kind-agnostic for this. Only the capture step is new.

---

## The inline-edit fallback card's `@` picker has no verify scenario

**Status:** untested surface · **Severity:** unknown — the code path is shared, the wiring is not · **From:** Phase 6.6

**Symptom:** none observed. This is a gap in certification, not a known bug.

**What is covered:** `verify:app` drives the picker by **clicking** in the two boxes that ship it — `be` (the canvas AI-edit box, in a real `WebContentsView` with the page in a child frame) and `bf` (the chat composer). `verify:design-shell` `r`/`s` cover the shell in a browser.

**What is not:** the third attach site, `showAiEditFallback` in `src/core/design/rendering-shell/canvas-template.ts`. It appears only *after an inline edit has already failed*, and no scenario in either suite provokes a failing inline edit, so nothing has ever clicked an asset in that card.

**Why this matters more than it looks:** every defect the user found in this feature was an interaction with the surrounding surface, not a bug in the picker — inherited `pointer-events: none` from react-grab's body, react-grab reading an outside press as a dismissal, and an element replaced between mousedown and mouseup. All three were invisible to keyboard selection and to unit tests. A shared implementation is therefore *not* evidence that a third host behaves; it is exactly the assumption that let those three ship.

**When picked up:** the hard part is provoking the fallback deterministically. Cheapest route is a test-only hook that forces the inline editor to report failure for one edit, then reuse `be`'s click-through assertions verbatim.

---

## Sync does not record asset copies in the mapping

**Status:** deferred, gated · **Severity:** none today · **From:** Phase 6.6, lands with Phase 9

**Symptom:** sync copies every referenced asset into the app's own public directory and rewrites the path (never a hotlink to `/caret-assets/`), but nothing records that a copy happened, so Phase 9 cannot tell that an asset drifted from its design-layer original.

**Why deferred:** the record belongs in the Phase 9 sync manifest, which does not exist yet. Writing a second, private ledger now would guarantee two sources of truth to reconcile later.

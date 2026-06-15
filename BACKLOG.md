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

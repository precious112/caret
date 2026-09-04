# Caret Rebrand — Outstanding Items

Tracking surface that was intentionally left unchanged in the initial Cline → Caret rebrand pass. Search for `TODO(caret-rebrand)` to find inline markers.

## Identity (kept as-is per current decision)
- `package.json` `author.name` and `cli/package.json` `author.name`: `"Cline Bot Inc."` — change once company identity is decided.
- `package.json` `publisher`: `"saoudrizwan"` — VS Marketplace publisher; not relevant if we ship via forked VS Code instead of the Marketplace.

## URLs (no Caret domain yet)
All deferred until a Caret domain exists. Replace these strings once the domain is registered:
- `https://cline.bot` (homepage, ToS, privacy links) — referenced in `package.json`, `cli/package.json`, and ~49 webview/src files.
- `https://docs.cline.bot` — documentation links across README/docs.
- `https://app.cline.bot` — account/billing portal links.
- `https://github.com/cline/cline` (and `/issues`) — bug/repo links in `package.json`, `cli/package.json`, man page, READMEs.
- Google Cloud Storage image URLs (`storage.googleapis.com/cline_public_images/...`) in walkthrough markdown — host owned by Cline; replace once Caret has its own asset host.

## Telemetry
- DONE — Cline's telemetry stack was deleted with the extension host; Caret has its own PostHog-based analytics (`desktop/main/analytics.ts`, contract in `docs/telemetry.md`). The one open item: paste the PostHog EU project key into `POSTHOG_KEY` in `desktop/main/analytics.ts` before release.

## Brand assets that still show Cline visuals
- `assets/icons/cline-bot.woff` / `.ttf` / `.svg` — custom icon font used as `$(caret-icon)` in `package.json`. The icon registration key was renamed but the underlying font glyph is still the Cline robot. Regenerate the font from the Caret SVG (icomoon/fontello) when convenient.
- `assets/icons/sleepy-cline.svg` — original sleepy Cline asset, no longer referenced after Logo component rewrite. Safe to delete.
- `assets/icons/robot_panel_dark.png` / `robot_panel_light.png` — referenced in `docs/docs.json` (docs site, not extension). Replace when docs get rebranded.
- `webview-ui/src/assets/cline_kanban_demo.{mp4,webm}` — onboarding/marketing video. Re-record or replace when available.

## Decisions to revisit
- **`.clinerules` user-facing feature** — the extension reads `.clinerules` files in users' workspaces as project-specific instructions. Renaming the convention to `.caretrules` is a 53-file change (code + docs) AND a breaking change for any user with existing `.clinerules` files. The project-local Claude Code instructions dir was renamed (`.clinerules/` → `.caretrules/`) but the runtime feature was not. Decide whether to rename the feature when planning the Caret-specific docs/UX work.
- **Translated docs** in `locales/zh-tw`, `zh-cn`, `es`, `de`, `ar-sa`, `ja`, `ko`, `pt-BR` — left untouched. Will need full retranslation rather than string-swap when we redo product docs.
- **Internal code identifiers** (`ClineMessage`, `ClineApiProvider`, `ClineSay` enum, `CLINE_ACTIVE` env var, `clineApiKey` storage key prefix, etc.) — explicitly skipped. These are invisible to users; renaming them creates upstream merge friction without user-visible benefit.
- **English contributor docs**: `cli/DEVELOPMENT.md` (~37 refs), root `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` — left untouched in this pass to avoid noisy diff churn. Sweep separately when we own the documentation narrative.

## What was renamed
- `package.json` and `cli/package.json` metadata: `displayName`, `description`, `keywords`, walkthrough copy, command titles/categories, contribution IDs, view container/view IDs, configuration title, comment-controller ID, icon registration key, CLI binary name, man page filename.
- VS Code command IDs (43): `cline.* → caret.*` across code (`src/extension.ts`, `src/dev/commands/tasks.ts`, `src/services/test/TestMode.ts`, `src/hosts/vscode/...`, `src/test/extension.test.ts`).
- Comment controller ID `cline-ai-review → caret-ai-review`.
- Icon font registration key `cline-icon → caret-icon`.
- Webview logo components: `ClineLogo*.tsx` (6 files) → `CaretLogo*.tsx` with new caret SVG mark; `ClineCompactIcon` → `CaretCompactIcon`.
- Walkthrough step markdown (`walkthrough/step1–5.md`).
- Project-local agent instructions dir: `.clinerules/ → .caretrules/` and `CLAUDE.md` updated.
- Marketplace icon `assets/icons/icon.png` swapped to caret logo; `assets/icons/icon.svg` rewritten as monochrome caret silhouette.
- CLI man page `cline.1[.md] → caret.1[.md]` with content rebranded.

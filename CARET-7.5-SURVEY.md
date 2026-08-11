# Phase 7.5 — Component-library survey (research artifact, 2026-08-10)

The first half of the 7.5 research + curation gate: candidates surveyed against live sources
(registry endpoints fetched, repos and LICENSE files checked via the GitHub API — not marketing
pages). **Not yet done:** running each install headlessly from Caret's own network, and the
rendered specimens. Both happen before the review table goes to the user; nothing here is a
catalog decision.

**Verification legend:** V = verified by live fetch during this survey (GitHub API, raw repo
files, or the registry JSON endpoint itself); D = documented on official docs/README but the
endpoint was not directly exercised; C = claimed by third parties only. Environment note:
`magicui.design` and `motion-primitives.com` refused connections from the research sandbox
(same Vercel edge IP), and `cult-ui.com`'s registry served a Vercel bot-checkpoint page to
curl — likely IP-reputation artifacts, but exactly why every allowlisted registry gets a
smoke test from the product's own install path before it ships.

## Main table

| Name | Categories | Distribution | Install command | Licence | Repo | Editable once installed? | Deps dragged in | Notes |
|---|---|---|---|---|---|---|---|---|
| **shadcn/ui** | baseline primitives (buttons, cards; spinner) | shadcn registry (the reference impl) | `npx shadcn@latest add button` | MIT (V) | `shadcn-ui/ui` (V, 120k★, pushed 2026-08-10) | Yes — copy-in .tsx, plain Tailwind | radix-ui per component | Infrastructure, not one of the five categories; every other registry rides its CLI |
| **Magic UI** | AP (marquee, number ticker, animated beam, border beam, dock), MI, FX (particles, meteors), some HS (bento) | shadcn registry: `https://magicui.design/r/{name}.json`; `@magicui` namespace (D) | `npx shadcn@latest add "https://magicui.design/r/marquee"` (D) | MIT (V) | `magicuidesign/magicui` (V, 21.8k★, pushed 2026-08-09) | Yes — copy-in; component source in public repo (V); endpoint itself unreachable from the sandbox | motion; per-component extras (cobe for globe, canvas-confetti) | Registry JSONs are built at deploy, not committed (`public/r` 404 in repo — V) |
| **Aceternity UI** | MI, FX (beams, spotlights, 3D cards), HS (heroes, bento), AP | shadcn registry: `https://ui.aceternity.com/registry/{name}.json` (V) | `npx shadcn@latest add https://ui.aceternity.com/registry/bento-grid.json` (V from docs) | **No repo licence** — site licence: unlimited end products, no resale/redistribution of components (V from licence page) | **No public component repo found** | Yes — registry JSON verified serving full .tsx with plain Tailwind incl. dark: variants (V, `bento-grid.json`) | @tabler/icons-react, motion, three.js on some | Red flags: closed source-of-truth, custom licence, paid Pro tier alongside |
| **cult/ui** | AP (texture cards/buttons, text-gif), MI, HS blocks | shadcn registry: `https://cult-ui.com/r/{name}.json`, `@cult-ui` namespace (D via own docs) | `npx shadcn@beta add @cult-ui/texture-card` (D) | MIT (V) | `nolly-studio/cult-ui` (V, 6k★, pushed 2026-07-22) | Yes — full component source in public repo (V); registry endpoint hit a Vercel bot checkpoint from the sandbox | framer-motion | Some "Premium Blocks" are paid; OSS core is MIT |
| **motion-primitives** | MI, AP (text-effect, text-loop, animated-number, border-trail, infinite-slider) | Own CLI + shadcn registry `https://motion-primitives.com/c/{name}.json`, index at `/c/registry.json` (D) | `npx motion-primitives@latest add text-effect` or `npx shadcn add @motion-primitives/<name>` (D) | MIT (V) | `ibelick/motion-primitives` (V, 5.9k★, pushed 2026-03-19) | Yes — copy-in .tsx, Tailwind + motion | motion | Known bug: `@motion-primitives` namespace entry missing `{name}` placeholder breaks registryDependency resolution (shadcn-ui/ui #9370); ~5 months since last push |
| **Animata** | MI, FX, AP (bento pieces, trails) | **Manual copy-paste only** — README explicit; no CLI/registry (V) | none | MIT (V) | `codse/animata` (V, 2.8k★, pushed 2026-08-05) | Yes — copy-paste .tsx + Tailwind | tailwind-merge, clsx, lucide-react, tailwindcss-animate; framer-motion optional | Fails the headless-install axis; usable only if Caret mirrors the repo itself |
| **fancy components** | MI (best-in-class text animations), FX, AP | shadcn registry: `@fancy` = `https://fancycomponents.dev/r/{name}.json` (V from install docs) | `pnpm dlx shadcn add @fancy/component-name` (V from docs) | MIT (V) | `danielpetho/fancy` (V, 3.1k★, pushed 2026-03-14) | Yes — copy-in .tsx; manual copy also documented | motion; per-component extras noted on each doc page | Docs warn extra deps land in package.json but need manual install; ~5 months quiet |
| **react-bits** | MI, FX (Aurora, particles), AP (text animations, animated lists) | shadcn registry `https://reactbits.dev/r/{Name}-TS-TW.json` + jsrepo, 4 variants | `npx shadcn@latest add https://reactbits.dev/r/BlurText-TS-TW.json` (V — endpoint fetched) | **MIT + Commons Clause** — free use in products; cannot sell/redistribute the components themselves (V from LICENSE.md) | `DavidHDev/react-bits` (V, 45.2k★, pushed 2026-08-08) | Yes — registry JSON verified serving full .tsx (V); caveat: animation values often inline `style`/motion props, less token-friendly | motion; some pull gsap, ogl, or three | Pick the `-TS-TW` variant explicitly; licence is not pure MIT |
| **ldrs (UIball)** | LD (48 loaders — V) | **npm only** | `npm i ldrs`; React: `import { Ring } from 'ldrs/react'` (V via package.json exports) | MIT (V) | `GriffinJohnston/ldrs` (V, 2.2k★, pushed 2025-10-22) | **No — wrap-only.** `size`/`color`/`speed` props take any CSS value, so token rebinding works via props | none (zero-dep) | ~10 months no commits, but feature-complete/stable |
| **Paper Shaders** | FX — 30 shaders verified in repo: halftone-dots, halftone-cmyk, dithering, grain-gradient, paper-texture, voronoi, mesh-gradient, metaballs, god-rays, liquid-metal, water, warp… (V) | **npm only**: `@paper-design/shaders-react` | `npm i @paper-design/shaders-react` (V) | Apache-2.0 (V) | `paper-design/shaders` (V, 3.3k★, pushed 2026-08-09) | **No — wrap-only**, but props take colour arrays (token-bindable); zero-dependency canvas, no three.js (V) | none | Strongest effects source; very active |
| **tsParticles** | FX (particles, confetti, fireworks) | npm: `@tsparticles/react` + engine bundles | `npm i @tsparticles/react @tsparticles/slim` | MIT (V) | `tsparticles/tsparticles` (V, 8.9k★, pushed 2026-08-10) | **No — wrap-only**; JSON options object (colours bindable via options) | none beyond itself | Heavyweight but battle-tested |
| **Kokonut UI** | AP, MI (particle-button etc.), some HS | shadcn registry: `@kokonutui` = `https://kokonutui.com/r/{name}.json` (V — endpoint fetched) | `npx shadcn@latest add @kokonutui/particle-button` (V) | MIT (V) | `kokonut-labs/kokonutui` (V, 2k★, pushed 2026-08-04) | Yes — endpoint verified serving full .tsx with plain Tailwind incl. dark: (V) | motion, lucide-react; **requires Tailwind v4** | Tailwind v4-native — good match for Caret's stack |
| **Animate UI** | AP (sliding/scrolling numbers, counters), MI, FX (backgrounds: bubble, fireworks, gradient, particles) | shadcn registry: `https://animate-ui.com/r/{name}.json`, index `/r/registry.json` (V — index fetched) | `npx shadcn@latest add https://animate-ui.com/r/components-backgrounds-bubble.json` (pattern V) | **MIT + Commons Clause** (V from LICENSE.md) | `imskyleen/animate-ui` (V, 4.1k★, pushed 2025-12-31) | Yes — shadcn-CLI React/TS/Tailwind/Motion source | motion; embla for carousel | ~7 months since last push — watch for dormancy |
| **SmoothUI** | MI, AP, HS blocks (cta-1..3, faq-1..4, features-1..3, footer-simple — V from index) | shadcn registry: `https://smoothui.dev/r/{name}.json`, index `/r/registry.json` (V) | `npx shadcn@latest add https://smoothui.dev/r/faq-1.json` (pattern V) | MIT (V) | `educlopez/smoothui` (V, 879★, pushed 2026-08-03) | Yes — registry blocks/ui in React/Tailwind/Motion | motion | Small but active; blocks + micro-interactions in one registry |
| **Tailark** | HS (marketing blocks: bento-1..14, expandable-features-1..22, heroes; Base UI and Radix variants) | shadcn registry: `https://tailark.com/r/registry.json` verified live (V); `@tailark-oss` namespace documented | `npx shadcn@latest add @tailark-oss/dusk-hero-section-one` (D from README) | MIT (V, repo `tailark/blocks`) | `tailark/blocks` (V, 2.3k★, pushed 2026-07-29) | Yes — shadcn blocks, Tailwind | shadcn/ui components; Base UI or Radix | README cites `oss-tailark.com` which is NXDOMAIN; `tailark.com/r/` works. Paid "full access" tier beyond the OSS set |
| **Eldora UI** | AP, MI, some blocks | shadcn registry, `@eldoraui` namespace; `https://www.eldoraui.site/r/{name}.json` (V — `map.json` fetched) | `pnpm dlx shadcn@latest add @eldoraui/map` (V from docs) | MIT (V) | `karthikmudunuri/eldoraui` (V, 2k★, pushed 2026-04-18) | Yes — endpoint verified serving full .tsx using motion (V) | motion | Heavily overlaps Magic UI; slower cadence (~4 months) |
| **Skiper UI** | MI, AP ("un-common" interactions) | shadcn registry: `@skiper-ui` = `https://skiper-ui.com/r/{name}.json` (V — `skiper40.json` fetched, full .tsx) | `npx shadcn add @skiper-ui/skiper40` (V from docs) | **No repo licence — no public repo.** Free tier requires **attribution**; Pro removes it (V from quick-start) | none found | Yes for free items — verified source-serving; paid items validate a licence key | framer-motion | Freemium; opaque numbered names (skiper40); the attribution clause matters for generated pages |
| **21st.dev** | Aggregator — all five categories, community-published | shadcn-compatible per component: `https://21st.dev/r/<author>/<component>` (D) | `npx shadcn@latest add "https://21st.dev/r/shadcn/accordion"` (D) | **Per-author, no uniform licence** | `serafimcloud/21st` (exists) | Yes mechanically — but provenance/licence per item is unaudited | varies | Open marketplace, pivoting toward MCP/AI generation; cannot be blanket-trusted (individual vetted components could still be pinned by URL) |
| **Page UI** | HS (heroes, testimonials, pricing, FAQ, marquee sections) | Own CLI wizard, copies source into project | `npx @page-ui/wizard@latest init` (V from README) | MIT (V) | `PageAI-Pro/page-ui` (V, 1.7k★, pushed 2026-07-06) | Yes — copy-in Tailwind components with CSS-variable theming (V) | tailwindcss-animate, lucide-react, radix accordion, CVA/clsx | **Tailwind v3 only; v4 "in progress" (V)** — a blocker until that lands |
| **HeroUI** (ex-NextUI) | Full UI kit, not the five categories | **npm only**: `@heroui/react` | `npm i @heroui/react` (D) | Apache-2.0 (V) | `heroui-inc/heroui` (V, 30.3k★, pushed 2026-08-08) | **No — wrap-only**, full design system themed via its own system | React Aria | Wrong shape for this catalog |
| **Uiverse** | MI, LD (3000+ snippets) | Website copy-paste; snippets are HTML/CSS or Tailwind markup, **not React** | none | MIT per elements (C/D) | `uiverse-io/galaxy` (exists) | Partially — needs manual React conversion per snippet | none | No headless path, no React shape — fails ingestibility |
| **Originkit** | MI (cursors, text — 61 text components), FX (ASCII, backgrounds), AP (carousels, marquees, globes), HS (25 hero + feature/footer/pricing sections) | Own shadcn-style CLI (`originkit` on npm, MIT wrapper) + copy-paste site + a hosted **MCP server** (`mcp.originkit.dev` — list/get/search/fetch) | `npx originkit@latest add <compid>` — but `add` (even `--dry-run`) **requires an account** (browser OAuth or `ORIGINKIT_API_KEY`); `list`/`search` work unauthenticated (V — ran it: 193 components listed) | **Undeclared for the components** — the npm CLI says MIT but its repo link 404s; no public component repo, no licence page found (V) | none public (`landerdevelopers/originkit` is 404) | Source copies in as .tsx under `components/originkit/`; **Framer-first authoring** (framer-motion everywhere, Framer property controls + layout annotations in source; react/vite gets a no-op shim or MCP-stripped source) — property controls are Param-friendly, but none of it verifiable without an account | framer-motion; per-component npm deps auto-installed | BETA; **delivery quotas even when signed in** (components 10/day, 30/week; sections 10/day — shared across CLI, MCP and site copies) |
| **Origin UI → coss** | (was) app UI components | — | — | **AGPL-3.0 now** (V — `origin-space/originui` redirects to `cosscom/coss`) | `cosscom/coss` (V, 10.4k★) | — | — | Absorbed into Cal.com's coss.com; successor is AGPL — copyleft into user projects is disqualifying |

Categories: MI = micro-interactions/transitions · LD = loaders · FX = effects · HS = hero/sections · AP = animated primitives.

## Strongest candidates per category (mechanics only — taste is the user's pass)

- **Micro-interactions/transitions:** fancy components (MIT, motion), motion-primitives (MIT, dual CLI/registry — mind the namespace bug), react-bits (endpoint verified, huge, but MIT+Commons-Clause and inline-style-heavy), SmoothUI (endpoint verified, MIT, active).
- **Loaders/spinners:** thin for copy-in. ldrs is the best library but npm wrap-only (colours bindable via props). No verified shadcn-registry loader pack; shadcn/ui's own `spinner` plus Magic UI/Animate UI one-offs are the copy-in options.
- **Effects:** Paper Shaders (Apache-2.0, 30 shaders incl. halftone/dithering/grain — repo-verified; wrap-only, zero-dep), tsParticles (MIT, wrap-only), react-bits + Magic UI for copy-in aurora/particles, Animate UI backgrounds.
- **Hero/section compositions:** Tailark (MIT repo + live registry index; paid tier beyond OSS set), SmoothUI blocks, cult/ui blocks (MIT core, some paid), Page UI (MIT but Tailwind v3 — hold). Aceternity has the showiest heroes but a closed repo + custom licence.
- **Animated primitives:** Magic UI (marquee/ticker/beam/dock — the canonical set, MIT), Kokonut UI (endpoint verified, MIT, Tailwind v4-native), Animate UI (endpoint verified; Commons Clause + quiet), Eldora UI (MIT, overlaps Magic UI).

## Rejected outright

- **HeroUI** — npm-only full design system; not editable Tailwind, wrong shape.
- **Uiverse** — no headless install path; snippets aren't React.
- **Origin UI / coss** — successor is AGPL-3.0; legacy collection unmaintained.
- **21st.dev as an allowlist entry** — open marketplace, per-author licensing unauditable (individually vetted components could still be pinned by URL).
- **Page UI (for now)** — Tailwind v3 only; revisit when v4 ships.
- **Every paid tier** (Skiper Pro, Aceternity Pro, Tailark full-access, cult/ui premium) — behind licence keys or checkout; only free/OSS subsets qualify.

## Cross-cutting findings

1. **Commons Clause cluster:** react-bits and Animate UI are MIT + Commons Clause (verified from LICENSE files). Fine for installing into end-user projects; the catalog itself must not redistribute or mirror their component source.
2. **Attribution clause:** Skiper UI's free tier requires attribution — awkward for generated pages; flag per component.
3. **Registry-without-repo pattern:** Aceternity and Skiper serve editable source from their registries but have no public source-of-truth repo and no OSS licence file.
4. **Bot-protection risk:** cult/ui's registry sat behind a Vercel security checkpoint during the survey; every allowlisted registry gets a smoke test from Caret's own install path before it ships.
5. Dependency profile across the copy-in ecosystem is overwhelmingly **`motion` (framer-motion)** plus lucide/tabler icons; three.js/gsap/ogl appear only in specific effect components.

## Install runs — verified by RUNNING, from this machine (2026-08-10)

Scratch host: Vite + React 19 + Tailwind v4 + `components.json` (the shape Caret's design
layer already is). Every command below actually ran; every "rendered" claim has a screenshot
in `release/75-specimens/`.

| Library | Install run | Rendered specimen | Notes from running it |
|---|---|---|---|
| shadcn/ui | **OK** (`button`, `spinner`) | `shadcn-button-spinner.png` | The baseline; everything else rides its CLI |
| Aceternity UI | **OK** (`bento-grid`) | `aceternity-bento.png` | Full editable .tsx landed, plain Tailwind incl. dark: variants |
| react-bits | **OK** (`BlurText-TS-TW`) | `reactbits-blurtext.png` | Landed at `components/BlurText.tsx` (not under ui/); animation values in motion props, not classes |
| Kokonut UI | **OK** (`particle-button`) | `kokonut-particle-button.png` | Tailwind v4-native, clean source |
| Animate UI | **OK** (`backgrounds-bubble`) | `animateui-bubble-background.png` | Deep folder layout (`animate-ui/components/backgrounds/`) |
| SmoothUI | **OK** (`faq-1` block) | `smoothui-faq.png` | A whole section block with a typed props API — exactly the 7.5 shape |
| Eldora UI | **OK** (`map`) — after a 404 on a guessed name | `eldora-map.png` | Item names MUST come from their registry index; guessing 404s |
| Skiper UI | **Installs OK, Next-coupled** | `skiper-links.png` | `skiper40` imports `next/link` — needed a shim to render in Vite; free tier also requires attribution |
| Animata | **No CLI — raw-file copy-in works** | `animata-text-flip.png` | Copied `text-flip.tsx` from the repo; rendered unmodified |
| ldrs | **OK** (npm) | `ldrs-ring.png` | Wrap-only; `size/color/speed` props take any CSS value → token-bindable |
| Paper Shaders | **OK** (npm) | `paper-shaders-mesh.png` | Wrap-only; colour-array props token-bindable; the render is genuinely good |
| tsParticles | **OK** (npm) | `tsparticles-links.png` | v4 React API changed (`ParticlesProvider`, not `initParticlesEngine`) — docs lag the package |
| Originkit | **OK — with the user's API key** (2026-08-11: `add tornado` ran headlessly with `ORIGINKIT_API_KEY`, a 1,461-line three.js component landed as plain readable TS at `components/originkit/ui/tornado.tsx`, deps auto-installed). Without a key, `add` refuses clearly; quotas apply even signed in (components 10/day, 30/week, shared across CLI/MCP/site copies) | `originkit-tornado.png` | Best-designed CLI on the table. Delivered source has **no licence header** and there is still no declared component licence anywhere — the strongest source with the weakest licence story |
| Magic UI | **UNREACHABLE** — connect timeout on `magicui.design:443`, curl gets no TCP connection at all | — | From THIS machine, not just the research sandbox. The canonical primitives set is uninstallable here today |
| fancy components | **UNREACHABLE** — same timeout signature | — | Same Vercel-edge cluster as Magic UI |
| motion-primitives | **UNREACHABLE** — same timeout signature | — | Same cluster |
| cult/ui | **BLOCKED** — registry returned a client error (the Vercel bot checkpoint, served to the CLI) | — | The survey predicted exactly this; copy-in from the MIT repo is the fallback |
| Tailark | **PAID-GATED** — `hero-section-*` items return "Sign in with a plan that includes blocks"; the documented OSS registry domain (`oss-tailark.com`) does not resolve | — | Free hero blocks could not be verified from here |

**The load-bearing finding:** three of the strongest copy-in candidates (Magic UI, fancy,
motion-primitives) are flat-out unreachable from this machine — the install path that "cannot
be bot-blocked without breaking the product" can still be *network*-blocked, and was. Any
catalog entry needs a reachability smoke test from the user's own network before it ships, and
the catalog should record a fallback (public-repo copy-in) for every registry entry that has
one. cult/ui's bot checkpoint is the same lesson from the other side.

## The curation gate — waiting on the user

The table above (mechanics) + `release/75-specimens/*.png` (taste) is the review artifact.
**The user picks what ships. Nothing enters the catalog without that pass.**

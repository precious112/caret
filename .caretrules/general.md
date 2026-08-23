This file is the secret sauce for working effectively in this codebase. It captures tribal knowledge—the nuanced, non-obvious patterns that make the difference between a quick fix and hours of back-and-forth & human intervention.

**When to add to this file:**
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to "add this to CLAUDE.md"

**Proactively suggest additions** when any of the above happen—don't wait to be asked.

**What NOT to add:** Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

## Miscellaneous
- This is a VS Code extension—check `package.json` for available scripts before trying to verify builds (e.g., `npm run compile`, not `npm run build`).
- When creating PRs, contributors should not create changelog-entry files. Maintainers handle release versioning and changelog curation during the release process.
- When adding new feature flags, see this PR as a reference https://github.com/cline/cline/pull/7566
- Additional instructions about making requests: @.clinerules/network.md

## Certifying the desktop app
- **The verify windows look stuck during long model waits, and a human may close one.** `ff` can sit silently on a model for five minutes with a visible window. Several runs died mid-suite with no cause in any log; the harness now stamps window open/close into `main.log` (`appDiedAt`) so the next occurrence names which surface died and when. **Cause still unknown, but the 2026-08-23 death has a shape**: cb's second project window fired 'closed' NOT via close(), main logged an uncaught exception, the chrome then timed out four scenarios and exited seven minutes later. The exception had no detail because Logger dropped all args outside IS_DEV (fixed — ERROR/WARN now always attach, Errors as stacks), so the NEXT occurrence names itself. A human closing a frozen-looking window is still one candidate, not a finding. Do not assert a cause without evidence from those stamps.
- **Certification includes eyes on the pictures.** After a full run, open every shot in `release/verify-shots/` and write a UI-findings note — anything you would wince at is a finding even though no assertion failed, and recurring winces graduate into assertions. The suite's screenshots are chrome-only: the canvas is a NATIVE view that `page.screenshot` cannot see, so canvas shots show the surface underneath (a black void or the Foundation tab) — do not read that as a blank canvas, and do not certify canvas rendering from chrome pixels.
- `--user-data-dir` **does** work: Electron honours it as a Chromium switch, and the harness has passed it since `47f95ed5`. Verified by the dev profile (`~/Library/Application Support/Electron/preferences.json`) carrying no fixture path from any run after that commit. `desktop/main/index.ts` also calls `app.setPath("userData")` for it, which is belt-and-braces rather than the thing that made it work.
- **`verify:app` launches `out/main/index.js`, not your source.** It now runs `npm run build` first, and it must keep doing so. Before that guard existed, a full run reported CERTIFIED against a binary from the previous day — every conclusion drawn from it was about code that wasn't running, including a "root cause confirmed" that the run itself refuted. If you ever bypass the build (running the tsx script directly), first check the bundle actually contains your change: `grep -c "<a string from your edit>" out/main/index.js`.
- Playwright reports a dead app as "Target page, context or browser has been closed" on whatever call comes next, so the scenario that *reports* it is rarely the one that caused it. The harness records `appDiedAt` on `app.on("close")` and rewrites those failures to point at `main.log`; keep that when touching the runner.
- Anything Caret writes into `.caret/` that is not design content must be added to `IGNORED_FILES` in `desktop/main/watch-and-heal.ts` **and** to `CARET_GITIGNORE` in `src/core/design/scaffold.ts`. Miss the first and every write wakes the healer; miss the second and local scratch lands in the user's commits.
- **`--only` does not give you a smaller suite; it gives you a different one.** Scenarios build on each other's state — `h` writes the About page every later canvas scenario needs, `dd` chooses the backend every inference scenario needs, `bx` establishes the MCP discovery record `by` reads. A subset failure is meaningless until you have checked whether the thing it needs is created by a scenario you filtered out; a subset PASS can equally hide an ordering bug. Two of the three "reproductions" in one session were the harness missing a prerequisite, not the product.
- **Order also decides whether a bug is visible at all.** `h` passed in every full run for months and fails 100% of the time as the first scenario, because by scenario 8 the healer's initial scan is long finished. When a scenario is the only cover for a guarantee, run it first at least once — position is a test variable, not a detail.
- **Scenario position in the FILE is execution order; `--only` filters but never reorders.** `ce` was written after `bu` (line ~2800) and silently ran before `dd` (line ~3970) chose the backend — the subset "a,dd,ce" ran ce backendless. A scenario that needs inference must sit after `dd` in the file, and a `dd` subset also needs `cc` before it (cc's click is what opens the chat sidebar dd's last assertion reads).
- **Never define a named function const inside `app.evaluate` — esbuild wraps it in a `__name` helper that does not exist on the Electron side** ("ReferenceError: __name is not defined" from `UtilityScript.evaluate`). Inline the logic or pass code as strings to `executeJavaScript`; anonymous callbacks in `.find(...)`/`.map(...)` are fine. Every existing scenario keeps helper "functions" as strings for this reason.
- **The focused iframe is SCALED (≈1060px view showing a 1440px page), so in-page rects cannot be used as mouse coordinates.** A drag computed from `getBoundingClientRect` inside the frame lands elsewhere in view space. For anything that must HIT a small target (a resize handle), fixed offsets are not enough either: measure the scale (`iframeRect.width / frame innerWidth`) and map every in-page point through it — bz missed an 8px handle by hundreds of pixels while the same click aimed at a wide paragraph still landed, which is what made selection “work” and the drag silently fail. For loose targets, the painted overlay region only needs to INTERSECT elements, not cover them. Note the geometry is not fixed across a run: the chat-docked consent change made ca leave the sidebar OPEN, which narrows the canvas view and changes the focused iframe's scale for every scenario after it.
- **A timeout with no last-seen state costs three runs before it says anything.** `waitFor` takes a `diagnose` callback — keep the last probe result in scenario scope and report it there (see ce's centering poll).
- **`BrowserWindow.getAllWindows()[0]` is a race, not "the project window".** cb leaves a second project window open for the rest of the run, and the overlay-verify loop spawns hidden screenshot windows whenever an edit turn lands — so `[0]` is whoever happens to be there when the helper fires. bq failed a full run as "no canvas view" from a one-shot `[0]` grab while the canvas sat healthy one index over. Scenario evaluate-helpers must search **all** windows for a live view whose URL starts `http://localhost`, retried in a loop, and let the selector they're clicking self-select the right window (bq/by's pick helpers are the pattern).
- **A scenario that says "self-contained" must record its own preconditions, not trust an earlier scenario's leftovers.** by claimed home was "mapped and CLEAN from bx" — but gg's sync apply re-records home's mapping to whichever app files the *model* chose to write, so drifting `src/checkout-view.tsx` only worked when the translation happened to land there. It now re-records the mapping itself before drifting. If a scenario's premise depends on a mapping, a page, or a file, it should create it.
- **The pre-commit hook re-stages whole files after formatting, so hunk-level staging silently becomes whole-file staging.** A carefully split index (mine-only hunks of a file that also carries someone's uncommitted WIP) was swept into the commit by the hook — including an import of an untracked file, i.e. a commit that didn't build. For surgical partial-file commits: write the partial content to the working file, `git add`, commit `--no-verify`, then restore the working file.

## Generated Assets
- **`onnxruntime-node` is pinned to 1.23.0 because 1.24+ dropped the macOS x64 binary.** The package ships per-arch native binaries under `bin/napi-v6/darwin/`; on 1.27 that directory contains `arm64` only, so `require("onnxruntime-node")` throws `Cannot find module '../bin/napi-v6/darwin/x64/onnxruntime_binding.node'` on any Intel Mac — including the machine this project is developed on. 1.23.0 ships `arm64` and `x64`. Before bumping it, check that directory rather than the changelog; a plain `npm update` breaks Intel silently and only at runtime, in the one lane that needs it.
- **The user names the subject; Caret owns the styling.** "Never a prompt box" was the wrong rule and it shipped a generator that could make exactly six things: the subject was `[...][variant % 6]` in `objectOf`, so asking for a paperclip returned a ceramic vase. The correct line is between *style* (lighting, framing, mood — never ask, the foundation decides) and *content* (what the thing is — only the user knows). Anything that asks the user to describe how it should look is the mistake the old rule was aimed at; anything that stops them saying what it **is** is the mistake the old rule made.
- **Variants vary treatment, never subject.** Three takes of one object is a choice; three different objects is being handed something you did not ask for and told to pick. The file's own comment said this and `objectOf` did the opposite.
- **A test of the pipeline is not a test of the feature.** `bm` asserted the model painted the key colour, chroma-key removed it, the PNG carried alpha, and a bad key was refused — all four passed while the feature could not produce a paperclip, because there was no input to assert against. Every generation scenario now starts from something somebody wants to make and asserts they got *that*. Second instance, the inline-text editor: scenario x entered edit mode and then set `textContent` **via script** — the pipeline certified while the gesture rotted, because react-grab stays armed mid-edit and a user's cursor-placing click read as a grab (“Copied” toast, focus stolen, edit closed). If a scenario drives an interaction, the pointer must do what the finger does.

## Prompts That Block An Agent
- **A prompt sent before its listener exists is lost forever, and the surface that would show it is mounted BY the event it missed.** `App` switches to Foundation on `interview:prompt`; `FoundationView` then mounts and registers its own listener a tick too late, so the mode never becomes `agent` and the interview never opens — the agent blocks indefinitely on a question nobody saw. Both levels now also ask `interview:pending` on mount. Certification missed it for months because the scenario that asks a question always ran after one that left `FoundationView` already mounted; run it first and it fails every time. Any new blocking prompt surface needs the same pair: the live listener **and** the catch-up on mount.
- **A prompt's KIND says what it shows; its PLACE says which surface reacts — and a new blocking prompt must decide its place explicitly.** The interview's surface rules (force-switch to Foundation, all navigation vetoed until answered) apply to any prompt not marked otherwise, because reaching a blocked agent's question is the priority. `generate_asset`'s consent rode those rules by default and four parallel generate calls pinned a user to a tab they never opened, unable to leave. Chat-lane prompts carry `place: "chat"` (asset-options is chat-placed by kind) and `landsInChat` in `desktop/shared/ipc.ts` is the ONE predicate all five reacting surfaces share — App's switch + veto, InterviewView, FoundationView, ChatSidebar. The chat dock must re-fetch `interview:pending` after answering: queued prompts already fired their events while the dock was occupied, so only the re-fetch surfaces the next one. Scenario `ca` holds down both the docking and that the surface does not move; it originally passed while hijacking, because it asserted the question appeared *somewhere*.

## The Healer's Watcher
- **chokidar 4 dropped glob support in `ignored`, and a glob string there matches nothing — silently.** The list of `"**/node_modules/**"`-style patterns this repo passed for months ignored *nothing*: `.caret/node_modules` (which Vite rewrites constantly while optimising deps) and every file Caret regenerates were all watched. The proof is ten lines — watch a dir with the glob in `ignored`, touch `node_modules/.vite/deps/react.js`, see the add event — and the certification log carried it too, as provenance entries for `node_modules/fsevents/*`. It is now a predicate, `isIgnoredPath`, held down by `desktop/main/__tests__/watch-ignore.test.ts`. Never hand this option a glob again.
- **`ignoreInitial: true` swallows everything written during the initial scan, not just before it.** chokidar's scan is asynchronous; a file created while it runs is enumerated as "already there" and NO event ever fires — not `add`, and not the `addDir` the catch-up path relies on, because the directory is in the scan too. That window is precisely when unhealed content exists in real life (a `git pull`, a teammate's clone, an agent that wrote while Caret was closed), so the pages arrived with no caret-ids and every click on them resolved to nothing. `healWhatWasAlreadyThere()` sweeps the tree on `ready`; it is safe to repeat only because the codemod is idempotent, and `watch-open-sweep.test.ts` holds down both halves — that it heals, and that a second open writes nothing.

## The Design Shell's CSS
- **The virtual router must never import a page statically — one unresolvable import in any page 500s the router module, and the whole canvas dies with it.** The `existsSync` guard only covers a MISSING index.tsx; a present file importing a component that does not exist (e.g. a catalog piece the budget refused) fails at transform, HMR re-evaluates the router into the error, and every card disappears at once — a full certification run lost ce, bq and by to one refused `pixel-trail` import. **And React.lazy is the wrong fix:** a lazy component inside Suspense commits an EMPTY frame before the chunk lands, and every probe and readiness heuristic keyed on "the frame has content" raced that null commit — the run after the lazy fix lost bz, bo and br to it. Routes carry a `loader` and the entry AWAITS it before mounting, so the router always evaluates, a broken page error-cards alone, and first paint is the whole page. `scripts/probe-broken-import.ts` is the ten-second reproduction; keep it passing when touching the router or entry templates.
- **Tailwind's scan set is frozen at the moment `global.css` transforms; a `.tsx` file CREATED afterwards contributes no CSS at all** — not just arbitrary values: an agent-written page's `p-8` produced nothing until some boot-time file happened to change (any change to a known file triggers a full re-scan that sweeps late files up, which is why this hid for months). `caretTailwindFreshPlugin` in `vite-config-template.ts` now touches `global.css` on every new source file; keep it when touching the config template. The reliable standalone reproduction: boot the shell, write a new page with a novel class, `curl :PORT/global.css | grep -F` for it.
- **`@import` is only legal before other statements in the stylesheet the bundler *produces*.** `global.css` imports Tailwind and then `caret-theme.css`, so a font `@import` written into the theme lands a few hundred lines into the bundled sheet, PostCSS drops it with "@import must precede all other statements", and the faces are declared in `--font-sans` but never fetched — every page renders in the fallback and nothing anywhere says so. It only ever surfaced as a `[vite:css]` warning in `.caret/vite.log`, repeated on every token edit. The webfont import lives alone in `caret-fonts.css`, imported by `global.css` **above** `@import "tailwindcss"`. Read `.caret/vite.log` after any change to the generated CSS; the shell boots fine either way.

## The Webview→Electron Port
- **In VS Code the canvas was an iframe; in the desktop app it is the top-level document.** Any generated-template code that talks to `window.parent` silently changes meaning: `window.parent === window` at top level, so a "relay upward" re-posts onto the same window — where the canvas preload forwards it to main a **second** time. That duplicated every message from the focused-page iframe (inline edits applied twice, which corrupted text: "lane"→"lanes" became "laness"). When touching `canvas-template.ts` messaging, ask which window the code will actually run in per host, and guard `window.parent !== window` before relaying. Duplicate delivery shows up in logs as every relayed line printed twice.
- Mutating editors must be **idempotent against redelivery**, not just guarded against staleness: `editJSXText` treats current-text==newText as success-without-write, and the raw text fallback refuses to replace an oldText found *inside* an occurrence of newText (the prefix trap). The stale-target guard alone made things worse — it pushed duplicates into the unguarded fallback.
- "Exists" is not "works" for cached installs, third occurrence: the design-shell suite's node_modules cache can be left without a vite binary by an interrupted install, and every later run fails with "vite did not start". The suite now checks for the binary it is about to spawn and discards a poisoned cache. Same lesson as `needsInstall` and `--user-data-dir`: verify the artifact, not the marker.

## OpenCode Backend (bundled server)
- **There is one backend, and that is the architecture rather than a shortcut.** Caret shipped adapters for the Claude, Codex and Kimi CLIs and removed all three: each existed to reach a subscription, and each arrived with its own permission story, structured-output dialect, image handling and approval gate in front of Caret's tools. The bundled server reaches those same subscriptions as *providers* — ChatGPT Plus/Pro/Go by OAuth, Kimi For Coding and the Z.AI/Zhipu coding plans by subscription key, Copilot by device code — while Caret keeps one agent loop. **Anthropic is the exception and cannot be fixed by trying harder:** it prohibits subscription use outside its own tools (OpenCode unbundled its Claude Pro/Max plugin at 1.3.0 and removed the references after a legal request), so Claude arrives by API key and nothing in the UI may imply otherwise.
- **Zero cost does not mean free to spend.** Provider plugins report `cost: { input: 0, output: 0 }` for plans already paid for, because there is no per-token price to report. Anything that picks a model "because it's free" — `verify-support.freeModel()` was exactly this — will otherwise burn somebody's monthly quota; `SUBSCRIPTION_PROVIDERS` exists in two places for this reason, and both are allowlists of names rather than a heuristic.
- **`POST /provider/{id}/oauth/authorize` only STARTS a browser sign-in — `POST /oauth/callback` is what collects and persists it, and for `auto` methods it must be called immediately with no code.** The server holds the pending flow and `callback()` is the await: skip it and the browser shows "Authorization successful", the loopback exchanges the code, and the tokens go to a promise nobody consumes — a real sign-in stored nothing and the panel said it didn't complete (the pending flow even survives in server memory; calling callback an hour later rescued the dropped tokens). The server's handler was read from the binary: `pending.get(providerID)` → `await x.callback(x.method === "code" ? code : undefined)` → persist. `finishAutoOauth` in the adapter is that call; the panel polls `oauthStatus`, never the model list, which sits behind two layers of cache.
- **Writing a credential does not connect it: `PUT /auth/{id}` leaves the running server's provider list stale until `POST /instance/dispose`.** The server builds that list once, on the first request that needs it, and nothing invalidates it — measured: connect a provider and it is absent three seconds later, absent on a fresh fetch, and present the moment the process restarts. A "Connect" button without the dispose call appears to do nothing and then mysteriously works tomorrow. Sessions live in the server's database, so disposing costs only an in-flight turn.
- **`GET /provider` is the whole catalogue plus `connected`; `/config/providers` is only what you are signed in to.** The first is how the UI can offer a door to a subscription you have not connected, and it carries per-model `limit.context`, `capabilities.input.image` and `capabilities.toolcall`. It is ~5MB, so cache it. `GET /provider/auth` gives the sign-in methods per provider, in the server's own labels — take the parenthetical seriously, it is what distinguishes "ChatGPT Pro/Plus (browser)" from "(headless)".
- **Entitlement is invisible in any catalogue.** A plan lists models it will refuse, and `status: "active"` says nothing about whether *your* plan covers it. The only honest check is one trivial round-trip (`probeModel`), and its failure arrives as a transport error whose useful half is a `message` buried in a JSON body — quote that, never the raw `refused POST /session/… (500)`.
- **A config-level `local` MCP server spawns LAZILY at a session's first TURN — not at session creation — once per directory, with the project directory as cwd** (measured by `scripts/probe-mcp-bridge.ts`; session creation alone spawns nothing, which made the first probe run read as "never spawns"). This is what makes the chat-tools stdio bridge work: one global `mcp` entry in the spawn config, and the bridge finds the per-project endpoint from `<cwd>/.caret/.mcp.json`. Beware the macOS `/var`→`/private/var` symlink when comparing spawn cwds — realpath both sides. OpenCode surfaces the tools prefixed `caret_*`, and its MCP `timeout` default (5s) kills any tool that waits on a person — the entry sets ten minutes.
- **The model's usual editor is `apply_patch`, whose file paths live inside `state.input.patchText` (`*** Update File: <path>` headers), not in a `filePath` field.** Until `filePathsOf` parsed them, every apply_patch turn reported `filesChanged: []` and everything keyed on it — the design-checks enforcement loop, the overlay verify loop — silently skipped exactly the turns where the model did real work. When adding anything that reacts to "the turn changed files", test it against an apply_patch turn, not just edit/write.
- **Never client-assign message IDs on `prompt_async`.** The server's agent loop orders its work queue by message id, and its own ids are monotonically ascending. A foreign id sorting *before* the previous turn's messages reads as already-processed history — the loop exits at step 0 without running the model, emits a perfectly real `session.idle`, and a resumed session silently no-ops. An id sorting *after* them is the mirror failure: the same prompt is reprocessed forever (observed: 107 identical replies). The `EventMapper` recognises the user's own prompt echo by role (`message.updated` announces a message's role before its parts arrive), never by id.
- **A part GROWS via `message.part.delta`; `message.part.updated` fires only at its creation (empty) and completion (whole text).** Measured on the pinned server with an SSE tap: 103 deltas, 2 updates for one reasoning part. A mapper that only reads `updated` shows nothing until a part finishes — for a five-minute reasoning turn that is the whole turn stuck on “Working…”, and a cancelled turn never gets the completing update at all (the trace then appears only after reload rehydrates it — exactly the observed bug). Deltas carry `partID`/`messageID` but no part type and no role, so the creating `updated` is both the type record and the assistant-role gate; the completing re-send is the catch-up if deltas were missed, made safe by the suffix logic. `scripts/probe-part-delta.ts` is the live reproduction.
- **Reasoning effort is the prompt body's TOP-LEVEL `variant` field — beside `model`, never inside it.** A variant tucked into the model ref is silently stripped (the session records `"default"`); top-level it is honored, and one the model does not offer is recorded, matched to nothing and run at default — even `"nonsense"` completes, so pass-through is safe. The ladders (`none,low,medium,high,xhigh,max`) are **synthesized at runtime** from model capabilities: `GET /provider` on a live server shows them, while `~/.cache/opencode/models.json` is the raw upstream file and shows `variants: null` — do not conclude "no variants" from the cache (that mistake nearly killed the effort feature). `minimal` is not a rung anywhere; Caret maps it to `low` because a miss means default, which measured near high.
- **The server's system prompt sandwiches Caret's: `[agent.prompt ?? built-in per-model prompt] + environment/AGENTS.md/MCP + Caret's `system` LAST`** (read from the binary: `e.agent.prompt?[e.agent.prompt]:go.provider(e.model)` then `...e.user.system` appended). The built-in GPT-family prompt commands "plan extensively before each function call", "DO NOT do this entire process by making function calls only" and blesses very-long thinking — which is why a strong reasoning model designs five pages inside its head before touching a tool. Not a model bug; instructed. The full-ownership lever exists: an agent with its own `prompt` REPLACES the built-in entirely (config `agent`), at the cost of owning the tool-use discipline it provided. Deliberately not pulled as of 2026-08-23 — observing first.
- **Primary evidence for backend bugs is free — read it before theorising.** `~/.local/share/opencode/opencode.db` (sqlite: `session`, `message`, `part`, `event`) holds every session's full transcript, and `~/.local/share/opencode/log/opencode.log` shows the agent loop's own decisions (`loop step=N`, `exiting loop`, `process messageID=...`; timestamps are UTC). Three verify runs were spent testing prompt-wording theories for a turn the model was never given; one query of either source would have shown it. Free-tier models (`opencode/mimo-v2.5-free`) reproduce protocol-level behavior at zero cost — `scripts/probe-idle.ts` is the template, and it must kill the server in a `finally` (a leaked agent loop polls the provider forever).
- A turn can end with a *legitimate* `session.idle` without the model ever having run. `AgentConversation.run()` therefore fails any turn with zero assistant activity — don't weaken that check, and don't add completion signals off `session.status` (it's a busy-heartbeat, not a turn boundary).

## The Param/Splice Substrate (Phase 8)
- **`runExclusive` is non-reentrant — nesting it on the same key deadlocks silently.** The splice editors (`spliceTextEdit`/`spliceColorEdit`/`spliceParamEdit`/`spliceRowTextEdit`) all serialize internally via `spliceFile`; wrapping any of them in `runExclusive(filePath, ...)` in the router hangs forever, and every later write to that file queues behind the hang. This shipped in 8.3 and survived until an app scenario finally drove the text path (bu): unit tests call the editors directly and design-shell has no host, so only `verify:app` exercises the router's edit paths. When adding an editor call to the router, the lock belongs around the recast fallback only.

## gRPC/Protobuf Communication
The extension and webview communicate via gRPC-like protocol over VS Code message passing.

**Proto files live in `proto/`** (e.g., `proto/cline/task.proto`, `proto/cline/ui.proto`)
- Each feature domain has its own `.proto` file
- For simple data, use shared types in `proto/cline/common.proto` (`StringRequest`, `Empty`, `Int64Request`)
- For complex data, define custom messages in the feature's `.proto` file
- Naming: Services `PascalCaseService`, RPCs `camelCase`, Messages `PascalCase`
- For streaming responses, use `stream` keyword (see `subscribeToAuthCallback` in `account.proto`)

**Run `npm run protos`** after any proto changes—generates types in:
- `src/shared/proto/` - Shared type definitions
- `src/generated/grpc-js/` - Service implementations
- `src/generated/nice-grpc/` - Promise-based clients
- `src/generated/hosts/` - Generated handlers

**Adding new enum values** (like a new `ClineSay` type) requires updating conversion mappings in `src/shared/proto-conversions/cline-message.ts`

**Adding new RPC methods** requires:
- Handler in `src/core/controller/<domain>/`
- Call from webview via generated client: `UiServiceClient.scrollToSettings(StringRequest.create({ value: "browser" }))`

**Example—the `explain-changes` feature touched:**
- `proto/cline/task.proto` - Added `ExplainChangesRequest` message and `explainChanges` RPC
- `proto/cline/ui.proto` - Added `GENERATE_EXPLANATION = 29` to `ClineSay` enum
- `src/shared/ExtensionMessage.ts` - Added `ClineSayGenerateExplanation` type
- `src/shared/proto-conversions/cline-message.ts` - Added mapping for new say type
- `src/core/controller/task/explainChanges.ts` - Handler implementation
- `webview-ui/src/components/chat/ChatRow.tsx` - UI rendering

## Adding a New API Provider
When adding a new provider (e.g., "openai-codex"), you must update the proto conversion layer in THREE places or the provider will silently reset to Anthropic:

1. `proto/cline/models.proto` - Add to the `ApiProvider` enum (e.g., `OPENAI_CODEX = 40;`)
2. `convertApiProviderToProto()` in `src/shared/proto-conversions/models/api-configuration-conversion.ts` - Add case mapping string to proto enum
3. `convertProtoToApiProvider()` in the same file - Add case mapping proto enum back to string

**Why this matters:** Without these, the provider string hits the `default` case and returns `ANTHROPIC`. The webview, provider list, and handler all work fine, but the state silently resets when it round-trips through proto serialization. No error is thrown.

**Other files to update when adding a provider:**
- `src/shared/api.ts` - Add to `ApiProvider` union type, define models
- `src/shared/providers/providers.json` - Add to provider list for dropdown
- `src/core/api/index.ts` - Register handler in `createHandlerForProvider()`
- `webview-ui/src/components/settings/utils/providerUtils.ts` - Add cases in `getModelsForProvider()` and `normalizeApiConfiguration()`
- `webview-ui/src/utils/validate.ts` - Add validation case
- `webview-ui/src/components/settings/ApiOptions.tsx` - Render provider component

## Responses API Providers (OpenAI Codex, OpenAI Native)
Providers using OpenAI's Responses API require native tool calling. XML tools don't work with the Responses API.

**Symptoms of broken native tool calling:**
- Tools get called multiple times (e.g., `ask_followup_question` asks the same question twice)
- Tool arguments get duplicated or malformed
- The model responds but tools aren't recognized

**Root causes to check:**
1. **Provider missing from `isNextGenModelProvider()`** in `src/utils/model-utils.ts`. The native variant matchers (e.g., `native-gpt-5/config.ts`) call this function. If your provider isn't in the list, the matcher returns false and falls back to XML tools.

2. **Model missing `apiFormat: ApiFormat.OPENAI_RESPONSES`** in its model info (`src/shared/api.ts`). This property signals that the model requires native tool calling. The task runner in `src/core/task/index.ts` checks this and forces `enableNativeToolCalls: true` regardless of user settings.

**When adding a new Responses API provider:**
1. Add provider to `isNextGenModelProvider()` list in `src/utils/model-utils.ts`
2. Set `apiFormat: ApiFormat.OPENAI_RESPONSES` on all models that use the Responses API
3. The variant matcher and task runner will handle the rest automatically

## Adding Tools to System Prompt
This is tricky—multiple prompt variants and configs. **Always search for existing similar tools first and follow their pattern.** Look at the full chain from prompt definition → variant configs → handler → UI before implementing.

1. **Add to `ClineDefaultTool` enum** in `src/shared/tools.ts`
2. **Tool definition** in `src/core/prompts/system-prompt/tools/` (create file like `generate_explanation.ts`)
   - Define variants for each `ModelFamily` (generic, next-gen, xs, etc.)
   - Export variants array (e.g., `export const my_tool_variants = [GENERIC, NATIVE_NEXT_GEN, XS]`)
   - **Fallback behavior**: If a variant isn't defined for a model family, `ClineToolSet.getToolByNameWithFallback()` automatically falls back to GENERIC. So you only need to export `[GENERIC]` unless the tool needs model-specific behavior.
3. **Register in `src/core/prompts/system-prompt/tools/init.ts`** - Import and spread into `allToolVariants`
4. **Add to variant configs** - Each model family has its own config in `src/core/prompts/system-prompt/variants/*/config.ts`. Add your tool's enum to the `.tools()` list:
   - `generic/config.ts`, `next-gen/config.ts`, `gpt-5/config.ts`, `native-gpt-5/config.ts`, `native-gpt-5-1/config.ts`, `native-next-gen/config.ts`, `gemini-3/config.ts`, `glm/config.ts`, `hermes/config.ts`, `xs/config.ts`
   - **Important**: If you add to a variant's config, make sure the tool spec exports a variant for that ModelFamily (or relies on GENERIC fallback)
5. **Create handler** in `src/core/task/tools/handlers/`
6. **Wire up in `ToolExecutor.ts`** if needed for execution flow
7. **Add to tool parsing** in `src/core/assistant-message/index.ts` if needed
8. **If tool has UI feedback**: add `ClineSay` enum in proto, update `src/shared/ExtensionMessage.ts`, update `src/shared/proto-conversions/cline-message.ts`, update `webview-ui/src/components/chat/ChatRow.tsx`

## Modifying System Prompt
**Read these first:** `src/core/prompts/system-prompt/README.md`, `tools/README.md`, `__tests__/README.md`

System prompt is modular: **components** (reusable sections) + **variants** (model-specific configs) + **templates** (with `{{PLACEHOLDER}}` resolution).

**Key directories:**
- `components/` - Shared sections: `rules.ts`, `capabilities.ts`, `editing_files.ts`, etc.
- `variants/` - Model-specific: `generic/`, `next-gen/`, `xs/`, `gpt-5/`, `gemini-3/`, `hermes/`, `glm/`, etc.
- `templates/` - Template engine and placeholder definitions

**Variant tiers (ask user which to modify):**
- **Next-gen** (Claude 4, GPT-5, Gemini 2.5): `next-gen/`, `native-next-gen/`, `native-gpt-5/`, `native-gpt-5-1/`, `gemini-3/`, `gpt-5/`
- **Standard** (default fallback): `generic/`
- **Local/small models**: `xs/`, `hermes/`, `glm/`

**How overrides work:** Variants can override components via `componentOverrides` in their `config.ts`, or provide a custom template in `template.ts` (e.g., `next-gen/template.ts` exports `rules_template`). If no override, the shared component from `components/` is used.

**Example: Adding a rule to RULES section**
1. Check if variant overrides rules: look for `rules_template` in `variants/*/template.ts` or `componentOverrides.RULES` in `config.ts`
2. If shared: modify `components/rules.ts`
3. If overridden: modify that variant's template
4. XS variant is special—has heavily condensed inline content in `template.ts`

**After any changes, regenerate snapshots:**
```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```
Snapshots live in `__tests__/__snapshots__/`. Tests validate across model families and context variations (browser, MCP, focus chain).

## Modifying Default Slash Commands
Three places need updates:
- `src/core/slash-commands/index.ts` - Command definitions
- `src/core/prompts/commands.ts` - System prompt integration
- `webview-ui/src/utils/slash-commands.ts` - Webview autocomplete

## Adding New Global State Keys
Adding a new key to global state requires updates in multiple places. Missing any step causes silent failures.

Required steps:
1. Type definition in `src/shared/storage/state-keys.ts` - Add to `GlobalState` or `Settings` interface
2. Read from globalState in `src/core/storage/utils/state-helpers.ts`:
   - Add `const myKey = context.globalState.get<GlobalStateAndSettings["myKey"]>("myKey")` in `readGlobalStateFromDisk()`
   - Add to the return object: `myKey: myKey ?? defaultValue,`
3. StateManager handles read/write via `setGlobalState()`/`getGlobalStateKey()` after initialization

Common mistake: Adding only the return value without the `context.globalState.get()` call. This compiles but the value is always `undefined` on load.

Settings plumbing gotcha: if a key is user-toggleable from settings, wire both controller update paths:
- `src/core/controller/state/updateSettings.ts` for webview `updateSetting(...)`
- `src/core/controller/state/updateSettingsCli.ts` for CLI/ACP settings updates
Missing one path causes a toggle to appear to change in one surface while the backend state stays unchanged.

Webview toggle gotcha: settings changes must also round-trip back in state payloads.
- Add the field to `UpdateSettingsRequest` in `proto/cline/state.proto` (for webview update requests), then run `npm run protos`
- Include the key in `Controller.getStateToPostToWebview()` (`src/core/controller/index.ts`)
- Ensure `ExtensionState` and webview defaults include the key (`src/shared/ExtensionMessage.ts`, `webview-ui/src/context/ExtensionStateContext.tsx`)
If this round-trip wiring is missing, the backend value can update but the toggle in webview appears stuck or reverts.

## StateManager Cache vs Direct globalState Access
StateManager uses an in-memory cache populated during `StateManager.initialize(context)` in `common.ts`. For most state, use `controller.stateManager.setGlobalState()`/`getGlobalStateKey()`.

Exception: State needed immediately at extension startup (before cache is ready)

When Window A sets state and immediately opens Window B, the new window's StateManager cache is populated from `context.globalState` during initialization. If you need to read state in Window B right at startup (e.g., in `common.ts` during `initialize()`), read directly from `context.globalState.get()` instead of StateManager's cache.

Example pattern (see `lastShownAnnouncementId` and `worktreeAutoOpenPath`):
```typescript
// Writing (normal pattern)
controller.stateManager.setGlobalState("myKey", value)

// Reading at startup in common.ts (bypass cache)
const value = context.globalState.get<string>("myKey")
```

This is only needed for cross-window state read during the brief startup window before StateManager cache is fully usable. Normal state access after initialization should use StateManager.

## ChatRow Cancelled/Interrupted States
When a ChatRow displays a loading/in-progress state (spinner), you must handle what happens when the task is cancelled. This is non-obvious because cancellation doesn't update the message content—you have to infer it from context.

**The pattern:**
1. A message has a `status` field (e.g., `"generating"`, `"complete"`, `"error"`) stored in `message.text` as JSON
2. When cancelled mid-operation, the status stays `"generating"` forever—no one updates it
3. To detect cancellation, check TWO conditions:
   - `!isLast` — if this message is no longer the last message, something else happened after it (interrupted)
   - `lastModifiedMessage?.ask === "resume_task" || "resume_completed_task"` — task was just cancelled and is waiting to resume

**Example from `generate_explanation`:**
```tsx
const wasCancelled =
    explanationInfo.status === "generating" &&
    (!isLast ||
        lastModifiedMessage?.ask === "resume_task" ||
        lastModifiedMessage?.ask === "resume_completed_task")
const isGenerating = explanationInfo.status === "generating" && !wasCancelled
```

**Why both checks?**
- `!isLast` catches: cancelled → resumed → did other stuff → this old message is stale
- `lastModifiedMessage?.ask === "resume_task"` catches: just cancelled, hasn't resumed yet, this message is still technically "last"

**See also:** `BrowserSessionRow.tsx` uses similar pattern with `isLastApiReqInterrupted` and `isLastMessageResume`.

**Backend side:** When streaming is cancelled, clean up properly (close tabs, clear comments, etc.) by checking `taskState.abort` after the streaming function returns.

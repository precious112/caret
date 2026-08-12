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
- **The verify windows look stuck during long model waits, and a human may close one.** `ff` can sit silently on a model for five minutes with a visible window. Several runs died mid-suite with no cause in any log; the harness now stamps window open/close into `main.log` (`appDiedAt`) so the next occurrence names which surface died and when. **Cause still unknown** — a human closing a frozen-looking window is one candidate, not a finding. Do not assert a cause for these without evidence from those stamps.
- `--user-data-dir` **does** work: Electron honours it as a Chromium switch, and the harness has passed it since `47f95ed5`. Verified by the dev profile (`~/Library/Application Support/Electron/preferences.json`) carrying no fixture path from any run after that commit. `desktop/main/index.ts` also calls `app.setPath("userData")` for it, which is belt-and-braces rather than the thing that made it work.
- **`verify:app` launches `out/main/index.js`, not your source.** It now runs `npm run build` first, and it must keep doing so. Before that guard existed, a full run reported CERTIFIED against a binary from the previous day — every conclusion drawn from it was about code that wasn't running, including a "root cause confirmed" that the run itself refuted. If you ever bypass the build (running the tsx script directly), first check the bundle actually contains your change: `grep -c "<a string from your edit>" out/main/index.js`.
- Playwright reports a dead app as "Target page, context or browser has been closed" on whatever call comes next, so the scenario that *reports* it is rarely the one that caused it. The harness records `appDiedAt` on `app.on("close")` and rewrites those failures to point at `main.log`; keep that when touching the runner.
- Anything Caret writes into `.caret/` that is not design content must be added to `IGNORED` in `desktop/main/watch-and-heal.ts` **and** to `CARET_GITIGNORE` in `src/core/design/scaffold.ts`. Miss the first and every write wakes the healer; miss the second and local scratch lands in the user's commits.

## The Webview→Electron Port
- **In VS Code the canvas was an iframe; in the desktop app it is the top-level document.** Any generated-template code that talks to `window.parent` silently changes meaning: `window.parent === window` at top level, so a "relay upward" re-posts onto the same window — where the canvas preload forwards it to main a **second** time. That duplicated every message from the focused-page iframe (inline edits applied twice, which corrupted text: "lane"→"lanes" became "laness"). When touching `canvas-template.ts` messaging, ask which window the code will actually run in per host, and guard `window.parent !== window` before relaying. Duplicate delivery shows up in logs as every relayed line printed twice.
- Mutating editors must be **idempotent against redelivery**, not just guarded against staleness: `editJSXText` treats current-text==newText as success-without-write, and the raw text fallback refuses to replace an oldText found *inside* an occurrence of newText (the prefix trap). The stale-target guard alone made things worse — it pushed duplicates into the unguarded fallback.
- "Exists" is not "works" for cached installs, third occurrence: the design-shell suite's node_modules cache can be left without a vite binary by an interrupted install, and every later run fails with "vite did not start". The suite now checks for the binary it is about to spawn and discards a poisoned cache. Same lesson as `needsInstall` and `--user-data-dir`: verify the artifact, not the marker.

## OpenCode Backend (bundled server)
- **Never client-assign message IDs on `prompt_async`.** The server's agent loop orders its work queue by message id, and its own ids are monotonically ascending. A foreign id sorting *before* the previous turn's messages reads as already-processed history — the loop exits at step 0 without running the model, emits a perfectly real `session.idle`, and a resumed session silently no-ops. An id sorting *after* them is the mirror failure: the same prompt is reprocessed forever (observed: 107 identical replies). The `EventMapper` recognises the user's own prompt echo by role (`message.updated` announces a message's role before its parts arrive), never by id.
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

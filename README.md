# Caret

**A persistent design layer for your codebase, driven by the agent you already use.**

---

Every AI design tool is one-shot. The agent generates, you eyeball it, you fix
the same three problems by hand, and next session it makes them again. v0,
Lovable, Bolt and Replit all regenerate from scratch, so every correction you
make evaporates.

Caret's design layer doesn't. It lives in your repo, in git, reviewable in a PR.
Fix something once and it stays fixed, because the fix is a file.

## How it works

Caret splits your frontend into two layers in the same repo:

- A **design layer** under `.caret/` — real React pages, shared components,
  flows, and design tokens. This is where you work things out.
- Your **application layer** — the app you actually ship, in any framework.
  Caret stays unopinionated about it.

You design in the first, then sync into the second. The design layer's known
shape is what makes the live canvas, visual editing and design→app sync possible
regardless of what your shipped app is built with.

## Bring your own model, not your own plumbing

Caret drives a coding agent for the work you start inside it — an AI edit, the
overlay editor, a design→app sync, the foundation interview. It ships with
OpenCode's engine and connects to whichever provider you want: your own API key,
an OpenCode subscription, or Claude Code, Codex and Kimi if you already have
them. No key is required to open the app and design in it.

**You can also drive Caret from your own terminal.** It exposes the design layer
over a local MCP server, so an agent you're already talking to can read and write
your pages — see [docs/connect-an-agent.md](docs/connect-an-agent.md). That's the
inbound direction and it's optional; nothing in the app depends on it.

Caret also generates `AGENTS.md`, `CLAUDE.md` and `.cursor/rules` from your
foundation tokens and keeps them current, so your colours, type and spacing are
in every external agent's session without anyone remembering to mention them.
That matters more than it sounds: an agent asked to "build me a card" that has to
*choose* to look up your spacing scale will not, and will fill the gap from its
training data.

## What it gives you

**A live canvas.** Every page renders on a zoomable, pannable surface. Click one
to mount it live and interact with it. Switch viewport presets to check
responsiveness.

**Direct editing.** Right-click any text, colour or image and change it in
place. The edit writes back to the actual source file and hot-reloads. For
anything harder, describe it and your agent does it with the exact element
already in context.

**Flows and simulation.** Draw the paths between pages, then walk them like a
user would, in a device frame.

**Design → app sync.** When the design changes, Caret computes what changed since
the last sync and hands your agent a worklist. It reads the current design and
your current app code and reconciles the two. A pre-sync snapshot means "Undo
sync" always works.

**It heals what lands in `.caret/`.** Your agent will edit those files with its
own tools rather than Caret's, and that's fine — Caret watches the directory and
runs the same validation and element-identification codemod over anything that
appears there, whoever wrote it.

## Status

Caret is being rebuilt as a standalone desktop app. The VS Code extension is
retired at its last published version. This branch is the desktop app.

## Building from source

```bash
npm install
npm run dev      # run in development
npm run build    # build
npm run package  # produce a distributable
```

Verification:

```bash
npm run verify:design-shell   # certifies the generated canvas (16 scenarios)
npm run verify:app            # certifies the app end to end
npm run test:unit
```

## Licence

Apache-2.0. The direct-manipulation editor is local-forever and free-forever: no
key, no network, no account.

Caret began as a fork of [Cline](https://github.com/cline/cline), which is also
Apache-2.0.

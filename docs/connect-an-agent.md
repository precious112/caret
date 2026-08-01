# Connect an agent

Caret does not bundle an agent. It exposes your project's design layer over a
local MCP server, and you point whichever agent you already use at it.

The connection details are **per project** and **change every time Caret starts**,
so Caret generates the exact command or config file for you: open a project, click
**Connect agent** in the top bar, pick your client, and copy what it shows.

This page explains what that snippet is doing, and how to fix it when it doesn't
work.

## What Caret exposes

One HTTP MCP server per open project, bound to `127.0.0.1` on an
OS-assigned port. The address and a bearer token are written to
`.caret/.mcp.json` inside the project (gitignored, owner-readable only).

Requests must present the bearer token, and any request carrying a browser
`Origin` header is refused outright. Both checks matter and neither is
sufficient alone: the token stops other processes on your machine, and the
origin check stops a web page you happen to visit from reaching a server that
writes files in your repo.

The port and token are regenerated on every launch. A config you saved from a
previous session will need updating — which is why the app generates it rather
than the docs.

## Clients

**Verification status.** The Claude Code path is tested end to end on every
release by `npm run verify:mcp-client`, which registers the server with the real
CLI, health-checks it, has an agent call a tool, and confirms a question that
blocks for 45 seconds still gets its answer. The other snippets follow each
client's documented format but are **not** covered by that test — if one is
wrong, please open an issue.

### Claude Code (verified)

```bash
claude mcp add --transport http caret <URL> --header "Authorization: Bearer <TOKEN>"
```

### Cursor (untested)

`.cursor/mcp.json`, in the project:

```json
{
  "mcpServers": {
    "caret": {
      "type": "http",
      "url": "<URL>",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

### Codex (untested)

`~/.codex/config.toml`:

```toml
[mcp_servers.caret]
url = "<URL>"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

### OpenCode (untested)

`opencode.json`, in the project:

```json
{
  "mcp": {
    "caret": {
      "type": "remote",
      "url": "<URL>",
      "enabled": true,
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

### Kimi CLI and GLM / Zhipu CLI (untested)

Both take the standard `mcpServers` block — the same shape as Cursor, in their
own config file.

## What the agent gets

**Always, without asking.** Caret writes `AGENTS.md`, `CLAUDE.md` and
`.cursor/rules/caret-design-layer.mdc` into your repo and keeps them current with
your foundation tokens. These are the delivery mechanism for the things an agent
must never have to look up: your colours, type, spacing and radius, plus the
authoring rules that keep the visual editor working.

This is not a stylistic choice. An MCP server exposes tools; the *client* decides
what enters the model's context, so no server can force content into every
request of an agent it does not own. Rules files are the channel that every
mainstream agent loads before its first turn. An agent that has to *choose* to
look up your spacing scale will not, and will fill the gap from its training
data.

Caret owns only the region between its `BEGIN CARET DESIGN LAYER` and
`END CARET DESIGN LAYER` markers. Anything you write outside those markers is
preserved across regeneration.

**On request, through tools.**

| Read | Write |
|---|---|
| `get_project` — pages, flows, sync state | `create_page` |
| `get_page` — one page's source and metadata | `write_page` |
| `get_tokens` — foundation tokens | `update_tokens` |
| `get_flows` — flow graph and page states | `write_flow` |
| `get_screenshot` — a rendered page | `complete_sync` |
| `get_sync_worklist` — what changed since the last sync | `start_sync` |
| `get_guide` — the authoring guide | |

Every tool result also echoes the foundation as JSON, as a backstop for an agent
that only touches the tools.

## You do not have to use the write tools

Your agent can edit `.caret/pages/*` with its own file tools, and most will.
That is a supported path, not a workaround: Caret watches `.caret/` and runs the
same validation and the same `data-caret-id` codemod over anything that lands
there, whoever wrote it. The MCP write tools are the *nicer* path — atomic writes
and validation for free — not the one that keeps things working.

## Troubleshooting

**"Connection refused."** The port changed. Caret assigns a new one on every
launch; re-copy the snippet from **Connect agent**.

**401 Unauthorized.** The token changed, same reason.

**403 Forbidden.** Something sent an `Origin` header. That is a browser, and
browsers are refused by design.

**The agent connected but writes pages that look wrong.** Check that the rules
files exist in your repo root and contain a `BEGIN CARET DESIGN LAYER` block. If
your agent reads a rules file Caret does not generate, tell it to read
`AGENTS.md`, or have it call `get_guide` once at the start of a session.

**Sync keeps re-reporting work that was already done.** The agent is not calling
`complete_sync` with the `syncId` it was given. Use **Design → Mark as synced**
to advance the bookmark by hand, and consider telling the agent about the tool
explicitly.

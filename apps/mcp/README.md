# @internit/mcp

A **read-only MCP server** that exposes the internit dataset (internship listings +
the organization directory) as tools any AI agent can call. It's a peer of
`apps/bot` and `apps/worker`: a standalone process that reuses `@internit/db` for all
data access — no new query layer.

## Mental model

The server does **not** call an AI model. It has no API key and runs no inference. It
only:

1. **Advertises** tool definitions (name + description + input schema) on `tools/list`.
2. **Executes** the JSON arguments the client sends on `tools/call`, and returns data.

The model lives on the **client** (Claude Code). The client shows it these tool
definitions, the model picks a tool and arguments, and the client forwards that to us.
The `description` strings in `src/tools/*.ts` are the only thing the model reads — so
the CLAUDE.md domain rules (fit_score bands, `isPaid: null` = unclear, valid statuses)
are baked into that text on purpose.

## Tools (all read-only)

| Tool | Args | Returns |
|------|------|---------|
| `search_listings` | `query?`, `field?`, `paid?`, `remote?`, `status?`, `deadline_within_days?`, `min_fit_score?`, `limit`, `offset` | listing **summaries** (no HTML body), ordered by fit_score |
| `get_listing` | `id` | one listing, full `descriptionHtml`/`Text` + joined org |
| `upcoming_deadlines` | `within_days` (default 7), `limit` | active listings closing soon, soonest first |
| `list_orgs` | `category?`, `region?`, `posts_publicly?`, `scrape_priority?`, `limit` | org directory rows |
| `get_org` | `slug` | one org (incl. how-to-apply fields) + its active listings |
| `stats` | — | counts by status, active listings by field, orgs by posts_publicly, latest scrape run |

`field` and the enum filters are generated from `FIELD_TAGS` in `@internit/shared`, so
they can't drift from the app.

## Run locally

```bash
pnpm --filter @internit/mcp start   # starts on stdio, waits for a client
```

It reads `DATABASE_URL` from the monorepo-root `.env` (loaded automatically by
`@internit/db`). On its own it just waits — an MCP server is driven by a client.

## Register in Claude Code

Add to your project `.mcp.json` (or user config). `pnpm --dir` makes it work no matter
where Claude Code launches it from:

```json
{
  "mcpServers": {
    "internit": {
      "command": "pnpm",
      "args": ["--dir", "/Users/yewe/W/People/internit", "--filter", "@internit/mcp", "start"]
    }
  }
}
```

Or via the CLI:

```bash
claude mcp add internit -- pnpm --dir /Users/yewe/W/People/internit --filter @internit/mcp start
```

Then `/mcp` in a session lists the tools. Try: *"What internships close this week?"*,
*"Find paid governance internships with fit over 80"*, *"Which orgs don't post publicly
that I should email about human rights work?"*

## Example session (raw protocol)

```bash
{ printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_listings","arguments":{"field":"governance","min_fit_score":70,"limit":2}}}' \
; sleep 3 ; } | pnpm --filter @internit/mcp start 2>/dev/null
```

(The trailing `sleep` keeps stdin open long enough for the DB query to finish — a real
client keeps the pipe open for the whole session, so this is only a quirk of the demo.)

## Safety: why read-only

Exposing real data to an agent is the moment guardrails matter. Every tool here only
`SELECT`s. For defense in depth, point this process at a **read-only Postgres role**
(a separate `DATABASE_URL` with only `SELECT` grants) so a bug or prompt injection
can't mutate data even in principle.

### Adding write tools later

If you later want e.g. `create_org` for curating the cold-outreach directory: add it in
a new `src/tools/*.ts`, keep writes narrow and validated, and consider requiring a
confirmation argument. Do **not** wrap admin operations (scrape trigger, re-classify,
subscriber edits) without an auth story — those are admin-token routes today.

## stdio now — how HTTP would differ

This uses the **stdio transport**: Claude Code launches the process and talks JSON-RPC
over stdin/stdout. Standard for local, single-user use. To host it for multiple/remote
clients you'd switch to **Streamable HTTP**:

- Swap `StdioServerTransport` for `StreamableHTTPServerTransport` on an HTTP route — the
  tool definitions and handlers are unchanged; only transport wiring moves.
- Registration points at a `"url"`, not a `command`; run it as a long-lived PM2 process
  (add an entry to `ecosystem.config.cjs` alongside worker/bot/web).
- Add real auth (bearer/OAuth), CORS, and origin checks — stdio inherited local trust.
- Track a session per connection (stdio is inherently one client per process).
- Server→client messages stream over SSE instead of the stdout pipe; on stdio, stdout
  is reserved for protocol, so this server logs only to stderr.

## MCP server vs. the existing REST API (`apps/web` / Hono routes) — in 6 lines

1. **The REST API is for your frontend; this is for agents** — self-describing tools an
   LLM can discover with zero bespoke integration code.
2. **One `tools/list`** returns every tool's schema + docs; the REST API needs
   out-of-band knowledge the model can't rely on.
3. **Uniform protocol**: any MCP client works with this server — no per-endpoint glue.
4. **LLM-shaped**: descriptions are prompts, results are trimmed for token budget,
   errors are messages the model can act on.
5. **More than endpoints**: MCP also standardizes resources, prompts, and progress —
   REST has no equivalent.
6. **Same engine underneath**: both sit on `@internit/db`. This is just an agent-facing
   adapter next to your human-facing API — not a replacement.
```

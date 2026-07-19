# BusinessCom MCP — Cloudflare Deployment Design

Date: 2026-07-20
Status: approved by user (Tyas, Elty)
Extends: [2026-07-19-businesscom-mcp-design.md](2026-07-19-businesscom-mcp-design.md)

## Purpose

Deploy the existing read-only BusinessCom MCP server as a remote MCP endpoint on
Cloudflare Workers, so team members and cloud MCP clients (claude.ai, Claude Code
remote) can use it without running Node locally. The local stdio server keeps
working unchanged — one codebase, two transports.

## Decisions (user-approved)

- **Runtime:** Cloudflare Workers via the Agents SDK `McpAgent` (Durable
  Object-backed, Streamable HTTP at `/mcp`). Rejected: hand-shimming the MCP
  SDK's Node HTTP transport on Workers.
- **Hostname:** workers.dev subdomain (`businesscom-mcp.<account>.workers.dev`).
  No custom zone.
- **Access control:** Cloudflare Access (Zero Trust) on the workers.dev
  hostname, enforced at the edge. MCP clients authenticate with an Access
  **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers).
  Preview URLs disabled so Access cannot be bypassed.
- **Credentials:** `BUSINESSCOM_USERNAME` / `BUSINESSCOM_PASSWORD` as Worker
  secrets (`wrangler secret put`); optional `BUSINESSCOM_BASE_URL` as a plain
  var. Never in code, wrangler.jsonc, or git.
- The Worker remains read-only and stateless (no cache, live fetches), exactly
  like the local server: it reuses `createServer(api)` and `BusinessComClient`
  from `src/` untouched.

## Architecture

```
worker/index.ts        # BusinessComMcp extends McpAgent; init() plugs
                       # createServer(new BusinessComClient({env creds}));
                       # default fetch routes /mcp via serve(), 404 otherwise
wrangler.jsonc         # main worker/index.ts, nodejs_compat (Buffer),
                       # DO binding + new_sqlite_classes migration
tsconfig.worker.json   # typecheck for worker/ (workers types); main tsconfig
                       # stays scoped to src/ so the stdio build is unaffected
```

New deps: `agents` (runtime), `wrangler` + `@cloudflare/workers-types` (dev).
New scripts: `deploy` (wrangler deploy), `dev:worker` (wrangler dev),
`typecheck:worker`.

## Rollout / verification

1. `wrangler dev` with dummy creds → MCP `initialize` + `tools/list` over
   `/mcp` returns exactly the 8 tools (no live API needed).
2. `npm test` (50 unit tests) and both typechecks stay green.
3. `wrangler secret put` both secrets; `wrangler deploy`.
4. Dashboard: enable Cloudflare Access on the workers.dev hostname, disable
   preview URLs, create service token + Service-Auth policy.
5. Verify: request without token → Access 403 page; with token headers →
   tools/list works.
6. README gains a "Remote (Cloudflare)" section with the
   `claude mcp add --transport http … --header` registration command.

## Out of scope

- OAuth / workers-oauth-provider (Access service token chosen instead).
- Custom domain, caching, rate limiting, multi-tenant credential handling.

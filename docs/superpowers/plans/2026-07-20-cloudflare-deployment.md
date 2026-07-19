# Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing BusinessCom MCP server as a remote Streamable-HTTP endpoint on Cloudflare Workers (workers.dev), protected by Cloudflare Access, without touching the local stdio server.

**Architecture:** `worker/index.ts` defines `BusinessComMcp extends McpAgent` (Agents SDK, Durable Object) whose `init()` plugs the untouched `createServer(new BusinessComClient({env secrets}))`; `wrangler.jsonc` configures the DO + `nodejs_compat`. A reusable `scripts/check-remote.ts` performs a real MCP handshake against any URL (wrangler dev or production, with optional Access service-token headers). Spec: `docs/superpowers/specs/2026-07-20-cloudflare-deployment-design.md`.

**Tech Stack:** `agents` (Cloudflare Agents SDK), `wrangler`, `@cloudflare/workers-types`, existing `@modelcontextprotocol/sdk` (client side used by the check script).

**Conventions:** run from repo root `/Users/tl/Projects/Elty/businesscom-mcp`, work on branch `feature/cloudflare-deploy`. Real credentials NEVER appear in files, commands, or chat — Worker secrets are set by the user interactively; `.dev.vars` holds dummy values only and is gitignored.

---

### Task 1: Worker scaffold

**Files:**
- Create: `worker/index.ts`, `wrangler.jsonc`, `tsconfig.worker.json`, `.dev.vars.example`
- Modify: `package.json` (deps + scripts), `.gitignore`

- [ ] **Step 1: Install dependencies**

Run: `npm install agents && npm install -D wrangler @cloudflare/workers-types`
Expected: installs succeed (agents pulls its own deps; ignore peer warnings unless errors).

- [ ] **Step 2: Create `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "businesscom-mcp",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "preview_urls": false,
  "durable_objects": {
    "bindings": [{ "name": "BUSINESSCOM_MCP", "class_name": "BusinessComMcp" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BusinessComMcp"] }],
  "observability": { "enabled": true }
}
```

- [ ] **Step 3: Create `worker/index.ts`**

```ts
import { McpAgent } from 'agents/mcp'
import { BusinessComClient } from '../src/client.js'
import { createServer } from '../src/server.js'

export interface Env {
  BUSINESSCOM_USERNAME: string
  BUSINESSCOM_PASSWORD: string
  BUSINESSCOM_BASE_URL?: string
  BUSINESSCOM_MCP: DurableObjectNamespace
}

export class BusinessComMcp extends McpAgent<Env> {
  server!: ReturnType<typeof createServer>

  async init() {
    this.server = createServer(
      new BusinessComClient({
        username: this.env.BUSINESSCOM_USERNAME,
        password: this.env.BUSINESSCOM_PASSWORD,
        baseUrl: this.env.BUSINESSCOM_BASE_URL,
      }),
    )
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return BusinessComMcp.serve('/mcp', { binding: 'BUSINESSCOM_MCP' }).fetch(request, env, ctx)
    }
    return new Response('Not found', { status: 404 })
  },
}
```

If the installed `agents` version's `McpAgent`/`serve` signature differs (check `node_modules/agents/dist/mcp/index.d.ts`), adapt minimally — the invariants are: DO class exported, `/mcp` served via Streamable HTTP, `createServer` reused unmodified.

- [ ] **Step 4: Create `tsconfig.worker.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["worker"]
}
```

Note: `worker/index.ts` imports `../src/*.js`; with `moduleResolution: "bundler"` TS resolves those to the `.ts` sources. If it complains, keep the `.js` specifiers (needed by the stdio build) and verify wrangler's esbuild handles them (it does) — then relax the worker typecheck with `"noResolve"`-free adjustments rather than changing `src/`.

- [ ] **Step 5: Create `.dev.vars.example`** (dummy values for local `wrangler dev`; user copies to `.dev.vars`)

```
BUSINESSCOM_USERNAME=dummy
BUSINESSCOM_PASSWORD=dummy
```

- [ ] **Step 6: Update `.gitignore`** — append:

```
.dev.vars
.wrangler/
```

- [ ] **Step 7: Update `package.json` scripts** — add to `"scripts"` (keep existing):

```json
    "dev:worker": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck:worker": "tsc -p tsconfig.worker.json",
    "check:remote": "tsx scripts/check-remote.ts"
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run build && npm run typecheck:worker`
Expected: 50/50 tests; stdio build clean (worker/ excluded from main tsconfig via its `include: ["src"]`); worker typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc worker/index.ts tsconfig.worker.json .dev.vars.example .gitignore
git commit -m "feat: Cloudflare Worker entry serving MCP over Streamable HTTP"
```

---

### Task 2: Remote MCP check script + wrangler dev verification

**Files:**
- Create: `scripts/check-remote.ts`

- [ ] **Step 1: Create `scripts/check-remote.ts`**

```ts
/**
 * MCP handshake check against a remote (or local wrangler dev) endpoint.
 * Usage: npm run check:remote -- <url>
 *   e.g. npm run check:remote -- http://localhost:8787/mcp
 * Optional Cloudflare Access service token via env:
 *   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
 * Exits 0 iff the endpoint lists exactly the 8 expected tools.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const EXPECTED = [
  'get_myconnect_cdr',
  'get_myconnect_invoice',
  'get_prices',
  'get_product',
  'get_related_products',
  'get_stock',
  'list_categories',
  'search_products',
]

const url = process.argv[2]
if (!url) {
  console.error('Usage: npm run check:remote -- <url>')
  process.exit(1)
}

const headers: Record<string, string> = {}
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
})
const client = new Client({ name: 'check-remote', version: '0.0.0' })

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name).sort()
  console.log(`tools (${names.length}): ${names.join(', ')}`)
  const ok = JSON.stringify(names) === JSON.stringify(EXPECTED)
  await client.close()
  if (!ok) {
    console.error('Tool list does not match the 8 expected tools.')
    process.exit(1)
  }
  console.log('remote check OK')
} catch (err) {
  console.error(`remote check FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
```

- [ ] **Step 2: Verify against wrangler dev**

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev --port 8787 &   # background; wait for "Ready on http://localhost:8787"
npm run check:remote -- http://localhost:8787/mcp
kill %1
```

Expected: `tools (8): get_myconnect_cdr, ..., search_products` then `remote check OK` (dummy creds are fine — tools/list makes no BusinessCom API call). Also verify `curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/other` → 404.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-remote.ts
git commit -m "feat: remote MCP handshake check script"
```

---

### Task 3: Deploy, README, handoff instructions

- [ ] **Step 1: Deploy**

Run: `npx wrangler deploy`
Expected: uploads, prints the deployed URL `https://businesscom-mcp.<subdomain>.workers.dev`. Record the exact URL. (Secrets intentionally NOT set yet — the endpoint is briefly public but has no credentials, so it can leak nothing; tools fail with the env-guard/auth error until secrets exist.)

- [ ] **Step 2: Verify deployed endpoint handshake**

Run: `npm run check:remote -- https://businesscom-mcp.<subdomain>.workers.dev/mcp`
Expected: `remote check OK` (tools/list needs no credentials). `curl` the root path → 404.

- [ ] **Step 3: Add "Remote (Cloudflare)" section to `README.md`** — insert after the "Register with Claude Code" section:

````markdown
## Remote (Cloudflare Workers)

The server is also deployed as a remote MCP endpoint (Streamable HTTP) at
`https://businesscom-mcp.<subdomain>.workers.dev/mcp`, protected by
Cloudflare Access (service token required).

Deploy/update:

```bash
npm run deploy
npx wrangler secret put BUSINESSCOM_USERNAME   # run once, interactive
npx wrangler secret put BUSINESSCOM_PASSWORD   # run once, interactive
```

Register in Claude Code (values from your Zero Trust service token):

```bash
claude mcp add --transport http businesscom-remote \
  https://businesscom-mcp.<subdomain>.workers.dev/mcp \
  --header "CF-Access-Client-Id: <token-id>.access" \
  --header "CF-Access-Client-Secret: <token-secret>"
```

Verify end-to-end:

```bash
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  npm run check:remote -- https://businesscom-mcp.<subdomain>.workers.dev/mcp
```

Local worker development: `cp .dev.vars.example .dev.vars`, then `npm run dev:worker`.
````

Replace `<subdomain>` with the real value from Step 1 everywhere.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: remote Cloudflare deployment section in README"
```

- [ ] **Step 5: Report the user-action checklist** (the controller relays this; these need dashboard/secret access only the user has):

1. `npx wrangler secret put BUSINESSCOM_USERNAME` and `... BUSINESSCOM_PASSWORD` (interactive — values never in chat).
2. Dashboard → Workers & Pages → businesscom-mcp → Settings → Domains & Routes → workers.dev → **Enable Cloudflare Access**; confirm preview URLs are disabled.
3. Zero Trust → Access → Service Auth → **Create service token** (e.g. `businesscom-mcp-clients`); edit the auto-created Access application's policy to a **Service Auth** policy including that token.
4. Verify: plain `curl https://.../mcp` → Access 403; the `check:remote` command with `CF_ACCESS_CLIENT_ID/SECRET` env vars → `remote check OK`.

---

## Post-plan verification

After user actions: `check:remote` with the service token proves edge auth + handshake; a real tool call (e.g. `list_categories` from Claude Code via the remote registration) proves secrets are wired. The stdio server and all 50 unit tests remain untouched.

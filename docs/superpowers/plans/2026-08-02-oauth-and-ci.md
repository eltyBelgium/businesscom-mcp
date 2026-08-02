# OAuth + GitHub CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) OAuth-protected MCP route `/oauth/mcp` with Cloudflare Access as the only identity, so claude.ai can add the Worker as a custom connector; (2) private GitHub repo `eltyBelgium/businesscom-mcp` with test-gated auto-deploy on `main`.

**Architecture:** `@cloudflare/workers-oauth-provider` wraps the Worker (apiRoute `/oauth/mcp`; defaultHandler keeps `/mcp` + adds `/authorize` which trusts a verified `Cf-Access-Jwt-Assertion`). `worker/access-jwt.ts` verifies the Access JWT via jose + team JWKS. GitHub Actions: test job on every push/PR, deploy job on `main` after tests. Spec: `docs/superpowers/specs/2026-08-02-oauth-and-ci-design.md`.

**Tech Stack:** `@cloudflare/workers-oauth-provider`, `jose`, existing `agents`/MCP SDK, `gh` CLI, `cloudflare/wrangler-action`.

**Conventions:** repo root `/Users/tl/Projects/Elty/businesscom-mcp`, branch `feature/oauth-ci`. npm installs need the committed `.npmrc` (legacy-peer-deps). No credentials in files or chat, ever. NEVER add outbound MCP-client features to the worker (zod v3/v4 landmine — see worker/index.ts comment).

---

### Task 1: GitHub repo + CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the private repo and push** (gh is authenticated as eltyBelgium; the user explicitly requested this repo):

```bash
git checkout main
gh repo create eltyBelgium/businesscom-mcp --private --source . --push
git checkout feature/oauth-ci   # created by controller; branch off latest main
```

Expected: repo exists, `origin` set, `main` pushed. If the name is taken, report BLOCKED.

- [ ] **Step 2: Create `.github/workflows/ci.yml`** (on the feature branch):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm run typecheck:worker

  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check deploy secrets
        id: creds
        run: |
          if [ -n "${{ secrets.CLOUDFLARE_API_TOKEN }}" ]; then
            echo "ok=true" >> "$GITHUB_OUTPUT"
          else
            echo "::notice::CLOUDFLARE_API_TOKEN not set - skipping deploy"
            echo "ok=false" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/setup-node@v4
        if: steps.creds.outputs.ok == 'true'
        with:
          node-version: 22
          cache: npm
      - run: npm ci
        if: steps.creds.outputs.ok == 'true'
      - name: Deploy
        if: steps.creds.outputs.ok == 'true'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Sanity-check the workflow** — `npx yaml-lint .github/workflows/ci.yml 2>/dev/null || node -e "require('js-yaml')" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` (any one that exists; python3 ships on macOS). Expected: parses cleanly.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test-gated GitHub Actions with wrangler deploy on main"
```

---

### Task 2: Access-JWT verification module

**Files:**
- Create: `worker/access-jwt.ts`
- Test: `test/access-jwt.test.ts`

- [ ] **Step 1:** `npm install @cloudflare/workers-oauth-provider jose` (jose is used by this task; the provider by Task 3 — install both now so package-lock changes once).

- [ ] **Step 2: Write the failing test `test/access-jwt.test.ts`:**

```ts
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { verifyAccessJwt } from '../worker/access-jwt.js'

const TEAM = 'elty.cloudflareaccess.com'
const AUD = 'test-aud-tag'

let privateKey: CryptoKey
let jwks: { keys: unknown[] }

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as CryptoKey
  const jwk = await exportJWK(pair.publicKey)
  jwks = { keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] }
})

function stubJwksFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string | URL) => {
      expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`)
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

async function sign(payload: Record<string, unknown>, expiresIn = '5m') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt()
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime(expiresIn)
    .sign(privateKey)
}

describe('verifyAccessJwt', () => {
  it('returns the email claim for a valid token', async () => {
    stubJwksFetch()
    const jwt = await sign({ email: 'tyas@elty.be' })
    const claims = await verifyAccessJwt(jwt, TEAM, AUD)
    expect(claims.email).toBe('tyas@elty.be')
  })

  it('rejects a token with the wrong audience', async () => {
    stubJwksFetch()
    const jwt = await sign({ email: 'tyas@elty.be' })
    await expect(verifyAccessJwt(jwt, TEAM, 'other-aud')).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    stubJwksFetch()
    const jwt = await new SignJWT({ email: 'x@elty.be' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey)
    await expect(verifyAccessJwt(jwt, TEAM, AUD)).rejects.toThrow()
  })

  it('rejects garbage and missing tokens', async () => {
    stubJwksFetch()
    await expect(verifyAccessJwt('not-a-jwt', TEAM, AUD)).rejects.toThrow()
    await expect(verifyAccessJwt(null, TEAM, AUD)).rejects.toThrow(/[Mm]issing/)
  })
})
```

- [ ] **Step 3:** `npx vitest run test/access-jwt.test.ts` — RED (module missing).

- [ ] **Step 4: Implement `worker/access-jwt.ts`:**

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessClaims {
  email: string
  sub?: string
  [claim: string]: unknown
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Verify a Cloudflare Access JWT (Cf-Access-Jwt-Assertion header) against the
 * team's public keys. Throws on missing/invalid/expired tokens or AUD mismatch.
 */
export async function verifyAccessJwt(
  jwt: string | null,
  teamDomain: string,
  aud: string,
): Promise<AccessClaims> {
  if (!jwt) throw new Error('Missing Cf-Access-Jwt-Assertion header')
  let jwks = jwksCache.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    jwksCache.set(teamDomain, jwks)
  }
  const { payload } = await jwtVerify(jwt, jwks, {
    issuer: `https://${teamDomain}`,
    audience: aud,
  })
  if (typeof payload.email !== 'string') {
    throw new Error('Access token has no email claim')
  }
  return payload as AccessClaims
}
```

Note: the module-level JWKS cache holds jose's key-set function (public keys only, auto-refetched by jose on unknown-kid) — this is not business-data caching.

- [ ] **Step 5:** `npx vitest run test/access-jwt.test.ts` — 4 passed (adapt implementation, not tests; if jose's remote JWKS caching interacts badly with the fetch stub across tests, adapting the cache/test seam minimally is allowed — report it). Then `npm test` (all green) and `npm run typecheck:worker` (worker tsconfig must still pass — access-jwt.ts is in worker/).

- [ ] **Step 6: Commit**

```bash
git add worker/access-jwt.ts test/access-jwt.test.ts package.json package-lock.json
git commit -m "feat: Cloudflare Access JWT verification for OAuth authorize"
```

---

### Task 3: OAuthProvider wiring

**Files:**
- Modify: `worker/index.ts`, `wrangler.jsonc`

- [ ] **Step 1: Create the KV namespace:** `npx wrangler kv namespace create OAUTH_KV` — record the returned id. (If the command form differs in this wrangler version, check `npx wrangler kv --help`.)

- [ ] **Step 2: Update `wrangler.jsonc`** — add:

```jsonc
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "<id-from-step-1>" }],
  "vars": {
    "ACCESS_TEAM_DOMAIN": "elty.cloudflareaccess.com",
    "ACCESS_AUD": ""
  }
```

(`ACCESS_AUD` stays empty until the user creates the /authorize Access app; the authorize handler must return a clear 500 explaining that when it's unset.)

- [ ] **Step 3: Rewrite `worker/index.ts`:**

```ts
import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { BusinessComClient } from '../src/client.js'
import { createServer } from '../src/server.js'
import { verifyAccessJwt } from './access-jwt.js'

export interface Env {
  BUSINESSCOM_USERNAME: string
  BUSINESSCOM_PASSWORD: string
  BUSINESSCOM_BASE_URL?: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  BUSINESSCOM_MCP: DurableObjectNamespace<BusinessComMcp>
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers // type from the provider package
}

// Server-only agent. Do not add outbound MCP-client features (this.mcp / addMcpServer):
// the installed agents package calls zod v4's z.fromJSONSchema on that path, which
// crashes at runtime against this project's zod v3 (installed with --legacy-peer-deps).
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

/**
 * Non-OAuth routes: /mcp (Cloudflare Access service token, used by Claude Code),
 * /authorize (Cloudflare Access SSO -> immediate OAuth grant), 404 otherwise.
 */
const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return BusinessComMcp.serve('/mcp', { binding: 'BUSINESSCOM_MCP' }).fetch(request, env, ctx)
    }

    if (url.pathname === '/authorize') {
      if (!env.ACCESS_AUD) {
        return new Response(
          'ACCESS_AUD is not configured — create the Zero Trust Access app for /authorize and set its AUD tag.',
          { status: 500 },
        )
      }
      let email: string
      try {
        const claims = await verifyAccessJwt(
          request.headers.get('Cf-Access-Jwt-Assertion'),
          env.ACCESS_TEAM_DOMAIN,
          env.ACCESS_AUD,
        )
        email = claims.email
      } catch {
        return new Response('Cloudflare Access authentication required', { status: 403 })
      }
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: email,
        metadata: {},
        scope: oauthReq.scope ?? [],
        props: { email },
      })
      return Response.redirect(redirectTo, 302)
    }

    return new Response('Not found', { status: 404 })
  },
}

export default new OAuthProvider({
  apiRoute: '/oauth/mcp',
  apiHandler: BusinessComMcp.serve('/oauth/mcp', { binding: 'BUSINESSCOM_MCP' }),
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
```

IMPORTANT: verify the installed `@cloudflare/workers-oauth-provider` API against its README/.d.ts (`node_modules/@cloudflare/workers-oauth-provider`). Known variation points: the `OAuthHelpers` type name/import, whether `completeAuthorization` returns `{ redirectTo }`, the exact constructor option names, and how the provider passes `env`/binds `OAUTH_PROVIDER`. Adapt minimally and report every adaptation. Invariants: `/oauth/mcp` requires a Bearer token issued by the provider; `/mcp` behavior is byte-identical to before; `/authorize` requires a verified Access JWT before completing the grant; unset ACCESS_AUD produces the clear 500, never an open grant.

- [ ] **Step 4: Verify locally.** Append to `.dev.vars`: `ACCESS_TEAM_DOMAIN=elty.cloudflareaccess.com` and `ACCESS_AUD=` (empty). Then:

```bash
npx wrangler dev --port 8787 > /tmp/wd-oauth.log 2>&1 &
# wait until ready, then:
npm run check:remote -- http://localhost:8787/mcp          # unchanged path: remote check OK
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8787/oauth/mcp   # expect 401 (Bearer required)
curl -s http://localhost:8787/.well-known/oauth-authorization-server | head -c 200  # JSON with authorize/token endpoints
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8787/authorize?client_id=x&redirect_uri=https://example.com&response_type=code'  # expect 500 (ACCESS_AUD unset) — NOT a grant
kill %1
```

All four expectations must hold. `npm test` full suite green; `npm run typecheck:worker` clean.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts wrangler.jsonc
git commit -m "feat: OAuth-protected /oauth/mcp with Cloudflare Access identity"
```

---

### Task 4: Deploy, README, handoff

- [ ] **Step 1:** `npx wrangler deploy`. Then re-verify production:
- `npm run check:remote -- https://businesscom-mcp.tyas.workers.dev/mcp` with the user's CF_ACCESS env vars NOT available to you → expect FAILURE with HTML/302 (Access still guards /mcp hostname-wide until the user re-scopes; that's fine and expected — note whatever you observe).
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://businesscom-mcp.tyas.workers.dev/oauth/mcp` → expect 302 (Access hostname-wide) today; after the user re-scopes Access it must become 401.

- [ ] **Step 2: README** — in the "Remote (Cloudflare Workers)" section, add after the existing content:

````markdown
### claude.ai / Claude Desktop connectors (OAuth)

Add a custom connector with URL `https://businesscom-mcp.tyas.workers.dev/oauth/mcp`.
The login window is Elty's Cloudflare Access SSO; who may log in is controlled by
the Zero Trust Access app on the `/authorize` path. Claude Code keeps using the
service-token `/mcp` path.

CI/CD: GitHub Actions runs tests on every push/PR and deploys `main` via
wrangler once `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets
are set.
````

- [ ] **Step 3: Commit** (`git add README.md && git commit -m "docs: OAuth connector and CI notes"`).

- [ ] **Step 4: Report the user-action checklist** for the controller to relay:

1. Zero Trust → Access → Applications: edit the existing `businesscom-mcp.tyas.workers.dev` app → change its path to `/mcp` (keep the Service Auth policy).
2. Add application → Self-hosted → domain `businesscom-mcp.tyas.workers.dev`, path `/authorize` → Allow policy with your identity rule (e.g. emails ending in @elty.be) → save → copy the app's **AUD tag** (Overview tab).
3. Set the AUD: edit `ACCESS_AUD` in wrangler.jsonc (it's not a secret) → commit+push, or `npx wrangler deploy` locally after editing.
4. GitHub secrets (for CI deploys): create a Cloudflare API token (dash → My Profile → API Tokens → "Edit Cloudflare Workers" template), then locally run `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID` (account id is in the dash sidebar; `npx wrangler whoami` shows it too).
5. claude.ai → Settings → Connectors → Add custom connector → `https://businesscom-mcp.tyas.workers.dev/oauth/mcp` → complete the Elty SSO login.

---

## Post-plan verification

After user actions: adding the connector in claude.ai completes SSO and lists the 8 tools; `/oauth/mcp` without a Bearer returns 401; `/mcp` with the service token still works; a push to `main` runs tests then deploys.

# BusinessCom MCP — OAuth for claude.ai + GitHub CI/CD Design

Date: 2026-08-02
Status: approved by user (Tyas, Elty)
Extends: [2026-07-20-cloudflare-deployment-design.md](2026-07-20-cloudflare-deployment-design.md)

## Purpose

1. Let claude.ai (and Claude Desktop connectors) use the deployed Worker as a
   custom connector via a standard OAuth flow, with **Cloudflare Access (Elty
   SSO) as the only identity source**.
2. Put the repo on GitHub (private, `eltyBelgium/businesscom-mcp`) with GitHub
   Actions CI: tests gate every push/PR; pushes to `main` auto-deploy via
   wrangler after tests pass.

## Part 1 — OAuth

### Decisions

- `@cloudflare/workers-oauth-provider` wraps the Worker. New OAuth-protected
  MCP route: **`/oauth/mcp`** (same 8 tools, same `McpAgent`). Existing
  `/mcp` (Access service token, used by Claude Code) is unchanged.
- OAuth endpoints `/authorize`, `/token`, `/register`, `/.well-known/*` are
  served by the provider and are publicly reachable (required by spec; they
  gate everything behind the login).
- **Login = Cloudflare Access:** a Zero Trust Access application scoped to the
  `/authorize` path (identity policy, e.g. @elty.be) forces SSO; the Worker
  then verifies the `Cf-Access-Jwt-Assertion` JWT (jose, JWKS from
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, AUD from env)
  and immediately completes the OAuth grant (no separate consent screen —
  internal tool). Invalid/missing JWT → 403.
- The existing hostname-wide Access app is **re-scoped to the `/mcp` path
  only** (service-token policy unchanged). Without this, claude.ai could never
  reach `/authorize`.
- New bindings: KV namespace `OAUTH_KV` (OAuth clients/grants/tokens —
  auth-protocol state only; the "no db, live data" rule for business data
  still holds), vars `ACCESS_TEAM_DOMAIN` (`elty.cloudflareaccess.com`) and
  `ACCESS_AUD` (the /authorize Access app's AUD tag; set after the user
  creates that app).
- claude.ai connector URL: `https://businesscom-mcp.tyas.workers.dev/oauth/mcp`.

### Files

```
worker/index.ts       # wrapped in OAuthProvider: apiRoute /oauth/mcp,
                      # defaultHandler = existing /mcp + /authorize + 404
worker/access-jwt.ts  # verifyAccessJwt(jwt, teamDomain, aud) via jose
test/access-jwt.test.ts  # local key pair + mocked JWKS fetch
wrangler.jsonc        # + kv_namespaces OAUTH_KV, vars ACCESS_TEAM_DOMAIN/ACCESS_AUD
```

### Manual user steps (after deploy)

1. Zero Trust: edit existing Access app → path `/mcp` only.
2. Zero Trust: new self-hosted app for `businesscom-mcp.tyas.workers.dev/authorize`
   with an identity Allow policy; copy its **AUD tag**.
3. Set `ACCESS_AUD` (wrangler var or dashboard) and redeploy.
4. Add the connector in claude.ai → Settings → Connectors → custom connector
   with the `/oauth/mcp` URL; log in via Elty SSO when prompted.

## Part 2 — GitHub + CI/CD

- Private repo `eltyBelgium/businesscom-mcp` created via `gh`; `origin` set;
  `main` pushed.
- `.github/workflows/ci.yml`:
  - `test` job (PRs + all pushes): `npm ci`, `npm test`, `npm run build`,
    `npm run typecheck:worker`.
  - `deploy` job (push to `main` only, `needs: test`): `cloudflare/wrangler-action`
    with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets; the job
    skips gracefully with a notice when the secrets aren't configured yet.
- User adds the two GitHub secrets once (`gh secret set` locally or repo
  Settings → Secrets); values never pass through chat.

## Out of scope

- Multi-tenant credentials (all OAuth users share the Worker's BusinessCom
  secrets — acceptable: same team, read-only data).
- Refresh-token/session tuning beyond provider defaults; custom consent UI.

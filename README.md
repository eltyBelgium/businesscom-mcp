# businesscom-mcp

Read-only MCP server for the [BusinessCom](https://businesscom.nl) distributor API.
Exposes catalog search, product details, reseller prices, live stock, related
products, and My-Connect invoices/CDR as MCP tools. No orders — the server
cannot place or modify anything. No database or cache — every call fetches
live data.

## Setup

```bash
npm install
npm run build
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `BUSINESSCOM_USERNAME` | yes | Portal login name (account needs API privileges) |
| `BUSINESSCOM_PASSWORD` | yes | Portal password **or** API key (API key recommended) |
| `BUSINESSCOM_BASE_URL` | no | Default `https://www.businesscom.nl/api/v1` |

## Register with Claude Code

Requires Node.js ≥ 18. Adjust the `dist/index.js` path below to where you cloned this repo.

```bash
claude mcp add businesscom \
  --env BUSINESSCOM_USERNAME=your-login \
  --env BUSINESSCOM_PASSWORD=your-api-key \
  -- node /Users/tl/Projects/Elty/businesscom-mcp/dist/index.js
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "businesscom": {
      "command": "node",
      "args": ["/Users/tl/Projects/Elty/businesscom-mcp/dist/index.js"],
      "env": {
        "BUSINESSCOM_USERNAME": "your-login",
        "BUSINESSCOM_PASSWORD": "your-api-key"
      }
    }
  }
}
```

## Remote (Cloudflare Workers)

The server also runs as a remote MCP endpoint (Streamable HTTP) at
`https://businesscom-mcp.tyas.workers.dev/mcp`, gated by Cloudflare Access
(once enabled on the workers.dev hostname) — clients need a Zero Trust
service token.

Deploy/update (secrets are set once, interactively — never commit them):

```bash
npm run deploy
npx wrangler secret put BUSINESSCOM_USERNAME
npx wrangler secret put BUSINESSCOM_PASSWORD
```

Register in Claude Code (values from your Zero Trust service token):

```bash
claude mcp add --transport http businesscom-remote \
  https://businesscom-mcp.tyas.workers.dev/mcp \
  --header "CF-Access-Client-Id: <client-id>" \
  --header "CF-Access-Client-Secret: <client-secret>"
```

(`<client-id>` is the full Client ID from the Zero Trust dashboard — it already
ends in `.access`.)

Verify end-to-end:

```bash
CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
  npm run check:remote -- https://businesscom-mcp.tyas.workers.dev/mcp
```

Local worker development: `cp .dev.vars.example .dev.vars`, then `npm run dev:worker`.

### claude.ai / Claude Desktop connectors (OAuth)

Add a custom connector with URL `https://businesscom-mcp.tyas.workers.dev/oauth/mcp`.
The login window is Elty's Cloudflare Access SSO; who may log in is controlled by
the Zero Trust Access app on the `/authorize` path. Only Claude's official OAuth
callbacks can receive authorization codes (allowlist in `worker/index.ts`).
Claude Code keeps using the service-token `/mcp` path.

**Zero Trust runbook (critical):**

- The Access app for `/mcp` must be scoped to that path with a Service Auth
  policy; the app for `/authorize` must be scoped to that path with an identity
  Allow policy. **Never widen an Access app to the whole hostname** — that
  breaks `/token`, `/register` and `/oauth/mcp` for claude.ai (server-to-server
  calls carry no Access cookie).
- Paste each app's AUD tag into `wrangler.jsonc` vars: `ACCESS_AUD` (the
  `/authorize` app) and `ACCESS_MCP_AUD` (the `/mcp` app, optional
  defense-in-depth), then deploy.
- Vars live in `wrangler.jsonc` only — anything set via the Cloudflare
  dashboard is wiped on the next deploy (including CI deploys).
- Consider a WAF rate-limit rule on `/register` (public endpoint by OAuth spec).

### CI/CD

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs
tests + build + typechecks on every push/PR, and deploys `main` via wrangler
after tests pass — once the repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are set (deploy skips with a notice until then).

## Tools

| Tool | Description |
| --- | --- |
| `search_products` | Search catalog by text/brand/category/tag/stock, paginated summaries |
| `get_product` | Full product detail incl. reseller price + live stock |
| `get_prices` | Reseller prices for specific product IDs |
| `get_stock` | Live stock status/quantity/lead time for product IDs |
| `get_related_products` | Accessories/related products for a product |
| `list_categories` | All categories, subcategories and brands |
| `get_myconnect_invoice` | My-Connect invoice (purchases/sales) per period (MMYYYY) |
| `get_myconnect_cdr` | My-Connect CDR totals per period/grouping |

## Development

```bash
npm test        # unit tests (no network)
npm run smoke   # manual live-API smoke test (needs real credentials)
```

API notes captured from the partner docs portal: [docs/api-reference.md](docs/api-reference.md).

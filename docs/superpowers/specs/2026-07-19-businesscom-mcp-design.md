# BusinessCom MCP Server — Design

Date: 2026-07-19
Status: approved by user (Tyas, Elty)

## Purpose

An MCP server exposing the BusinessCom distributor API (https://www.businesscom.nl/api/v1) to MCP clients (Claude Code, Claude Desktop), so an assistant can look up products, reseller prices, live stock, related accessories, and My-Connect invoices/CDR totals for Elty.

Full API details: see [../api-reference.md](../api-reference.md) (captured from the partner docs portal on 2026-07-19).

## Scope

**In scope (read-only):**
- Catalog: products, reseller prices, live stock, product relations
- My-Connect: invoices (purchases/sales CSV per period), CDR totals

**Out of scope (explicit user decision):**
- Order endpoints (list/detail/serials and especially POST /orders — the server must place no orders)
- Any database or cache — every tool call fetches live data from the API ("no db, only live data")

## Architecture

- TypeScript, Node >= 18 (native `fetch`), ESM
- `@modelcontextprotocol/sdk`, **stdio** transport
- Stateless: no disk writes, no in-memory cache across calls; per-call fetch + in-process filtering
- Configuration via environment variables:
  - `BUSINESSCOM_USERNAME` (required) — portal login name
  - `BUSINESSCOM_PASSWORD` (required) — portal password **or** API key (both work as the basic-auth password; API key recommended)
  - `BUSINESSCOM_BASE_URL` (optional, default `https://www.businesscom.nl/api/v1`)
- Auth: HTTP Basic on every request; credentials must never appear in tool output, error messages, or logs

## File layout

```
src/index.ts          # bootstrap, tool registration
src/client.ts         # API client: basic auth, Accept headers, timeout, error mapping
src/tools/catalog.ts  # search_products, get_product, get_prices, get_stock,
                      # get_related_products, list_categories
src/tools/myconnect.ts# get_myconnect_invoice, get_myconnect_cdr
src/csv.ts            # semicolon-delimited CSV parser
test/                 # vitest unit tests (mocked fetch)
scripts/smoke.ts      # manual live-API smoke run
```

## Tools

All tools are read-only. Product data endpoints are fetched with the versioned Accept
headers (`application/vnd.businesscom.products.v202306+json` for products,
`application/vnd.businesscom.stock.v20160215+json` for the stock dump) to get media
arrays and exact stock quantities.

1. **search_products** — inputs: `query?` (matches name, product_id, manufacturer_id, EAN), `brand?`, `category?`, `tag?` (EOL/NEW/PROMO/STOCKPROMO/VOLUME/REF/…), `in_stock_only?`, `limit` (default 20, max 100), `offset`. Fetches `/products`, filters in-process, returns compact rows: `product_id`, `name`, `brand`, `category_name`, `sub_category_name`, `retail_price`, `stock_status_code`, `lead_time`, `tags`, plus a `total_matches` count. Never returns `description_html`.
2. **get_product** — input: `product_id`. Fetches `/products` (find by id), `/prices` (reseller price), `/stock/{id}` (live stock). Returns full detail with `description_html` converted to plain text (truncated ~4000 chars), media URLs built as `https://businesscom.nl/shop-product-media/{id}.{ext}`, reseller price, live stock quantity + lead time.
3. **get_prices** — input: `product_ids[]` (1–100). Fetches `/prices`, returns `{product_id, price}` for the requested IDs, flagging IDs not found.
4. **get_stock** — input: `product_ids[]` (1–100). One ID → `GET /stock/{id}`; multiple → fetch `/stock` dump with versioned header and filter. Returns `product_id`, `stock_status_code` (+ label), `stock_quantity`, `lead_time`.
5. **get_related_products** — input: `product_id`. Fetches `/productRelations` + `/products`, returns related products joined with name/brand/retail price.
6. **list_categories** — no inputs. Fetches `/products`, returns distinct categories with subcategories and product counts, and distinct brands — so the assistant learns valid filter values.
7. **get_myconnect_invoice** — inputs: `period` (MMYYYY), `type` (`purchases`|`sales`, default purchases), `limit` (default 200), `offset`. Fetches `/myconnect/invoices/{period}[/sales]`, parses semicolon-CSV into objects keyed by the header row (columns are user-configurable in the portal, so parsing is header-driven, not positional). Returns rows + `total_rows`.
8. **get_myconnect_cdr** — inputs: `period?` (MMYYYY), `grouping?` (`customer`|`trunk`|`number`), `totals_per_destination?` (bool). Always requests `decimal-separator=period`. Parses CSV to objects, returns rows + `total_rows`.

## Error handling

- 401 → tool error: "Authentication failed — check BUSINESSCOM_USERNAME / BUSINESSCOM_PASSWORD and that the account has API privileges."
- 403 on `/myconnect/*` → tool error: "Account lacks My-Connect API rights (extra user rights required)."
- 404 on `/stock/{id}` → "Unknown product_id" tool error.
- Other non-2xx → tool error with HTTP status and a short (≤300 char) response snippet.
- Network timeout: 60s via AbortController (full-catalog dumps can be large), surfaced as a tool error.
- Invalid inputs (bad period format, empty product_ids, limit out of range) rejected by zod schemas before any API call.
- All failures are returned as MCP tool errors (`isError: true`); the server process never crashes on a failed call.

## Testing

- **Unit (vitest, mocked fetch):** client (auth header construction, Accept headers, error mapping incl. 401/403/timeout), search filtering (query/brand/tag/in-stock, pagination), HTML-to-text stripping, CSV parser (semicolons inside quoted fields, header-driven mapping, empty file), period validation.
- **Manual smoke:** `scripts/smoke.ts` runs each tool once against the live API using real env credentials and prints compact results. Not part of CI; run by the user to verify end-to-end.

## Success criteria

- `npm run build` and `npm test` pass.
- Server registers in Claude Code via `claude mcp add` with env vars and all 8 tools respond against the live API (verified via smoke script).
- No tool response exceeds a few thousand tokens for typical inputs.

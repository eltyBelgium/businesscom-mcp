# Read-Only Order Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three read-only order tools — `list_orders`, `get_order`, `get_order_serials` — to the BusinessCom MCP server. POST /orders (order creation) stays out, permanently: the server must remain unable to place or modify anything.

**Architecture:** Same layering as the existing 8 tools: typed client methods in `src/client.ts` (GET /orders, /orders/{id}, /orders/{id}/serials — see docs/api-reference.md "Orders"), pure shaping/filtering in a new `src/orders.ts`, registration in `src/server.ts`. Tool-count assertions move 8→11 in `test/server.test.ts` AND `scripts/check-remote.ts` (EXPECTED list). Spec change is recorded by this plan + a spec addendum note; user approved "Read-only orders" explicitly on 2026-08-05.

**User decision log:** original "no orders" scope is amended to "read-only orders, never create". README wording ("No orders — cannot place or modify anything") must be updated to say ordering/creation is impossible but order *viewing* exists.

**Conventions:** repo root, branch `feature/order-tools` (controller creates), strict TDD, mocked fetch only in tests, commit per task. Money objects `{amount, currency}` pass through as-is. Doc reference for exact response shapes: docs/api-reference.md sections "GET /orders", "GET /orders/{orderId}", "GET /orders/{orderId}/serials".

---

### Task 1: Client methods + types

**Files:** Modify `src/types.ts`, `src/client.ts`; Test `test/client.test.ts` (extend)

- [ ] Add to `src/types.ts` (shapes from docs/api-reference.md):

```ts
export interface Money {
  amount: string
  currency: string
}

export interface OrderLineItem {
  productId: { seller: string; buyer: string | null; manufacturer: string | null }
  description: string
  orderedQuantity: number
  assignedQuantity: number
  deliveryDate: string | null
  price: Money
  totalPrice: Money
  status: { id: number; description: string }
  uniqueIds: { serialIds: string[]; macIds: string[]; imei1Ids: string[] }
}

export interface Order {
  orderId: number
  invoiceId: number | null
  orderDate: string
  invoiceDate: string | null
  orderReference: string
  remark: string | null
  partialDeliveryAllowed: boolean
  dropShipmentRequired: boolean
  orderStatus: { id: number; description: string }
  deliveryOptionCode: string
  deliveryOptionCost: Money
  orderFee: Money
  vatTotal: Money
  endTotal: Money
  shipTo: {
    businessName: string
    contactName: string
    address: string
    postalCode: string
    city: string
    countryCode: string
  } | null
  billTo: Record<string, unknown> | null
  trackAndTrace: { carrierId: string; trackingId: string; trackingUrl: string } | null
  productLineItems: OrderLineItem[]
}

/** Flat legacy shape returned by GET /orders/{id}/serials (one row per line item). */
export interface OrderSerialsRow {
  orderNumber: number
  orderDate: string
  invoiceNumber: string | null
  invoiceDate: string | null
  invoiceAmount: string | null
  deliveryDate: string | null
  orderReference: string | null
  remark: string | null
  lineNumber: number
  productId: string
  description: string
  orderedQty: number
  deliveredQty: number
  netPrice: number
  lineTotal: number
  serials: string[]
  macAddresses: string[]
  imei1: string[]
  [extra: string]: unknown
}
```

- [ ] TDD: extend `test/client.test.ts` with tests asserting: `getOrders()` GETs `{base}/orders` and unwraps the `{ orders: [...] }` envelope to `Order[]`; `getOrder(123)` GETs `/orders/123` and unwraps `{ order: [ ... ] }` (note: array!) to a single `Order` (throws BusinessComError if the array is empty); `getOrderSerials(123)` GETs `/orders/123/serials` returning `OrderSerialsRow[]`; a 404 on `getOrder`/`getOrderSerials` maps to `Unknown orderId "123"`. Use the existing stubFetch helper. RED first.
- [ ] Implement in `src/client.ts`: add the three methods to `BusinessComApi` and `BusinessComClient` via the existing `requestJson` helper (plain JSON accept). `encodeURIComponent` the id. NO method for POST /orders — grep the diff to confirm the string "POST" never appears.
- [ ] `npm test` green, `npx tsc --noEmit` + `npm run typecheck:worker` clean, commit `feat: read-only order endpoints in API client`.

### Task 2: Order shaping logic (`src/orders.ts`)

**Files:** Create `src/orders.ts`; Test `test/orders.test.ts`

- [ ] TDD pure functions:

```ts
summarizeOrder(o: Order)  // -> { order_id, order_date, order_reference, status,
                          //      end_total, ship_to_business, tracking_url, invoice_id }
listOrders(orders: Order[], f: { query?: string; status?: string; limit: number; offset: number })
  // query: case-insensitive substring on orderReference + orderId + shipTo.businessName;
  // status: case-insensitive exact match on orderStatus.description;
  // sort orderDate desc then orderId desc; paginate AFTER sort; returns { total_matches, results }
orderDetail(o: Order)     // full shape, field names kept, plus status flattened to description
                          // strings alongside ids (LLM-friendly), line items passed through
serialsReport(rows: OrderSerialsRow[]) // -> { order: { order_number, order_date, order_reference,
                          //      delivery_date, invoice_number }, lines: [{ line_number, product_id,
                          //      description, ordered_qty, delivered_qty, serials, mac_addresses,
                          //      imei1 }] } (order header from first row; empty rows -> null order, [] lines)
```

Cover: query/status filters, sort order with equal dates (orderId desc tie-break), pagination, empty serials rows, missing shipTo/trackAndTrace (null-safe).
- [ ] `npm test` green, typechecks clean, commit `feat: order listing and serials shaping logic`.

### Task 3: Tools, wiring, count updates, README

**Files:** Modify `src/server.ts`, `test/server.test.ts`, `scripts/check-remote.ts`, `README.md`

- [ ] Register three tools in `createServer` (same try/fail pattern as the rest):
  - `list_orders` — desc "List orders placed in the last 30 days (read-only)"; inputs `query?`, `status?` (describe: e.g. invoiced, shipped), `limit` 1-100 default 20, `offset` ≥0 default 0; handler: `listOrders(await api.getOrders(), args)`.
  - `get_order` — input `order_id: z.string()`; handler: `orderDetail(await api.getOrder(order_id))`.
  - `get_order_serials` — input `order_id: z.string()`; handler: `serialsReport(await api.getOrderSerials(order_id))`.
- [ ] Update `test/server.test.ts`: fakeApi gains the three methods (fixture data incl. one order with serials); tool-list assertion becomes the 11 sorted names; add tests: list_orders returns compact rows; get_order returns detail with status description; get_order_serials returns lines; unknown order id → isError.
- [ ] Update `scripts/check-remote.ts` EXPECTED to the 11 sorted names.
- [ ] README: tools table + the "No orders" wording → "Ordering is impossible — the server exposes read-only order viewing (list/details/serials) and cannot place or modify anything."
- [ ] Add one line to `docs/superpowers/specs/2026-08-02-oauth-and-ci-design.md`? NO — instead append an addendum note to `docs/superpowers/specs/2026-07-19-businesscom-mcp-design.md` under Scope: "Amended 2026-08-05: read-only order tools (list/get/serials) added by user decision; POST /orders remains permanently excluded."
- [ ] Full verification: `npm test` green; `npm run build` + `npm run typecheck:worker` clean; wrangler dev + `npm run check:remote -- http://localhost:8787/mcp` → `tools (11): ...` + `remote check OK` (kill dev after).
- [ ] Commit `feat: read-only order tools (list, detail, serials)`.

### Task 4: Ship

- [ ] Controller merges to main, pushes (CI runs tests; deploys if secrets set — otherwise `npx wrangler deploy` locally), verifies production `/mcp` still gated and, with the user's service token, 11 tools.

## Post-plan verification

`check:remote` shows 11 tools; a real `list_orders` call via Claude Code returns actual orders; grep confirms no POST anywhere in src/.

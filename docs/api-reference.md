# BusinessCom API v1 — Reference

Condensed from https://www.businesscom.nl/api/docs/home (partner login required), captured 2026-07-19.

## Base URL

```
https://www.businesscom.nl/api/v1
```

## Authentication

HTTP **Basic Auth** on every request. Account must have API privileges.

- Username = portal login name
- Password = portal password **or** an API key (recommended — request one from BusinessCom so the integration doesn't break on password changes)

## Response formats

Most catalog endpoints support JSON (default), XML, and CSV — via URL extension (`products.json`) or `Accept` header (`application/json`, `application/xml`, `text/csv`). My-Connect invoice/CDR endpoints return CSV only.

---

## Products

### GET /products

All products in the catalogue. Data refreshed daily before 6am.

Recommended header (enables multi-image `media[]` array; the call without it is deprecated):

```
Accept: application/vnd.businesscom.products.v202306+json
```

Response item fields: `product_id` (string, BusinessCom ref, max 20), `manufacturer_id`, `brand_id`, `brand`, `brand_logo`, `name`, `description_html` (plain HTML), `retail_price` (RRP — reseller price comes from /prices), `stock_status_code` (-1 n/a, 0 none, 1 limited, 2 sufficient; daily snapshot — use /stock for live), `lead_time` (days), `category_id`, `category_name`, `sub_category_id`, `sub_category_name`, `tags` (comma list: EOL, NEW, PROMO, STOCKPROMO, VOLUME, REF, ENKEL_DEMO_UNIT, OOK_DEMO_UNIT), `remarks`, `my_shop_jn` ("J"/"N" — suitable for reseller's own shop), `ean_code`, `popularity_ranking`, `media[]` ({id, file_extension, updated_at}).

Product image URL: `https://businesscom.nl/shop-product-media/{media.id}.jpg`
(deprecated single-image variant: `https://businesscom.nl/shop-product-images/{image_id}.jpg`)

## Prices

### GET /prices

Reseller prices for all products — includes promotions and your personal terms/discounts. Refreshed daily before 6am.

Response: `[{ "product_id": "ABC-123", "price": 9.99 }]`

## Stock

### GET /stock

Live stock for all products. Optional header adds exact quantity + lead time:

```
Accept: application/vnd.businesscom.stock.v20160215+json
```

Response: `product_id`, `stock_status_code` (-1/0/1/2), with header also `stock_quantity` (max 250, null if n/a), `lead_time`.

### GET /stock/{product_id}

Live stock for one product. Always returns `product_id`, `stock_status_code`, `stock_quantity`, `lead_time`.

## Product relations

### GET /productRelations

Accessory/related-product pairs. Refreshed daily before 6am.

Response: `[{ "product_id": "ABC-123", "related_product_id": "XYZ-456" }]`

## Orders

### GET /orders

All orders placed up to 30 days back. Response: `{ "orders": [ ... ] }` with per order:
`orderId`, `invoiceId`, `orderDate` (YYYY-MM-DD), `invoiceDate`, `orderReference`, `remark`, `partialDeliveryAllowed`, `dropShipmentRequired`, `orderStatus {id, description}`, `deliveryOptionCode` (BALIE, DHL, DHL1, PNL01, PNL02, PNL32), `deliveryOptionCost {amount, currency}`, `orderFee`, `vatTotal`, `endTotal`, `shipTo {businessName, contactName, address, postalCode, city, countryCode}`, `billTo {...}`, `trackAndTrace {carrierId, trackingId, trackingUrl}`, `productLineItems[]` (`productId {seller, buyer, manufacturer}`, `description`, `orderedQuantity`, `assignedQuantity`, `deliveryDate`, `price`, `totalPrice`, `status {id, description}`, `uniqueIds {serialIds[], macIds[], imei1Ids[]}`).

All money objects are `{ "amount": "0.00", "currency": "EUR" }` (EUR only).

### GET /orders/{orderId}

Same shape as above, single order wrapped in `{ "order": [ ... ] }`.

### GET /orders/{orderId}/serials

Serials/MACs/IMEIs per order line (flat legacy shape): `orderNumber`, `orderDate` (YYYYMMDD), `invoiceNumber`, `invoiceDate`, `invoiceAmount`, `vatAmount`, `transportOptionCode`, `transportOptionCost`, shipTo* fields, `dropShipmentRequired` ("J"/"N"), `deliveryDate`, `remark`, `orderReference`, `orderFee`, `paymentTerms`, `lineNumber`, `productId`, `description`, `orderedQty`, `deliveredQty`, `netPrice`, `lineTotal`, `serials[]`, `macAddresses[]`, `imei1[]`.

### POST /orders

Place an order. Body: `{ "order": { ... } }`

- `orderReference` (string, max 100) — **required**
- `productLineItems[]` — **required**, ≥1 item:
  - `productId.seller` (BusinessCom product ref) — **required**
  - `price {amount, currency}` — optional; if submitted it is validated against the current price and the order is **rejected on mismatch** (error includes current valid price). Omit to accept current price.
  - `quantity` (1–9999) — **required**
- `orderFrom {globalBusinessIdentifier (GLN, 13 digits), businessName, contactName, emailAddress, telephoneNumber}` — optional
- `extraOrderReference` — optional, appears on delivery slip (end-user ref)
- `offerReference` — optional, Special Bid ("bcom"+digits) or Quote (digits); products/prices/quantities must match the bid/quote
- `remark` (max 255) — optional, read by sales dept
- `requestedShipDate` (YYYY-MM-DD) — optional; if omitted and all in stock, ships same day when ordered before 10pm
- `dropShipmentRequired` (default false), `partialDeliveryAllowed` (default false)
- `deliveryOptionCode` — BALIE | DHL | DHL1 | PNL01 (default) | PNL02 | PNL32; BALIE = pickup at warehouse
- `shipFrom {globalBusinessIdentifier, code}` — optional, use with dropShipmentRequired=true; codes from GET /shipFromAddresses
- `shipTo` — required unless deliveryOptionCode=BALIE; either `globalBusinessIdentifier` (GLN) alone, or `code` alone, or full address (`businessName`, `contactName`, `address`, `postalCode`, `city`, `countryCode` all required)

Response: `{ "orderId": "1234567", "orderReference": "ref-001" }`

### GET /shipFromAddresses

Returns the predefined shipFrom codes (referenced by the order-create docs; not in the docs nav).

## My-Connect

Requires extra user rights on the account.

### GET /myconnect/invoices/{period}[/purchases|/sales]

CSV invoice for period `MMYYYY`. Default variant: purchases. Columns are configurable on the My-Connect portal settings page. Example columns: InvoiceNumber, InvoiceDate (YYYYMMDD), YourContractReference, LineNumber, ProductId, ProductName, Quantity, Price, LineAmount, InvoicePeriod (YYYYMM), Headquarters, OurCustomerReference, OurContractReference, CompanyName, YourCustomerReference, CostType (variabel|eenmalig|periodiek), ProxyId.

### GET /myconnect/cdr

CSV call-detail-record totals. No params = last month grouped by customer.

Query params: `period` (MMYYYY), `grouping` (customer|trunk|number, default customer), `totals-per-destination` (bool, default false), `decimal-separator` (period|comma, default period).

Columns: InvoicePeriod, CompanyName, YourCustomerReference, OurCustomerReference, MainCustomer, YourMainCustomerReference, OurMainCustomerReference, PurchaseAmount, SalesAmount, Minutes, Calls.

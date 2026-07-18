# BusinessCom MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stateless TypeScript MCP server (stdio) exposing 8 read-only tools over the BusinessCom distributor API: catalog search/detail/prices/stock/relations/categories plus My-Connect invoices and CDR.

**Architecture:** Thin live-fetching server — no DB, no cache. `src/client.ts` wraps the HTTP API (basic auth, versioned Accept headers, error mapping); pure logic modules (`catalog.ts`, `csv.ts`, `html.ts`, `myconnect.ts`) do in-process filtering/parsing; `src/server.ts` registers the tools on an `McpServer`; `src/index.ts` is a tiny env-reading bootstrap. Spec: `docs/superpowers/specs/2026-07-19-businesscom-mcp-design.md`. API details: `docs/api-reference.md`.

**Tech Stack:** Node ≥18 (native `fetch`), TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` ^1.x, `zod` ^3, `vitest`, `tsx`.

**Conventions for every task:** run commands from the repo root `/Users/tl/Projects/Elty/businesscom-mcp`. Tests never hit the live API — `fetch` is always mocked. Commit after each green task.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "businesscom-mcp",
  "version": "0.1.0",
  "description": "MCP server for the BusinessCom distributor API (catalog + My-Connect, read-only)",
  "type": "module",
  "bin": { "businesscom-mcp": "dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "smoke": "tsx scripts/smoke.ts"
  },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Create `src/types.ts`** — the API response shapes (from `docs/api-reference.md`)

```ts
/** Product from GET /products with the v202306 Accept header. */
export interface ProductMedia {
  id: string
  file_extension: string
  updated_at: string
}

export interface Product {
  product_id: string
  manufacturer_id: string | null
  brand_id: number
  brand: string
  brand_logo: number | null
  name: string
  description_html: string
  retail_price: number | null
  /** -1 n/a, 0 none, 1 limited, 2 sufficient (daily snapshot; /stock is live) */
  stock_status_code: number
  lead_time: number | null
  category_id: number
  category_name: string
  sub_category_id: number
  sub_category_name: string
  /** comma-separated: EOL, NEW, PROMO, STOCKPROMO, VOLUME, REF, ... */
  tags: string
  remarks: string | null
  my_shop_jn: 'J' | 'N'
  ean_code: number | null
  popularity_ranking: number
  media?: ProductMedia[]
}

export interface Price {
  product_id: string
  price: number
}

/** From GET /stock (v20160215 header) or GET /stock/{id}. */
export interface StockItem {
  product_id: string
  stock_status_code: number
  stock_quantity?: number | null
  lead_time?: number | null
}

export interface ProductRelation {
  product_id: string
  related_product_id: string
}
```

- [ ] **Step 6: Install and verify build**

Run: `npm install && npx tsc --noEmit`
Expected: install succeeds; tsc exits 0 (types.ts only, no errors).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/types.ts
git commit -m "chore: scaffold TypeScript MCP server project"
```

---

### Task 2: CSV parser (`src/csv.ts`)

My-Connect endpoints return semicolon-delimited CSV with a header row; invoice columns are user-configurable in the portal, so parsing must be header-driven.

**Files:**
- Create: `src/csv.ts`
- Test: `test/csv.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/csv.test.ts
import { describe, it, expect } from 'vitest'
import { parseSemicolonCsv } from '../src/csv.js'

describe('parseSemicolonCsv', () => {
  it('maps rows to objects keyed by the header row', () => {
    const csv = '"A";"B"\n"1";"2"\n"3";"4"'
    expect(parseSemicolonCsv(csv)).toEqual([
      { A: '1', B: '2' },
      { A: '3', B: '4' },
    ])
  })

  it('keeps semicolons and newlines inside quoted fields', () => {
    const csv = '"Name";"Note"\n"Acme; BV";"line1\nline2"'
    expect(parseSemicolonCsv(csv)).toEqual([{ Name: 'Acme; BV', Note: 'line1\nline2' }])
  })

  it('unescapes doubled quotes', () => {
    const csv = '"A"\n"say ""hi"""'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: 'say "hi"' }])
  })

  it('handles CRLF line endings and a trailing newline', () => {
    const csv = '"A";"B"\r\n"1";"2"\r\n'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: '1', B: '2' }])
  })

  it('handles unquoted fields', () => {
    const csv = 'A;B\n1;2'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: '1', B: '2' }])
  })

  it('returns [] for empty input or header-only input', () => {
    expect(parseSemicolonCsv('')).toEqual([])
    expect(parseSemicolonCsv('"A";"B"\n')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/csv.test.ts`
Expected: FAIL — cannot resolve `../src/csv.js`.

- [ ] **Step 3: Implement `src/csv.ts`**

```ts
/**
 * Parse semicolon-delimited CSV (as returned by the My-Connect endpoints)
 * into objects keyed by the header row. Handles quoted fields containing
 * semicolons/newlines and doubled-quote escapes. Header-driven on purpose:
 * invoice columns are configurable in the My-Connect portal.
 */
export function parseSemicolonCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text)
  if (rows.length < 2) return []
  const [header, ...data] = rows
  return data
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let sawAny = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    sawAny = true
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (sawAny && (field !== '' || row.length > 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/csv.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/csv.ts test/csv.test.ts
git commit -m "feat: semicolon-CSV parser for My-Connect responses"
```

---

### Task 3: HTML-to-text (`src/html.ts`)

`description_html` can be enormous (docs allow up to 20 MB); `get_product` returns it as truncated plain text.

**Files:**
- Create: `src/html.ts`
- Test: `test/html.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/html.test.ts
import { describe, it, expect } from 'vitest'
import { htmlToText } from '../src/html.js'

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('turns block-level closers and <br> into newlines', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\ntwo')
    expect(htmlToText('one<br>two')).toBe('one\ntwo')
  })

  it('decodes common entities', () => {
    expect(htmlToText('Tom &amp; Jerry &euro;5 &lt;ok&gt;')).toBe('Tom & Jerry €5 <ok>')
    expect(htmlToText('&#8364;10')).toBe('€10')
  })

  it('collapses runs of whitespace', () => {
    expect(htmlToText('a   b\n\n\nc')).toBe('a b\nc')
  })

  it('truncates to maxLength with an ellipsis', () => {
    expect(htmlToText('x'.repeat(50), 10)).toBe('x'.repeat(10) + '…')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/html.test.ts`
Expected: FAIL — cannot resolve `../src/html.js`.

- [ ] **Step 3: Implement `src/html.ts`**

```ts
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
}

/** Convert product description HTML to compact plain text, truncated for LLM use. */
export function htmlToText(html: string, maxLength = 4000): string {
  const text = html
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/html.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/html.ts test/html.test.ts
git commit -m "feat: html-to-text conversion for product descriptions"
```

---

### Task 4: API client (`src/client.ts`)

**Files:**
- Create: `src/client.ts`
- Test: `test/client.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BusinessComClient, BusinessComError } from '../src/client.js'

function stubFetch(status: number, body: string) {
  const fn = vi.fn().mockResolvedValue(new Response(body, { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const make = () => new BusinessComClient({ username: 'user', password: 'secret' })

describe('BusinessComClient', () => {
  it('sends basic auth and the versioned products Accept header', async () => {
    const fn = stubFetch(200, '[]')
    await make().getProducts()
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.businesscom.nl/api/v1/products')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('user:secret').toString('base64'))
    expect(headers.Accept).toBe('application/vnd.businesscom.products.v202306+json')
  })

  it('sends the versioned stock Accept header for the stock dump', async () => {
    const fn = stubFetch(200, '[]')
    await make().getStockAll()
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Accept).toBe(
      'application/vnd.businesscom.stock.v20160215+json',
    )
  })

  it('respects a baseUrl override and strips its trailing slash', async () => {
    const fn = stubFetch(200, '[]')
    const client = new BusinessComClient({
      username: 'u',
      password: 'p',
      baseUrl: 'http://localhost:9999/api/v1/',
    })
    await client.getPrices()
    expect(fn.mock.calls[0][0]).toBe('http://localhost:9999/api/v1/prices')
  })

  it('maps 401 to an actionable credentials error', async () => {
    stubFetch(401, '')
    await expect(make().getPrices()).rejects.toThrow(/BUSINESSCOM_USERNAME/)
  })

  it('maps 403 on /myconnect to a rights error', async () => {
    stubFetch(403, '')
    await expect(make().getInvoiceCsv('062026', 'purchases')).rejects.toThrow(/My-Connect/)
  })

  it('maps 404 from getStockOne to unknown product_id', async () => {
    stubFetch(404, '')
    await expect(make().getStockOne('NOPE')).rejects.toThrow(/Unknown product_id "NOPE"/)
  })

  it('includes status and a body snippet for other errors', async () => {
    stubFetch(500, 'kaboom'.repeat(100))
    const err = await make().getProducts().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BusinessComError)
    expect((err as BusinessComError).status).toBe(500)
    expect((err as BusinessComError).message).toContain('HTTP 500')
    expect((err as BusinessComError).message.length).toBeLessThan(400)
  })

  it('maps timeouts to a BusinessComError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })),
    )
    await expect(make().getProducts()).rejects.toThrow(/timed out/)
  })

  it('builds the CDR query string with the fixed decimal separator', async () => {
    const fn = stubFetch(200, '')
    await make().getCdrCsv({ period: '052026', grouping: 'trunk', totalsPerDestination: true })
    const url = new URL(fn.mock.calls[0][0] as string)
    expect(url.pathname.endsWith('/myconnect/cdr')).toBe(true)
    expect(url.searchParams.get('decimal-separator')).toBe('period')
    expect(url.searchParams.get('period')).toBe('052026')
    expect(url.searchParams.get('grouping')).toBe('trunk')
    expect(url.searchParams.get('totals-per-destination')).toBe('true')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/client.test.ts`
Expected: FAIL — cannot resolve `../src/client.js`.

- [ ] **Step 3: Implement `src/client.ts`**

```ts
import type { Price, Product, ProductRelation, StockItem } from './types.js'

export class BusinessComError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'BusinessComError'
  }
}

export interface ClientConfig {
  username: string
  password: string
  baseUrl?: string
  timeoutMs?: number
}

/** The surface the MCP tools depend on — lets tests substitute a fake. */
export interface BusinessComApi {
  getProducts(): Promise<Product[]>
  getPrices(): Promise<Price[]>
  getStockAll(): Promise<StockItem[]>
  getStockOne(productId: string): Promise<StockItem>
  getProductRelations(): Promise<ProductRelation[]>
  getInvoiceCsv(period: string, type: 'purchases' | 'sales'): Promise<string>
  getCdrCsv(opts: { period?: string; grouping?: string; totalsPerDestination?: boolean }): Promise<string>
}

const DEFAULT_BASE_URL = 'https://www.businesscom.nl/api/v1'
const PRODUCTS_ACCEPT = 'application/vnd.businesscom.products.v202306+json'
const STOCK_ACCEPT = 'application/vnd.businesscom.stock.v20160215+json'

export class BusinessComClient implements BusinessComApi {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly timeoutMs: number

  constructor(cfg: ClientConfig) {
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.authHeader = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')
    this.timeoutMs = cfg.timeoutMs ?? 60_000
  }

  private async request(path: string, accept = 'application/json'): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, {
        headers: { Authorization: this.authHeader, Accept: accept },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new BusinessComError(`Request to ${path} timed out after ${this.timeoutMs / 1000}s`)
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw new BusinessComError(`Network error requesting ${path}: ${detail}`)
    }
    if (!res.ok) throw await this.toError(res, path)
    return res
  }

  private async toError(res: Response, path: string): Promise<BusinessComError> {
    if (res.status === 401) {
      return new BusinessComError(
        'Authentication failed — check BUSINESSCOM_USERNAME / BUSINESSCOM_PASSWORD and that the account has API privileges.',
        401,
      )
    }
    if (res.status === 403 && path.startsWith('/myconnect')) {
      return new BusinessComError(
        'Account lacks My-Connect API rights (extra user rights required).',
        403,
      )
    }
    let snippet = ''
    try {
      snippet = (await res.text()).slice(0, 300)
    } catch {
      // body unreadable; report status only
    }
    return new BusinessComError(
      `BusinessCom API returned HTTP ${res.status} for ${path}${snippet ? `: ${snippet}` : ''}`,
      res.status,
    )
  }

  async getProducts(): Promise<Product[]> {
    return (await this.request('/products', PRODUCTS_ACCEPT)).json() as Promise<Product[]>
  }

  async getPrices(): Promise<Price[]> {
    return (await this.request('/prices')).json() as Promise<Price[]>
  }

  async getStockAll(): Promise<StockItem[]> {
    return (await this.request('/stock', STOCK_ACCEPT)).json() as Promise<StockItem[]>
  }

  async getStockOne(productId: string): Promise<StockItem> {
    try {
      return (await (
        await this.request(`/stock/${encodeURIComponent(productId)}`)
      ).json()) as StockItem
    } catch (err) {
      if (err instanceof BusinessComError && err.status === 404) {
        throw new BusinessComError(`Unknown product_id "${productId}"`, 404)
      }
      throw err
    }
  }

  async getProductRelations(): Promise<ProductRelation[]> {
    return (await this.request('/productRelations')).json() as Promise<ProductRelation[]>
  }

  async getInvoiceCsv(period: string, type: 'purchases' | 'sales'): Promise<string> {
    return (await this.request(`/myconnect/invoices/${period}/${type}`, 'text/csv')).text()
  }

  async getCdrCsv(opts: {
    period?: string
    grouping?: string
    totalsPerDestination?: boolean
  }): Promise<string> {
    const params = new URLSearchParams({ 'decimal-separator': 'period' })
    if (opts.period) params.set('period', opts.period)
    if (opts.grouping) params.set('grouping', opts.grouping)
    if (opts.totalsPerDestination !== undefined) {
      params.set('totals-per-destination', String(opts.totalsPerDestination))
    }
    return (await this.request(`/myconnect/cdr?${params}`)).text()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/client.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts test/client.test.ts
git commit -m "feat: BusinessCom API client with basic auth and error mapping"
```

---

### Task 5: Catalog logic (`src/catalog.ts`)

Pure functions over fetched data — no I/O, fully unit-testable.

**Files:**
- Create: `src/catalog.ts`
- Test: `test/catalog.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/catalog.test.ts
import { describe, it, expect } from 'vitest'
import {
  searchProducts,
  summarizeProduct,
  productDetail,
  relatedProducts,
  listCategories,
} from '../src/catalog.js'
import type { Product } from '../src/types.js'

function product(overrides: Partial<Product>): Product {
  return {
    product_id: 'P1',
    manufacturer_id: 'M1',
    brand_id: 1,
    brand: 'Yealink',
    brand_logo: null,
    name: 'T31P IP Phone',
    description_html: '<p>desc</p>',
    retail_price: 59.0,
    stock_status_code: 2,
    lead_time: 1,
    category_id: 1,
    category_name: 'Phones',
    sub_category_id: 11,
    sub_category_name: 'Desk phones',
    tags: 'NEW,PROMO',
    remarks: null,
    my_shop_jn: 'J',
    ean_code: 1234567890123,
    popularity_ranking: 5,
    media: [{ id: 'abc123', file_extension: 'jpg', updated_at: '01/01/2026 00:00:00+00:00' }],
    ...overrides,
  }
}

const catalog = [
  product({}),
  product({ product_id: 'P2', name: 'W73P DECT', brand: 'Gigaset', category_name: 'DECT', sub_category_name: 'Handsets', tags: 'EOL', stock_status_code: 0, popularity_ranking: 9 }),
  product({ product_id: 'P3', name: 'Headset Pro', brand: 'Yealink', category_name: 'Headsets', sub_category_name: 'Wired', tags: '', stock_status_code: 1, popularity_ranking: 1, ean_code: null }),
]

describe('searchProducts', () => {
  it('matches query against id, manufacturer id, name and EAN, case-insensitively', () => {
    expect(searchProducts(catalog, { query: 'dect', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { query: 'p3', limit: 20, offset: 0 }).total_matches).toBe(1)
    // P1 and P2 share the default EAN; P3 has ean_code: null
    expect(searchProducts(catalog, { query: '1234567890123', limit: 20, offset: 0 }).total_matches).toBe(2)
  })

  it('filters by brand, category (main or sub), tag and stock', () => {
    expect(searchProducts(catalog, { brand: 'yealink', limit: 20, offset: 0 }).total_matches).toBe(2)
    expect(searchProducts(catalog, { category: 'handsets', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { tag: 'eol', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { in_stock_only: true, limit: 20, offset: 0 }).total_matches).toBe(2)
  })

  it('sorts by popularity and paginates, reporting total_matches', () => {
    const page = searchProducts(catalog, { limit: 2, offset: 0 })
    expect(page.total_matches).toBe(3)
    expect(page.results.map((r) => r.product_id)).toEqual(['P2', 'P1'])
    const page2 = searchProducts(catalog, { limit: 2, offset: 2 })
    expect(page2.results.map((r) => r.product_id)).toEqual(['P3'])
  })

  it('never includes descriptions in results', () => {
    const { results } = searchProducts(catalog, { limit: 20, offset: 0 })
    for (const r of results) expect(r).not.toHaveProperty('description_html')
  })
})

describe('summarizeProduct', () => {
  it('returns compact fields with a stock label', () => {
    expect(summarizeProduct(product({}))).toEqual({
      product_id: 'P1',
      name: 'T31P IP Phone',
      brand: 'Yealink',
      category_name: 'Phones',
      sub_category_name: 'Desk phones',
      retail_price: 59.0,
      stock_status: 'sufficient stock',
      lead_time: 1,
      tags: 'NEW,PROMO',
    })
  })
})

describe('productDetail', () => {
  it('merges reseller price and live stock, strips html, builds media urls', () => {
    const detail = productDetail(product({}), 42.5, {
      product_id: 'P1',
      stock_status_code: 2,
      stock_quantity: 12,
      lead_time: 1,
    })
    expect(detail.description).toBe('desc')
    expect(detail.reseller_price).toBe(42.5)
    expect(detail.stock).toEqual({ status: 'sufficient stock', quantity: 12, lead_time: 1 })
    expect(detail.media_urls).toEqual(['https://businesscom.nl/shop-product-media/abc123.jpg'])
    expect(detail.suitable_for_own_shop).toBe(true)
  })

  it('tolerates missing price and stock', () => {
    const detail = productDetail(product({}), null, null)
    expect(detail.reseller_price).toBeNull()
    expect(detail.stock).toBeNull()
  })
})

describe('relatedProducts', () => {
  it('joins related ids with catalog data and keeps unknown ids', () => {
    const rels = [
      { product_id: 'P1', related_product_id: 'P3' },
      { product_id: 'P1', related_product_id: 'GONE' },
      { product_id: 'P2', related_product_id: 'P1' },
    ]
    const out = relatedProducts(rels, catalog, 'P1')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ product_id: 'P3', name: 'Headset Pro' })
    expect(out[1]).toEqual({ product_id: 'GONE' })
  })
})

describe('listCategories', () => {
  it('returns categories with subcategories and counts, plus distinct brands', () => {
    const out = listCategories(catalog)
    expect(out.brands).toEqual(['Gigaset', 'Yealink'])
    const phones = out.categories.find((c) => c.name === 'Phones')
    expect(phones).toEqual({ name: 'Phones', product_count: 1, subcategories: ['Desk phones'] })
    expect(out.categories).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/catalog.test.ts`
Expected: FAIL — cannot resolve `../src/catalog.js`.

- [ ] **Step 3: Implement `src/catalog.ts`**

```ts
import { htmlToText } from './html.js'
import type { Product, ProductRelation, StockItem } from './types.js'

export const STOCK_LABELS: Record<number, string> = {
  [-1]: 'not applicable',
  0: 'no stock',
  1: 'limited stock',
  2: 'sufficient stock',
}

export interface SearchFilters {
  query?: string
  brand?: string
  category?: string
  tag?: string
  in_stock_only?: boolean
  limit: number
  offset: number
}

export interface ProductSummary {
  product_id: string
  name: string
  brand: string
  category_name: string
  sub_category_name: string
  retail_price: number | null
  stock_status: string
  lead_time: number | null
  tags: string
}

export function summarizeProduct(p: Product): ProductSummary {
  return {
    product_id: p.product_id,
    name: p.name,
    brand: p.brand,
    category_name: p.category_name,
    sub_category_name: p.sub_category_name,
    retail_price: p.retail_price,
    stock_status: STOCK_LABELS[p.stock_status_code] ?? `unknown (${p.stock_status_code})`,
    lead_time: p.lead_time,
    tags: p.tags,
  }
}

export function searchProducts(products: Product[], f: SearchFilters) {
  const q = f.query?.toLowerCase()
  const matches = products.filter((p) => {
    if (q) {
      const hay = `${p.product_id} ${p.manufacturer_id ?? ''} ${p.name} ${p.ean_code ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.brand && p.brand.toLowerCase() !== f.brand.toLowerCase()) return false
    if (
      f.category &&
      p.category_name.toLowerCase() !== f.category.toLowerCase() &&
      p.sub_category_name.toLowerCase() !== f.category.toLowerCase()
    ) {
      return false
    }
    if (f.tag) {
      const tags = p.tags.split(',').map((t) => t.trim().toLowerCase())
      if (!tags.includes(f.tag.toLowerCase())) return false
    }
    if (f.in_stock_only && p.stock_status_code <= 0) return false
    return true
  })
  matches.sort((a, b) => b.popularity_ranking - a.popularity_ranking)
  return {
    total_matches: matches.length,
    results: matches.slice(f.offset, f.offset + f.limit).map(summarizeProduct),
  }
}

export function productDetail(p: Product, resellerPrice: number | null, stock: StockItem | null) {
  return {
    ...summarizeProduct(p),
    manufacturer_id: p.manufacturer_id,
    ean_code: p.ean_code,
    description: htmlToText(p.description_html),
    reseller_price: resellerPrice,
    stock: stock
      ? {
          status: STOCK_LABELS[stock.stock_status_code] ?? `unknown (${stock.stock_status_code})`,
          quantity: stock.stock_quantity ?? null,
          lead_time: stock.lead_time ?? null,
        }
      : null,
    media_urls: (p.media ?? []).map(
      (m) => `https://businesscom.nl/shop-product-media/${m.id}.${m.file_extension}`,
    ),
    remarks: p.remarks,
    suitable_for_own_shop: p.my_shop_jn === 'J',
    popularity_ranking: p.popularity_ranking,
  }
}

export function relatedProducts(
  relations: ProductRelation[],
  products: Product[],
  productId: string,
): Array<ProductSummary | { product_id: string }> {
  const byId = new Map(products.map((p) => [p.product_id, p]))
  return relations
    .filter((r) => r.product_id === productId)
    .map((r) => {
      const p = byId.get(r.related_product_id)
      return p ? summarizeProduct(p) : { product_id: r.related_product_id }
    })
}

export function listCategories(products: Product[]) {
  const cats = new Map<string, { count: number; subs: Set<string> }>()
  const brands = new Set<string>()
  for (const p of products) {
    brands.add(p.brand)
    const entry = cats.get(p.category_name) ?? { count: 0, subs: new Set<string>() }
    entry.count++
    entry.subs.add(p.sub_category_name)
    cats.set(p.category_name, entry)
  }
  return {
    categories: [...cats.entries()]
      .map(([name, { count, subs }]) => ({
        name,
        product_count: count,
        subcategories: [...subs].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    brands: [...brands].sort(),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/catalog.test.ts`
Expected: all passed (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/catalog.ts test/catalog.test.ts
git commit -m "feat: catalog search, detail, relations and category logic"
```

---

### Task 6: My-Connect helpers (`src/myconnect.ts`)

**Files:**
- Create: `src/myconnect.ts`
- Test: `test/myconnect.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/myconnect.test.ts
import { describe, it, expect } from 'vitest'
import { isValidPeriod, paginate } from '../src/myconnect.js'

describe('isValidPeriod', () => {
  it('accepts MMYYYY', () => {
    expect(isValidPeriod('012026')).toBe(true)
    expect(isValidPeriod('122025')).toBe(true)
  })
  it('rejects bad months, lengths and non-digits', () => {
    expect(isValidPeriod('132026')).toBe(false)
    expect(isValidPeriod('002026')).toBe(false)
    expect(isValidPeriod('2026')).toBe(false)
    expect(isValidPeriod('2026-01')).toBe(false)
    expect(isValidPeriod('ab2026')).toBe(false)
  })
})

describe('paginate', () => {
  it('slices rows and reports the total', () => {
    const rows = [1, 2, 3, 4, 5]
    expect(paginate(rows, 2, 0)).toEqual({ total_rows: 5, rows: [1, 2] })
    expect(paginate(rows, 2, 4)).toEqual({ total_rows: 5, rows: [5] })
    expect(paginate(rows, 2, 10)).toEqual({ total_rows: 5, rows: [] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/myconnect.test.ts`
Expected: FAIL — cannot resolve `../src/myconnect.js`.

- [ ] **Step 3: Implement `src/myconnect.ts`**

```ts
/** Validate a My-Connect invoice/CDR period in MMYYYY format. */
export function isValidPeriod(period: string): boolean {
  if (!/^\d{6}$/.test(period)) return false
  const month = Number(period.slice(0, 2))
  return month >= 1 && month <= 12
}

export function paginate<T>(rows: T[], limit: number, offset: number) {
  return { total_rows: rows.length, rows: rows.slice(offset, offset + limit) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/myconnect.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/myconnect.ts test/myconnect.test.ts
git commit -m "feat: My-Connect period validation and pagination helpers"
```

---

### Task 7: MCP server wiring (`src/server.ts`, `src/index.ts`)

`createServer(api)` takes any `BusinessComApi`, so the test injects a fake — no network. `index.ts` is the only place that reads env.

**Files:**
- Create: `src/server.ts`, `src/index.ts`
- Test: `test/server.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/server.test.ts
import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/server.js'
import type { BusinessComApi } from '../src/client.js'
import type { Product } from '../src/types.js'

const sampleProduct: Product = {
  product_id: 'P1',
  manufacturer_id: 'M1',
  brand_id: 1,
  brand: 'Yealink',
  brand_logo: null,
  name: 'T31P IP Phone',
  description_html: '<p>desc</p>',
  retail_price: 59,
  stock_status_code: 2,
  lead_time: 1,
  category_id: 1,
  category_name: 'Phones',
  sub_category_id: 11,
  sub_category_name: 'Desk phones',
  tags: '',
  remarks: null,
  my_shop_jn: 'J',
  ean_code: null,
  popularity_ranking: 1,
  media: [],
}

const fakeApi: BusinessComApi = {
  getProducts: async () => [sampleProduct],
  getPrices: async () => [{ product_id: 'P1', price: 42.5 }],
  getStockAll: async () => [{ product_id: 'P1', stock_status_code: 2, stock_quantity: 9, lead_time: 1 }],
  getStockOne: async () => ({ product_id: 'P1', stock_status_code: 2, stock_quantity: 9, lead_time: 1 }),
  getProductRelations: async () => [{ product_id: 'P1', related_product_id: 'P2' }],
  getInvoiceCsv: async () => '"InvoiceNumber";"Price"\n"23028168";"0.00"',
  getCdrCsv: async () => '"InvoicePeriod";"Calls"\n"202410";"738"',
}

async function connect() {
  const server = createServer(fakeApi)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function firstText(res: Awaited<ReturnType<Client['callTool']>>): string {
  const content = res.content as Array<{ type: string; text: string }>
  return content[0].text
}

describe('businesscom MCP server', () => {
  it('registers exactly the 8 read-only tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_myconnect_cdr',
      'get_myconnect_invoice',
      'get_prices',
      'get_product',
      'get_related_products',
      'get_stock',
      'list_categories',
      'search_products',
    ])
  })

  it('search_products returns compact results', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'search_products', arguments: { query: 'T31P' } })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.total_matches).toBe(1)
    expect(parsed.results[0].product_id).toBe('P1')
  })

  it('get_product merges price and stock', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_product', arguments: { product_id: 'P1' } })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.reseller_price).toBe(42.5)
    expect(parsed.stock.quantity).toBe(9)
  })

  it('get_product returns isError for an unknown id', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_product', arguments: { product_id: 'NOPE' } })
    expect(res.isError).toBe(true)
  })

  it('get_myconnect_invoice parses CSV rows and rejects bad periods', async () => {
    const client = await connect()
    const ok = await client.callTool({
      name: 'get_myconnect_invoice',
      arguments: { period: '062026' },
    })
    expect(JSON.parse(firstText(ok)).rows[0].InvoiceNumber).toBe('23028168')
    const bad = await client.callTool({
      name: 'get_myconnect_invoice',
      arguments: { period: '992026' },
    })
    expect(bad.isError).toBe(true)
  })

  it('get_myconnect_cdr parses CSV rows', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_myconnect_cdr', arguments: {} })
    expect(JSON.parse(firstText(res)).rows[0].Calls).toBe('738')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — cannot resolve `../src/server.js`.

- [ ] **Step 3: Implement `src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { BusinessComApi } from './client.js'
import { BusinessComError } from './client.js'
import {
  STOCK_LABELS,
  listCategories,
  productDetail,
  relatedProducts,
  searchProducts,
} from './catalog.js'
import { parseSemicolonCsv } from './csv.js'
import { isValidPeriod, paginate } from './myconnect.js'
import type { StockItem } from './types.js'

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(err: unknown) {
  const message =
    err instanceof BusinessComError
      ? err.message
      : err instanceof Error
        ? `Unexpected error: ${err.message}`
        : 'Unknown error'
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const periodSchema = z
  .string()
  .refine(isValidPeriod, 'period must be MMYYYY, e.g. 062026 for June 2026')

export function createServer(api: BusinessComApi): McpServer {
  const server = new McpServer({ name: 'businesscom', version: '0.1.0' })

  server.registerTool(
    'search_products',
    {
      description:
        'Search the BusinessCom catalog. Returns compact product summaries (no descriptions). ' +
        'Use list_categories to discover valid brand/category filter values.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Matches product_id, manufacturer_id, name or EAN (case-insensitive substring)'),
        brand: z.string().optional().describe('Exact brand name, case-insensitive'),
        category: z.string().optional().describe('Category or subcategory name, case-insensitive'),
        tag: z
          .string()
          .optional()
          .describe('One of: EOL, NEW, PROMO, STOCKPROMO, VOLUME, REF, ENKEL_DEMO_UNIT, OOK_DEMO_UNIT'),
        in_stock_only: z.boolean().optional().describe('Only products with limited or sufficient stock'),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async (args) => {
      try {
        return ok(searchProducts(await api.getProducts(), args))
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_product',
    {
      description:
        'Get full details for one product: plain-text description, image URLs, reseller price and live stock.',
      inputSchema: { product_id: z.string().describe('BusinessCom product reference') },
    },
    async ({ product_id }) => {
      try {
        const products = await api.getProducts()
        const product = products.find((p) => p.product_id === product_id)
        if (!product) {
          return fail(new BusinessComError(`Unknown product_id "${product_id}"`, 404))
        }
        const [priceRes, stockRes] = await Promise.allSettled([
          api.getPrices(),
          api.getStockOne(product_id),
        ])
        const price =
          priceRes.status === 'fulfilled'
            ? (priceRes.value.find((p) => p.product_id === product_id)?.price ?? null)
            : null
        const stock = stockRes.status === 'fulfilled' ? stockRes.value : null
        return ok(productDetail(product, price, stock))
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_prices',
    {
      description: 'Get reseller prices (your terms and promotions applied) for specific product IDs.',
      inputSchema: { product_ids: z.array(z.string()).min(1).max(100) },
    },
    async ({ product_ids }) => {
      try {
        const prices = await api.getPrices()
        const byId = new Map(prices.map((p) => [p.product_id, p.price]))
        const found = product_ids
          .filter((id) => byId.has(id))
          .map((id) => ({ product_id: id, price: byId.get(id)! }))
        const not_found = product_ids.filter((id) => !byId.has(id))
        return ok({ prices: found, not_found })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_stock',
    {
      description: 'Get live stock status, exact quantity (max 250 shown) and lead time for product IDs.',
      inputSchema: { product_ids: z.array(z.string()).min(1).max(100) },
    },
    async ({ product_ids }) => {
      try {
        let items: StockItem[]
        let not_found: string[] = []
        if (product_ids.length === 1) {
          items = [await api.getStockOne(product_ids[0])]
        } else {
          const all = await api.getStockAll()
          const byId = new Map(all.map((s) => [s.product_id, s]))
          items = product_ids.flatMap((id) => byId.get(id) ?? [])
          not_found = product_ids.filter((id) => !byId.has(id))
        }
        const stock = items.map((s) => ({
          product_id: s.product_id,
          status: STOCK_LABELS[s.stock_status_code] ?? `unknown (${s.stock_status_code})`,
          quantity: s.stock_quantity ?? null,
          lead_time: s.lead_time ?? null,
        }))
        return ok({ stock, not_found })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_related_products',
    {
      description: 'Get accessories/related products for a product (e.g. chargers for a handset).',
      inputSchema: { product_id: z.string() },
    },
    async ({ product_id }) => {
      try {
        const [relations, products] = await Promise.all([
          api.getProductRelations(),
          api.getProducts(),
        ])
        return ok({ related: relatedProducts(relations, products, product_id) })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'list_categories',
    {
      description:
        'List all catalog categories (with subcategories and product counts) and brands — the valid filter values for search_products.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(listCategories(await api.getProducts()))
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_myconnect_invoice',
    {
      description:
        'Get a My-Connect invoice (purchases or sales) for a period as structured rows. Requires My-Connect invoicing rights.',
      inputSchema: {
        period: periodSchema.describe('Invoice period, MMYYYY'),
        type: z.enum(['purchases', 'sales']).default('purchases'),
        limit: z.number().int().min(1).max(1000).default(200),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ period, type, limit, offset }) => {
      try {
        const rows = parseSemicolonCsv(await api.getInvoiceCsv(period, type))
        return ok(paginate(rows, limit, offset))
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_myconnect_cdr',
    {
      description:
        'Get My-Connect CDR (call detail record) totals as structured rows. Defaults to last month grouped by customer. Requires My-Connect CDR rights.',
      inputSchema: {
        period: periodSchema.optional().describe('Period, MMYYYY; omit for last month'),
        grouping: z.enum(['customer', 'trunk', 'number']).optional(),
        totals_per_destination: z.boolean().optional(),
      },
    },
    async ({ period, grouping, totals_per_destination }) => {
      try {
        const csv = await api.getCdrCsv({
          period,
          grouping,
          totalsPerDestination: totals_per_destination,
        })
        const rows = parseSemicolonCsv(csv)
        return ok({ total_rows: rows.length, rows })
      } catch (err) {
        return fail(err)
      }
    },
  )

  return server
}
```

- [ ] **Step 4: Implement `src/index.ts`**

```ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { BusinessComClient } from './client.js'
import { createServer } from './server.js'

const username = process.env.BUSINESSCOM_USERNAME
const password = process.env.BUSINESSCOM_PASSWORD
if (!username || !password) {
  console.error('businesscom-mcp: BUSINESSCOM_USERNAME and BUSINESSCOM_PASSWORD must be set')
  process.exit(1)
}

const client = new BusinessComClient({
  username,
  password,
  baseUrl: process.env.BUSINESSCOM_BASE_URL,
})

const server = createServer(client)
await server.connect(new StdioServerTransport())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/server.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Full check — all tests and build**

Run: `npm test && npm run build`
Expected: all test files pass; tsc emits `dist/` without errors.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/index.ts test/server.test.ts
git commit -m "feat: MCP server with 8 read-only BusinessCom tools"
```

---

### Task 8: Smoke script, README, final verification

**Files:**
- Create: `scripts/smoke.ts`, `README.md`

- [ ] **Step 1: Create `scripts/smoke.ts`** (manual, live-API; not part of CI)

```ts
/**
 * Manual smoke test against the LIVE BusinessCom API.
 * Usage: BUSINESSCOM_USERNAME=... BUSINESSCOM_PASSWORD=... npm run smoke
 * Read-only: only GET endpoints are called.
 */
import { BusinessComClient, BusinessComError } from '../src/client.js'

const username = process.env.BUSINESSCOM_USERNAME
const password = process.env.BUSINESSCOM_PASSWORD
if (!username || !password) {
  console.error('Set BUSINESSCOM_USERNAME and BUSINESSCOM_PASSWORD first.')
  process.exit(1)
}

const client = new BusinessComClient({ username, password, baseUrl: process.env.BUSINESSCOM_BASE_URL })

const products = await client.getProducts()
console.log(`products: ${products.length}`)
const prices = await client.getPrices()
console.log(`prices: ${prices.length}`)
const stock = await client.getStockAll()
console.log(`stock: ${stock.length}`)
const relations = await client.getProductRelations()
console.log(`productRelations: ${relations.length}`)

if (products.length > 0) {
  const id = products[0].product_id
  const one = await client.getStockOne(id)
  console.log(`stock/${id}: status=${one.stock_status_code} qty=${one.stock_quantity ?? 'n/a'}`)
}

const now = new Date()
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const period = `${String(prev.getMonth() + 1).padStart(2, '0')}${prev.getFullYear()}`

try {
  const invoice = await client.getInvoiceCsv(period, 'purchases')
  console.log(`myconnect invoice ${period}: ${invoice.split('\n').length - 1} lines`)
} catch (err) {
  if (err instanceof BusinessComError) console.log(`myconnect invoice: ${err.message}`)
  else throw err
}

try {
  const cdr = await client.getCdrCsv({})
  console.log(`myconnect cdr (last month): ${cdr.split('\n').length - 1} lines`)
} catch (err) {
  if (err instanceof BusinessComError) console.log(`myconnect cdr: ${err.message}`)
  else throw err
}

console.log('smoke OK')
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Verify smoke script compiles** (do NOT run it against the live API in this task — the user runs it later with real credentials)

Run: `env -u BUSINESSCOM_USERNAME -u BUSINESSCOM_PASSWORD npx tsx scripts/smoke.ts`
Expected output: `Set BUSINESSCOM_USERNAME and BUSINESSCOM_PASSWORD first.` and exit code 1 — proves the script parses and guards correctly without touching the live API.

- [ ] **Step 4: Final verification — full suite and build**

Run: `npm test && npm run build && test -f dist/index.js && echo 'dist ok'`
Expected: all tests pass; `dist ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke.ts README.md
git commit -m "docs: README, registration instructions and live smoke script"
```

---

## Post-plan verification (user-facing)

After all tasks: the user runs `npm run smoke` with real credentials to verify the live API end-to-end, then registers the server with `claude mcp add` per the README. My-Connect tools may correctly report a rights error if the account lacks those privileges — that is expected behavior, not a bug.

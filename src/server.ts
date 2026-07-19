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
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
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
        const priceError =
          priceRes.status === 'rejected'
            ? String((priceRes.reason as Error)?.message ?? priceRes.reason)
            : undefined
        // A 404 means the product simply has no stock record — not an error.
        const stockError =
          stockRes.status === 'rejected' &&
          (stockRes.reason as BusinessComError)?.status !== 404
            ? String((stockRes.reason as Error)?.message ?? stockRes.reason)
            : undefined
        return ok({
          ...productDetail(product, price, stock),
          ...(priceError ? { price_error: priceError } : {}),
          ...(stockError ? { stock_error: stockError } : {}),
        })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_prices',
    {
      description: 'Get reseller prices (your terms and promotions applied) for specific product IDs.',
      inputSchema: {
        product_ids: z.array(z.string()).min(1).max(100).describe('BusinessCom product references'),
      },
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
      inputSchema: {
        product_ids: z.array(z.string()).min(1).max(100).describe('BusinessCom product references'),
      },
    },
    async ({ product_ids }) => {
      try {
        let items: StockItem[]
        let not_found: string[] = []
        if (product_ids.length === 1) {
          try {
            items = [await api.getStockOne(product_ids[0])]
          } catch (err) {
            if (err instanceof BusinessComError && err.status === 404) {
              return ok({ stock: [], not_found: [product_ids[0]] })
            }
            throw err
          }
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
      inputSchema: { product_id: z.string().describe('BusinessCom product reference') },
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
        limit: z.number().int().min(1).max(1000).default(200).describe('Max rows to return'),
        offset: z.number().int().min(0).default(0).describe('Row offset for pagination'),
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
        limit: z.number().int().min(1).max(1000).default(200).describe('Max rows to return'),
        offset: z.number().int().min(0).default(0).describe('Row offset for pagination'),
      },
    },
    async ({ period, grouping, totals_per_destination, limit, offset }) => {
      try {
        const csv = await api.getCdrCsv({
          period,
          grouping,
          totalsPerDestination: totals_per_destination,
        })
        const rows = parseSemicolonCsv(csv)
        return ok(paginate(rows, limit, offset))
      } catch (err) {
        return fail(err)
      }
    },
  )

  return server
}

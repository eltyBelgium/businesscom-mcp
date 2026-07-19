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

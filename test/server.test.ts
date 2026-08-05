import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/server.js'
import { BusinessComError } from '../src/client.js'
import type { BusinessComApi } from '../src/client.js'
import type { Product, Order, OrderSerialsRow } from '../src/types.js'

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

const sampleOrder: Order = {
  orderId: 123456,
  invoiceId: null,
  orderDate: '2026-06-01',
  invoiceDate: null,
  orderReference: 'ref-001',
  remark: null,
  partialDeliveryAllowed: true,
  dropShipmentRequired: false,
  orderStatus: { id: 30, description: 'invoiced' },
  deliveryOptionCode: 'STD',
  deliveryOptionCost: { amount: '0.00', currency: 'EUR' },
  orderFee: { amount: '0.00', currency: 'EUR' },
  vatTotal: { amount: '10.00', currency: 'EUR' },
  endTotal: { amount: '110.00', currency: 'EUR' },
  shipTo: {
    businessName: 'Somecompany BV',
    contactName: 'Jane Doe',
    address: 'Mainstreet 1',
    postalCode: '1000AA',
    city: 'Amsterdam',
    countryCode: 'NL',
  },
  billTo: null,
  trackAndTrace: {
    carrierId: 'DHL',
    trackingId: 'TRACK123',
    trackingUrl: 'https://track.example/TRACK123',
  },
  productLineItems: [
    {
      productId: { seller: 'WAX610-100EUS', buyer: null, manufacturer: null },
      description: 'Wireless AP',
      orderedQuantity: 1,
      assignedQuantity: 1,
      deliveryDate: '2026-06-02',
      price: { amount: '100.00', currency: 'EUR' },
      totalPrice: { amount: '100.00', currency: 'EUR' },
      status: { id: 30, description: 'invoiced' },
      uniqueIds: { serialIds: ['68DS7AW5Q9432'], macIds: [], imei1Ids: [] },
    },
  ],
}

const sampleSerialsRow: OrderSerialsRow = {
  orderNumber: 123456,
  orderDate: '2026-06-01',
  invoiceNumber: null,
  invoiceDate: null,
  invoiceAmount: null,
  deliveryDate: '2026-06-02',
  orderReference: 'ref-001',
  remark: null,
  lineNumber: 1,
  productId: 'WAX610-100EUS',
  description: 'Wireless AP',
  orderedQty: 1,
  deliveredQty: 1,
  netPrice: 100,
  lineTotal: 100,
  serials: ['68DS7AW5Q9432'],
  macAddresses: [],
  imei1: [],
}

const fakeApi: BusinessComApi = {
  getProducts: async () => [sampleProduct],
  getPrices: async () => [{ product_id: 'P1', price: 42.5 }],
  getStockAll: async () => [{ product_id: 'P1', stock_status_code: 2, stock_quantity: 9, lead_time: 1 }],
  getStockOne: async () => ({ product_id: 'P1', stock_status_code: 2, stock_quantity: 9, lead_time: 1 }),
  getProductRelations: async () => [{ product_id: 'P1', related_product_id: 'P2' }],
  getInvoiceCsv: async () => '"InvoiceNumber";"Price"\n"23028168";"0.00"',
  getCdrCsv: async () => '"InvoicePeriod";"Calls"\n"202410";"738"',
  getOrders: async () => [sampleOrder],
  getOrder: async (id) => {
    if (id !== '123456') {
      throw new BusinessComError(`Unknown orderId "${id}"`, 404)
    }
    return sampleOrder
  },
  getOrderSerials: async () => [sampleSerialsRow],
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
  it('registers exactly the 11 read-only tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_myconnect_cdr',
      'get_myconnect_invoice',
      'get_order',
      'get_order_serials',
      'get_prices',
      'get_product',
      'get_related_products',
      'get_stock',
      'list_categories',
      'list_orders',
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

  it('get_stock returns not_found consistently for single and multiple ids', async () => {
    const notFoundApi: BusinessComApi = {
      ...fakeApi,
      getStockOne: async (id) => {
        throw new BusinessComError(`Unknown product_id "${id}"`, 404)
      },
      getStockAll: async () => [{ product_id: 'P1', stock_status_code: 2, stock_quantity: 9, lead_time: 1 }],
    }
    const server = createServer(notFoundApi)
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0.0.0' })
    await Promise.all([server.connect(st), client.connect(ct)])
    const single = await client.callTool({ name: 'get_stock', arguments: { product_ids: ['NOPE'] } })
    expect(single.isError).toBeFalsy()
    expect(JSON.parse(firstText(single))).toEqual({ stock: [], not_found: ['NOPE'] })
    const multi = await client.callTool({ name: 'get_stock', arguments: { product_ids: ['P1', 'NOPE'] } })
    const parsed = JSON.parse(firstText(multi))
    expect(parsed.stock).toHaveLength(1)
    expect(parsed.not_found).toEqual(['NOPE'])
  })

  it('surfaces a price fetch failure on get_product without failing the call', async () => {
    const flakyApi: BusinessComApi = {
      ...fakeApi,
      getPrices: async () => {
        throw new BusinessComError('BusinessCom API returned HTTP 500 for /prices', 500)
      },
    }
    const server = createServer(flakyApi)
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0.0.0' })
    await Promise.all([server.connect(st), client.connect(ct)])
    const res = await client.callTool({ name: 'get_product', arguments: { product_id: 'P1' } })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.reseller_price).toBeNull()
    expect(parsed.price_error).toContain('HTTP 500')
    expect(parsed.stock.quantity).toBe(9)
  })

  it('passes actionable error text through to the client', async () => {
    const authFailApi: BusinessComApi = {
      ...fakeApi,
      getProducts: async () => {
        throw new BusinessComError('Authentication failed — check BUSINESSCOM_USERNAME / BUSINESSCOM_PASSWORD and that the account has API privileges.', 401)
      },
    }
    const server = createServer(authFailApi)
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0.0.0' })
    await Promise.all([server.connect(st), client.connect(ct)])
    const res = await client.callTool({ name: 'search_products', arguments: {} })
    expect(res.isError).toBe(true)
    expect(firstText(res)).toContain('BUSINESSCOM_USERNAME')
  })

  it('list_orders returns compact order summaries', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'list_orders', arguments: {} })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.total_matches).toBe(1)
    expect(parsed.results[0].order_id).toBe(123456)
    expect(parsed.results[0].status).toBe('invoiced')
  })

  it('get_order returns full order detail', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_order', arguments: { order_id: '123456' } })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.status).toBe('invoiced')
    expect(parsed.status_id).toBe(30)
  })

  it('get_order_serials returns lines with serials', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_order_serials', arguments: { order_id: '123456' } })
    const parsed = JSON.parse(firstText(res))
    expect(parsed.lines[0].serials).toContain('68DS7AW5Q9432')
  })

  it('get_order returns isError for an unknown order id', async () => {
    const client = await connect()
    const res = await client.callTool({ name: 'get_order', arguments: { order_id: '999' } })
    expect(res.isError).toBe(true)
  })
})

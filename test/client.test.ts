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

  it('wraps malformed JSON on a 200 response in BusinessComError', async () => {
    stubFetch(200, '<html>maintenance</html>')
    const err = await make().getProducts().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BusinessComError)
    expect((err as BusinessComError).message).toContain('Invalid JSON')
  })

  it('passes an abort signal to fetch', async () => {
    const fn = stubFetch(200, '[]')
    await make().getPrices()
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
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

  it('getOrders() GETs /orders and unwraps the orders envelope', async () => {
    const order = { orderId: 123, orderReference: 'ref-1' }
    const fn = stubFetch(200, JSON.stringify({ orders: [order] }))
    const result = await make().getOrders()
    expect(fn.mock.calls[0][0]).toBe('https://www.businesscom.nl/api/v1/orders')
    expect(result).toEqual([order])
  })

  it('getOrder(id) GETs /orders/{id} and unwraps { order: [o] } to the single order', async () => {
    const order = { orderId: 123, orderReference: 'ref-1' }
    const fn = stubFetch(200, JSON.stringify({ order: [order] }))
    const result = await make().getOrder('123')
    expect(fn.mock.calls[0][0]).toBe('https://www.businesscom.nl/api/v1/orders/123')
    expect(result).toEqual(order)
  })

  it('getOrder(id) throws a BusinessComError mentioning the orderId when the array is empty', async () => {
    stubFetch(200, JSON.stringify({ order: [] }))
    await expect(make().getOrder('123')).rejects.toThrow(/123/)
  })

  it('getOrder(id) throws a BusinessComError mentioning the orderId when order is missing', async () => {
    stubFetch(200, JSON.stringify({}))
    await expect(make().getOrder('123')).rejects.toThrow(/123/)
  })

  it('getOrderSerials(id) GETs /orders/{id}/serials and returns the rows array', async () => {
    const rows = [{ orderNumber: 123, lineNumber: 1 }]
    const fn = stubFetch(200, JSON.stringify(rows))
    const result = await make().getOrderSerials('123')
    expect(fn.mock.calls[0][0]).toBe('https://www.businesscom.nl/api/v1/orders/123/serials')
    expect(result).toEqual(rows)
  })

  it('maps 404 from getOrder to unknown orderId', async () => {
    stubFetch(404, '')
    await expect(make().getOrder('123')).rejects.toThrow(/Unknown orderId "123"/)
  })

  it('maps 404 from getOrderSerials to unknown orderId', async () => {
    stubFetch(404, '')
    await expect(make().getOrderSerials('123')).rejects.toThrow(/Unknown orderId "123"/)
  })
})

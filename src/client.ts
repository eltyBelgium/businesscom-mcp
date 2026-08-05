import type { Order, OrderSerialsRow, Price, Product, ProductRelation, StockItem } from './types.js'

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
  getOrders(): Promise<Order[]>
  getOrder(orderId: string): Promise<Order>
  getOrderSerials(orderId: string): Promise<OrderSerialsRow[]>
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

  private async requestJson<T>(path: string, accept?: string): Promise<T> {
    const res = await this.request(path, accept)
    try {
      return (await res.json()) as T
    } catch {
      throw new BusinessComError(`Invalid JSON in response from ${path}`)
    }
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
    return this.requestJson<Product[]>('/products', PRODUCTS_ACCEPT)
  }

  async getPrices(): Promise<Price[]> {
    return this.requestJson<Price[]>('/prices')
  }

  async getStockAll(): Promise<StockItem[]> {
    return this.requestJson<StockItem[]>('/stock', STOCK_ACCEPT)
  }

  async getStockOne(productId: string): Promise<StockItem> {
    try {
      return await this.requestJson<StockItem>(`/stock/${encodeURIComponent(productId)}`)
    } catch (err) {
      if (err instanceof BusinessComError && err.status === 404) {
        throw new BusinessComError(`Unknown product_id "${productId}"`, 404)
      }
      throw err
    }
  }

  async getProductRelations(): Promise<ProductRelation[]> {
    return this.requestJson<ProductRelation[]>('/productRelations')
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

  async getOrders(): Promise<Order[]> {
    const body = await this.requestJson<{ orders?: Order[] }>('/orders')
    return body.orders ?? []
  }

  async getOrder(orderId: string): Promise<Order> {
    let body: { order?: Order[] }
    try {
      body = await this.requestJson<{ order?: Order[] }>(`/orders/${encodeURIComponent(orderId)}`)
    } catch (err) {
      if (err instanceof BusinessComError && err.status === 404) {
        throw new BusinessComError(`Unknown orderId "${orderId}"`, 404)
      }
      throw err
    }
    const order = body.order?.[0]
    if (!order) {
      throw new BusinessComError(`Unknown orderId "${orderId}": order not found in response`)
    }
    return order
  }

  async getOrderSerials(orderId: string): Promise<OrderSerialsRow[]> {
    try {
      return await this.requestJson<OrderSerialsRow[]>(`/orders/${encodeURIComponent(orderId)}/serials`)
    } catch (err) {
      if (err instanceof BusinessComError && err.status === 404) {
        throw new BusinessComError(`Unknown orderId "${orderId}"`, 404)
      }
      throw err
    }
  }
}

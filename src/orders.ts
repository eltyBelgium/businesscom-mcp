import type { Order, OrderLineItem, OrderSerialsRow } from './types.js'

export interface OrderSummary {
  order_id: number
  order_date: string
  order_reference: string
  status: string
  end_total: Order['endTotal']
  ship_to_business: string | null
  tracking_url: string | null
  invoice_id: number | null
}

export function summarizeOrder(o: Order): OrderSummary {
  return {
    order_id: o.orderId,
    order_date: o.orderDate,
    order_reference: o.orderReference,
    status: o.orderStatus.description,
    end_total: o.endTotal,
    ship_to_business: o.shipTo?.businessName ?? null,
    tracking_url: o.trackAndTrace?.trackingUrl ?? null,
    invoice_id: o.invoiceId,
  }
}

export interface OrderListFilters {
  query?: string
  status?: string
  limit: number
  offset: number
}

export function listOrders(orders: Order[], f: OrderListFilters) {
  const q = f.query?.toLowerCase()
  const matches = orders.filter((o) => {
    if (q) {
      const hay = `${o.orderReference} ${o.orderId} ${o.shipTo?.businessName ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (f.status && o.orderStatus.description.toLowerCase() !== f.status.toLowerCase()) return false
    return true
  })
  matches.sort(
    (a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderId - a.orderId,
  )
  return {
    total_matches: matches.length,
    results: matches.slice(f.offset, f.offset + f.limit).map(summarizeOrder),
  }
}

function flattenLineItemStatus(item: OrderLineItem) {
  const { status, ...rest } = item
  return {
    ...rest,
    status: status.description,
    status_id: status.id,
  }
}

export function orderDetail(o: Order) {
  const { orderStatus, productLineItems, ...rest } = o
  return {
    ...rest,
    status: orderStatus.description,
    status_id: orderStatus.id,
    productLineItems: productLineItems.map(flattenLineItemStatus),
  }
}

export interface SerialsLine {
  line_number: number
  product_id: string
  description: string
  ordered_qty: number
  delivered_qty: number
  serials: string[]
  mac_addresses: string[]
  imei1: string[]
}

export interface SerialsReport {
  order: {
    order_number: number
    order_date: string
    order_reference: string | null
    delivery_date: string | null
    invoice_number: string | null
  } | null
  lines: SerialsLine[]
}

export function serialsReport(rows: OrderSerialsRow[]): SerialsReport {
  const first = rows[0]
  return {
    order: first
      ? {
          order_number: first.orderNumber,
          order_date: first.orderDate,
          order_reference: first.orderReference,
          delivery_date: first.deliveryDate,
          invoice_number: first.invoiceNumber,
        }
      : null,
    lines: rows.map((r) => ({
      line_number: r.lineNumber,
      product_id: r.productId,
      description: r.description,
      ordered_qty: r.orderedQty,
      delivered_qty: r.deliveredQty,
      serials: r.serials,
      mac_addresses: r.macAddresses,
      imei1: r.imei1,
    })),
  }
}

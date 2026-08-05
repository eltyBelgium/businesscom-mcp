import { describe, it, expect } from 'vitest'
import { summarizeOrder, listOrders, orderDetail, serialsReport } from '../src/orders.js'
import type { Order, OrderLineItem, OrderSerialsRow } from '../src/types.js'

function money(amount: string, currency = 'EUR'): Order['endTotal'] {
  return { amount, currency }
}

function lineItem(overrides: Partial<OrderLineItem> = {}): OrderLineItem {
  return {
    productId: { seller: 'SKU1', buyer: null, manufacturer: null },
    description: 'Yealink T31P',
    orderedQuantity: 2,
    assignedQuantity: 2,
    deliveryDate: '2026-08-01',
    price: money('49.00'),
    totalPrice: money('98.00'),
    status: { id: 3, description: 'Shipped' },
    uniqueIds: { serialIds: ['SN1', 'SN2'], macIds: [], imei1Ids: [] },
    ...overrides,
  }
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    orderId: 100,
    invoiceId: 5001,
    orderDate: '2026-07-01',
    invoiceDate: '2026-07-05',
    orderReference: 'REF-A',
    remark: null,
    partialDeliveryAllowed: true,
    dropShipmentRequired: false,
    orderStatus: { id: 3, description: 'Shipped' },
    deliveryOptionCode: 'STD',
    deliveryOptionCost: money('0.00'),
    orderFee: money('0.00'),
    vatTotal: money('20.58'),
    endTotal: money('118.58'),
    shipTo: {
      businessName: 'Acme BV',
      contactName: 'Jane Doe',
      address: 'Main St 1',
      postalCode: '1000AB',
      city: 'Amsterdam',
      countryCode: 'NL',
    },
    billTo: null,
    trackAndTrace: { carrierId: 'DHL', trackingId: 'TRK123', trackingUrl: 'https://track/TRK123' },
    productLineItems: [lineItem()],
    ...overrides,
  }
}

describe('summarizeOrder', () => {
  it('returns compact summary fields', () => {
    expect(summarizeOrder(order())).toEqual({
      order_id: 100,
      order_date: '2026-07-01',
      order_reference: 'REF-A',
      status: 'Shipped',
      end_total: { amount: '118.58', currency: 'EUR' },
      ship_to_business: 'Acme BV',
      tracking_url: 'https://track/TRK123',
      invoice_id: 5001,
    })
  })

  it('is null-safe when shipTo and trackAndTrace are missing', () => {
    const s = summarizeOrder(order({ shipTo: null, trackAndTrace: null }))
    expect(s.ship_to_business).toBeNull()
    expect(s.tracking_url).toBeNull()
  })
})

describe('listOrders', () => {
  const orders = [
    order({ orderId: 1, orderReference: 'ALPHA', orderDate: '2026-07-01', shipTo: null, orderStatus: { id: 1, description: 'Invoiced' } }),
    order({ orderId: 2, orderReference: 'BETA', orderDate: '2026-07-03', shipTo: { ...order().shipTo!, businessName: 'Contoso Ltd' }, orderStatus: { id: 3, description: 'Shipped' } }),
    order({ orderId: 3, orderReference: 'GAMMA', orderDate: '2026-07-03', shipTo: null, orderStatus: { id: 3, description: 'Shipped' } }),
  ]

  it('matches query against orderReference, orderId (as string), and shipTo.businessName, case-insensitively', () => {
    expect(listOrders(orders, { query: 'alpha', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(listOrders(orders, { query: '2', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(listOrders(orders, { query: 'contoso', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(listOrders(orders, { query: 'nope', limit: 20, offset: 0 }).total_matches).toBe(0)
  })

  it('filters by status, case-insensitively and exactly', () => {
    expect(listOrders(orders, { status: 'shipped', limit: 20, offset: 0 }).total_matches).toBe(2)
    expect(listOrders(orders, { status: 'SHIPPED', limit: 20, offset: 0 }).total_matches).toBe(2)
    expect(listOrders(orders, { status: 'ship', limit: 20, offset: 0 }).total_matches).toBe(0)
  })

  it('sorts by orderDate desc, tie-breaking by orderId desc, and paginates after sorting', () => {
    const { results } = listOrders(orders, { limit: 20, offset: 0 })
    // orders 2 and 3 share orderDate 2026-07-03; orderId desc means 3 before 2
    expect(results.map((r) => r.order_id)).toEqual([3, 2, 1])
  })

  it('paginates with offset', () => {
    const page = listOrders(orders, { limit: 1, offset: 1 })
    expect(page.total_matches).toBe(3)
    expect(page.results.map((r) => r.order_id)).toEqual([2])
  })
})

describe('orderDetail', () => {
  it('flattens order status and line item status while keeping other fields as-is', () => {
    const detail = orderDetail(order())
    expect(detail.status).toBe('Shipped')
    expect(detail.status_id).toBe(3)
    expect(detail.orderId).toBe(100)
    expect(detail.endTotal).toEqual({ amount: '118.58', currency: 'EUR' })
    expect(detail.shipTo).toEqual(order().shipTo)
    expect(detail.trackAndTrace).toEqual(order().trackAndTrace)
    expect(detail.productLineItems).toHaveLength(1)
    const line = detail.productLineItems[0] as unknown as Record<string, unknown>
    expect(line.status).toBe('Shipped')
    expect(line.status_id).toBe(3)
    expect(line.uniqueIds).toEqual({ serialIds: ['SN1', 'SN2'], macIds: [], imei1Ids: [] })
    expect(line.description).toBe('Yealink T31P')
  })
})

function serialsRow(overrides: Partial<OrderSerialsRow> = {}): OrderSerialsRow {
  return {
    orderNumber: 100,
    orderDate: '2026-07-01',
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-07-05',
    invoiceAmount: '118.58',
    deliveryDate: '2026-07-10',
    orderReference: 'REF-A',
    remark: null,
    lineNumber: 1,
    productId: 'SKU1',
    description: 'Yealink T31P',
    orderedQty: 2,
    deliveredQty: 2,
    netPrice: 49.0,
    lineTotal: 98.0,
    serials: ['SN1', 'SN2'],
    macAddresses: [],
    imei1: [],
    ...overrides,
  }
}

describe('serialsReport', () => {
  it('builds an order header from the first row and maps each row to a line', () => {
    const rows = [
      serialsRow({ lineNumber: 1, productId: 'SKU1' }),
      serialsRow({ lineNumber: 2, productId: 'SKU2', serials: ['SN3'], orderedQty: 1, deliveredQty: 1 }),
    ]
    const report = serialsReport(rows)
    expect(report.order).toEqual({
      order_number: 100,
      order_date: '2026-07-01',
      order_reference: 'REF-A',
      delivery_date: '2026-07-10',
      invoice_number: 'INV-1',
    })
    expect(report.lines).toEqual([
      {
        line_number: 1,
        product_id: 'SKU1',
        description: 'Yealink T31P',
        ordered_qty: 2,
        delivered_qty: 2,
        serials: ['SN1', 'SN2'],
        mac_addresses: [],
        imei1: [],
      },
      {
        line_number: 2,
        product_id: 'SKU2',
        description: 'Yealink T31P',
        ordered_qty: 1,
        delivered_qty: 1,
        serials: ['SN3'],
        mac_addresses: [],
        imei1: [],
      },
    ])
  })

  it('returns null order and empty lines for an empty rows array', () => {
    expect(serialsReport([])).toEqual({ order: null, lines: [] })
  })
})

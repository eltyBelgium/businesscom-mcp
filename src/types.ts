/** One image/media item attached to a product. */
export interface ProductMedia {
  id: string
  file_extension: string
  updated_at: string
}

/** Product from GET /products with the v202306 Accept header. */
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

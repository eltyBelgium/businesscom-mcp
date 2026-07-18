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

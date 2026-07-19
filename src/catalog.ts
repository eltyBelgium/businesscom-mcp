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
  matches.sort(
    (a, b) => b.popularity_ranking - a.popularity_ranking || a.product_id.localeCompare(b.product_id),
  )
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

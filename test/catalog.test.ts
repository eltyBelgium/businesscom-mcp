import { describe, it, expect } from 'vitest'
import {
  searchProducts,
  summarizeProduct,
  productDetail,
  relatedProducts,
  listCategories,
} from '../src/catalog.js'
import type { Product } from '../src/types.js'

function product(overrides: Partial<Product>): Product {
  return {
    product_id: 'P1',
    manufacturer_id: 'M1',
    brand_id: 1,
    brand: 'Yealink',
    brand_logo: null,
    name: 'T31P IP Phone',
    description_html: '<p>desc</p>',
    retail_price: 59.0,
    stock_status_code: 2,
    lead_time: 1,
    category_id: 1,
    category_name: 'Phones',
    sub_category_id: 11,
    sub_category_name: 'Desk phones',
    tags: 'NEW,PROMO',
    remarks: null,
    my_shop_jn: 'J',
    ean_code: 1234567890123,
    popularity_ranking: 5,
    media: [{ id: 'abc123', file_extension: 'jpg', updated_at: '01/01/2026 00:00:00+00:00' }],
    ...overrides,
  }
}

const catalog = [
  product({}),
  product({ product_id: 'P2', name: 'W73P DECT', brand: 'Gigaset', category_name: 'DECT', sub_category_name: 'Handsets', tags: 'EOL', stock_status_code: 0, popularity_ranking: 9 }),
  product({ product_id: 'P3', name: 'Headset Pro', brand: 'Yealink', category_name: 'Headsets', sub_category_name: 'Wired', tags: '', stock_status_code: 1, popularity_ranking: 1, ean_code: null }),
]

describe('searchProducts', () => {
  it('matches query against id, manufacturer id, name and EAN, case-insensitively', () => {
    expect(searchProducts(catalog, { query: 'dect', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { query: 'p3', limit: 20, offset: 0 }).total_matches).toBe(1)
    // P1 and P2 share the default EAN; P3 has ean_code: null
    expect(searchProducts(catalog, { query: '1234567890123', limit: 20, offset: 0 }).total_matches).toBe(2)
  })

  it('filters by brand, category (main or sub), tag and stock', () => {
    expect(searchProducts(catalog, { brand: 'yealink', limit: 20, offset: 0 }).total_matches).toBe(2)
    expect(searchProducts(catalog, { category: 'handsets', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { tag: 'eol', limit: 20, offset: 0 }).total_matches).toBe(1)
    expect(searchProducts(catalog, { in_stock_only: true, limit: 20, offset: 0 }).total_matches).toBe(2)
  })

  it('sorts by popularity and paginates, reporting total_matches', () => {
    const page = searchProducts(catalog, { limit: 2, offset: 0 })
    expect(page.total_matches).toBe(3)
    expect(page.results.map((r) => r.product_id)).toEqual(['P2', 'P1'])
    const page2 = searchProducts(catalog, { limit: 2, offset: 2 })
    expect(page2.results.map((r) => r.product_id)).toEqual(['P3'])
  })

  it('never includes descriptions in results', () => {
    const { results } = searchProducts(catalog, { limit: 20, offset: 0 })
    for (const r of results) expect(r).not.toHaveProperty('description_html')
  })
})

describe('summarizeProduct', () => {
  it('returns compact fields with a stock label', () => {
    expect(summarizeProduct(product({}))).toEqual({
      product_id: 'P1',
      name: 'T31P IP Phone',
      brand: 'Yealink',
      category_name: 'Phones',
      sub_category_name: 'Desk phones',
      retail_price: 59.0,
      stock_status: 'sufficient stock',
      lead_time: 1,
      tags: 'NEW,PROMO',
    })
  })
})

describe('productDetail', () => {
  it('merges reseller price and live stock, strips html, builds media urls', () => {
    const detail = productDetail(product({}), 42.5, {
      product_id: 'P1',
      stock_status_code: 2,
      stock_quantity: 12,
      lead_time: 1,
    })
    expect(detail.description).toBe('desc')
    expect(detail.reseller_price).toBe(42.5)
    expect(detail.stock).toEqual({ status: 'sufficient stock', quantity: 12, lead_time: 1 })
    expect(detail.media_urls).toEqual(['https://businesscom.nl/shop-product-media/abc123.jpg'])
    expect(detail.suitable_for_own_shop).toBe(true)
  })

  it('tolerates missing price and stock', () => {
    const detail = productDetail(product({}), null, null)
    expect(detail.reseller_price).toBeNull()
    expect(detail.stock).toBeNull()
  })
})

describe('relatedProducts', () => {
  it('joins related ids with catalog data and keeps unknown ids', () => {
    const rels = [
      { product_id: 'P1', related_product_id: 'P3' },
      { product_id: 'P1', related_product_id: 'GONE' },
      { product_id: 'P2', related_product_id: 'P1' },
    ]
    const out = relatedProducts(rels, catalog, 'P1')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ product_id: 'P3', name: 'Headset Pro' })
    expect(out[1]).toEqual({ product_id: 'GONE' })
  })
})

describe('listCategories', () => {
  it('returns categories with subcategories and counts, plus distinct brands', () => {
    const out = listCategories(catalog)
    expect(out.brands).toEqual(['Gigaset', 'Yealink'])
    const phones = out.categories.find((c) => c.name === 'Phones')
    expect(phones).toEqual({ name: 'Phones', product_count: 1, subcategories: ['Desk phones'] })
    expect(out.categories).toHaveLength(3)
  })
})

import { describe, it, expect } from 'vitest'
import { isValidPeriod, paginate } from '../src/myconnect.js'

describe('isValidPeriod', () => {
  it('accepts MMYYYY', () => {
    expect(isValidPeriod('012026')).toBe(true)
    expect(isValidPeriod('122025')).toBe(true)
  })
  it('rejects bad months, lengths and non-digits', () => {
    expect(isValidPeriod('132026')).toBe(false)
    expect(isValidPeriod('002026')).toBe(false)
    expect(isValidPeriod('2026')).toBe(false)
    expect(isValidPeriod('2026-01')).toBe(false)
    expect(isValidPeriod('ab2026')).toBe(false)
  })
})

describe('paginate', () => {
  it('slices rows and reports the total', () => {
    const rows = [1, 2, 3, 4, 5]
    expect(paginate(rows, 2, 0)).toEqual({ total_rows: 5, rows: [1, 2] })
    expect(paginate(rows, 2, 4)).toEqual({ total_rows: 5, rows: [5] })
    expect(paginate(rows, 2, 10)).toEqual({ total_rows: 5, rows: [] })
  })
})

import { describe, it, expect } from 'vitest'
import { parseSemicolonCsv } from '../src/csv.js'

describe('parseSemicolonCsv', () => {
  it('maps rows to objects keyed by the header row', () => {
    const csv = '"A";"B"\n"1";"2"\n"3";"4"'
    expect(parseSemicolonCsv(csv)).toEqual([
      { A: '1', B: '2' },
      { A: '3', B: '4' },
    ])
  })

  it('keeps semicolons and newlines inside quoted fields', () => {
    const csv = '"Name";"Note"\n"Acme; BV";"line1\nline2"'
    expect(parseSemicolonCsv(csv)).toEqual([{ Name: 'Acme; BV', Note: 'line1\nline2' }])
  })

  it('unescapes doubled quotes', () => {
    const csv = '"A"\n"say ""hi"""'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: 'say "hi"' }])
  })

  it('handles CRLF line endings and a trailing newline', () => {
    const csv = '"A";"B"\r\n"1";"2"\r\n'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: '1', B: '2' }])
  })

  it('handles unquoted fields', () => {
    const csv = 'A;B\n1;2'
    expect(parseSemicolonCsv(csv)).toEqual([{ A: '1', B: '2' }])
  })

  it('treats a quote in the middle of an unquoted field as literal data', () => {
    const csv = 'Product;Price\nModel 6" Antenna;100\nNext;200'
    expect(parseSemicolonCsv(csv)).toEqual([
      { Product: 'Model 6" Antenna', Price: '100' },
      { Product: 'Next', Price: '200' },
    ])
  })

  it('strips a leading UTF-8 BOM', () => {
    expect(parseSemicolonCsv('﻿"A";"B"\n"1";"2"')).toEqual([{ A: '1', B: '2' }])
  })

  it('returns [] for empty input or header-only input', () => {
    expect(parseSemicolonCsv('')).toEqual([])
    expect(parseSemicolonCsv('"A";"B"\n')).toEqual([])
  })
})

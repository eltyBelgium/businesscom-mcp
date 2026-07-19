/**
 * Parse semicolon-delimited CSV (as returned by the My-Connect endpoints)
 * into objects keyed by the header row. Handles quoted fields containing
 * semicolons/newlines and doubled-quote escapes. Header-driven on purpose:
 * invoice columns are configurable in the My-Connect portal.
 */
export function parseSemicolonCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text)
  if (rows.length < 2) return []
  const [header, ...data] = rows
  return data
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let sawAny = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    sawAny = true
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (sawAny && (field !== '' || row.length > 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

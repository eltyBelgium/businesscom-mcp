/**
 * Parse semicolon-delimited CSV (as returned by the My-Connect endpoints)
 * into objects keyed by the header row. Handles quoted fields containing
 * semicolons/newlines and doubled-quote escapes. Header-driven on purpose:
 * invoice columns are configurable in the My-Connect portal.
 */
export function parseSemicolonCsv(text: string): Record<string, string>[] {
  // Strip a single leading UTF-8 BOM so the first header name isn't corrupted.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = parseRows(text)
  if (rows.length < 2) return []
  const [header, ...data] = rows
  return (
    data
      // Drop the empty row produced by a trailing newline.
      .filter((r) => !(r.length === 1 && r[0] === ''))
      // Extra columns beyond the header are intentionally dropped, and
      // duplicate header names collide last-wins (Object.fromEntries).
      .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
  )
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atFieldStart = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"' && atFieldStart) {
      // A quote only opens quoted-field mode at the start of a field;
      // a mid-field quote is literal data.
      inQuotes = true
      atFieldStart = false
    } else if (c === ';') {
      row.push(field)
      field = ''
      atFieldStart = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      atFieldStart = true
    } else {
      field += c
      atFieldStart = false
    }
  }
  if (text.length > 0 && (field !== '' || row.length > 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

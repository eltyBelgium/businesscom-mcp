/** Validate a My-Connect invoice/CDR period in MMYYYY format. */
export function isValidPeriod(period: string): boolean {
  if (!/^\d{6}$/.test(period)) return false
  const month = Number(period.slice(0, 2))
  return month >= 1 && month <= 12
}

export function paginate<T>(rows: T[], limit: number, offset: number) {
  return { total_rows: rows.length, rows: rows.slice(offset, offset + limit) }
}

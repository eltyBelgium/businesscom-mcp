const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  ccedil: 'ç',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  trade: '™',
  reg: '®',
  copy: '©',
  deg: '°',
  shy: '',
  sect: '§',
}

/** Convert product description HTML to compact plain text, truncated for LLM use. */
export function htmlToText(html: string, maxLength = 4000): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|li|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  if (text.length <= maxLength) return text
  const code = text.charCodeAt(maxLength - 1)
  const cut = code >= 0xd800 && code <= 0xdbff ? maxLength - 1 : maxLength
  return text.slice(0, cut) + '…'
}

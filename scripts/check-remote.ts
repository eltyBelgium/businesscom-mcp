/**
 * MCP handshake check against a remote (or local wrangler dev) endpoint.
 * Usage: npm run check:remote -- <url>
 *   e.g. npm run check:remote -- http://localhost:8787/mcp
 * Optional Cloudflare Access service token via env:
 *   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
 * Exits 0 iff the endpoint lists exactly the 11 expected tools.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const EXPECTED = [
  'get_myconnect_cdr',
  'get_myconnect_invoice',
  'get_order',
  'get_order_serials',
  'get_prices',
  'get_product',
  'get_related_products',
  'get_stock',
  'list_categories',
  'list_orders',
  'search_products',
]

const url = process.argv[2]
if (!url) {
  console.error('Usage: npm run check:remote -- <url>')
  process.exit(1)
}

const headers: Record<string, string> = {}
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
})
const client = new Client({ name: 'check-remote', version: '0.0.0' })

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name).sort()
  console.log(`tools (${names.length}): ${names.join(', ')}`)
  const ok = JSON.stringify(names) === JSON.stringify(EXPECTED)
  await client.close()
  if (!ok) {
    console.error('Tool list does not match the 11 expected tools.')
    process.exit(1)
  }
  console.log('remote check OK')
} catch (err) {
  console.error(`remote check FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

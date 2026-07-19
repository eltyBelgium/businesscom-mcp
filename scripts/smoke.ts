/**
 * Manual smoke test against the LIVE BusinessCom API.
 * Usage: BUSINESSCOM_USERNAME=... BUSINESSCOM_PASSWORD=... npm run smoke
 * Read-only: only GET endpoints are called.
 */
import { BusinessComClient, BusinessComError } from '../src/client.js'

const username = process.env.BUSINESSCOM_USERNAME
const password = process.env.BUSINESSCOM_PASSWORD
if (!username || !password) {
  console.error('Set BUSINESSCOM_USERNAME and BUSINESSCOM_PASSWORD first.')
  process.exit(1)
}

const client = new BusinessComClient({ username, password, baseUrl: process.env.BUSINESSCOM_BASE_URL })

const products = await client.getProducts()
console.log(`products: ${products.length}`)
const prices = await client.getPrices()
console.log(`prices: ${prices.length}`)
const stock = await client.getStockAll()
console.log(`stock: ${stock.length}`)
const relations = await client.getProductRelations()
console.log(`productRelations: ${relations.length}`)

if (products.length > 0) {
  const id = products[0].product_id
  const one = await client.getStockOne(id)
  console.log(`stock/${id}: status=${one.stock_status_code} qty=${one.stock_quantity ?? 'n/a'}`)
}

const now = new Date()
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
const period = `${String(prev.getMonth() + 1).padStart(2, '0')}${prev.getFullYear()}`

try {
  const invoice = await client.getInvoiceCsv(period, 'purchases')
  console.log(`myconnect invoice ${period}: ${invoice.split('\n').length - 1} lines`)
} catch (err) {
  if (err instanceof BusinessComError) console.log(`myconnect invoice: ${err.message}`)
  else throw err
}

try {
  const cdr = await client.getCdrCsv({})
  console.log(`myconnect cdr (last month): ${cdr.split('\n').length - 1} lines`)
} catch (err) {
  if (err instanceof BusinessComError) console.log(`myconnect cdr: ${err.message}`)
  else throw err
}

console.log('smoke OK')

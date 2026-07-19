# businesscom-mcp

Read-only MCP server for the [BusinessCom](https://businesscom.nl) distributor API.
Exposes catalog search, product details, reseller prices, live stock, related
products, and My-Connect invoices/CDR as MCP tools. No orders — the server
cannot place or modify anything. No database or cache — every call fetches
live data.

## Setup

```bash
npm install
npm run build
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `BUSINESSCOM_USERNAME` | yes | Portal login name (account needs API privileges) |
| `BUSINESSCOM_PASSWORD` | yes | Portal password **or** API key (API key recommended) |
| `BUSINESSCOM_BASE_URL` | no | Default `https://www.businesscom.nl/api/v1` |

## Register with Claude Code

Requires Node.js ≥ 18. Adjust the `dist/index.js` path below to where you cloned this repo.

```bash
claude mcp add businesscom \
  --env BUSINESSCOM_USERNAME=your-login \
  --env BUSINESSCOM_PASSWORD=your-api-key \
  -- node /Users/tl/Projects/Elty/businesscom-mcp/dist/index.js
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "businesscom": {
      "command": "node",
      "args": ["/Users/tl/Projects/Elty/businesscom-mcp/dist/index.js"],
      "env": {
        "BUSINESSCOM_USERNAME": "your-login",
        "BUSINESSCOM_PASSWORD": "your-api-key"
      }
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `search_products` | Search catalog by text/brand/category/tag/stock, paginated summaries |
| `get_product` | Full product detail incl. reseller price + live stock |
| `get_prices` | Reseller prices for specific product IDs |
| `get_stock` | Live stock status/quantity/lead time for product IDs |
| `get_related_products` | Accessories/related products for a product |
| `list_categories` | All categories, subcategories and brands |
| `get_myconnect_invoice` | My-Connect invoice (purchases/sales) per period (MMYYYY) |
| `get_myconnect_cdr` | My-Connect CDR totals per period/grouping |

## Development

```bash
npm test        # unit tests (no network)
npm run smoke   # manual live-API smoke test (needs real credentials)
```

API notes captured from the partner docs portal: [docs/api-reference.md](docs/api-reference.md).

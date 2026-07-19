#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { BusinessComClient } from './client.js'
import { createServer } from './server.js'

const username = process.env.BUSINESSCOM_USERNAME
const password = process.env.BUSINESSCOM_PASSWORD
if (!username || !password) {
  console.error('businesscom-mcp: BUSINESSCOM_USERNAME and BUSINESSCOM_PASSWORD must be set')
  process.exit(1)
}

const client = new BusinessComClient({
  username,
  password,
  baseUrl: process.env.BUSINESSCOM_BASE_URL,
})

const server = createServer(client)
await server.connect(new StdioServerTransport())

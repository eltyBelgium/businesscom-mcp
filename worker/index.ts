import { McpAgent } from 'agents/mcp'
import { BusinessComClient } from '../src/client.js'
import { createServer } from '../src/server.js'

export interface Env {
  BUSINESSCOM_USERNAME: string
  BUSINESSCOM_PASSWORD: string
  BUSINESSCOM_BASE_URL?: string
  BUSINESSCOM_MCP: DurableObjectNamespace
}

export class BusinessComMcp extends McpAgent<Env> {
  server!: ReturnType<typeof createServer>

  async init() {
    this.server = createServer(
      new BusinessComClient({
        username: this.env.BUSINESSCOM_USERNAME,
        password: this.env.BUSINESSCOM_PASSWORD,
        baseUrl: this.env.BUSINESSCOM_BASE_URL,
      }),
    )
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return BusinessComMcp.serve('/mcp', { binding: 'BUSINESSCOM_MCP' }).fetch(request, env, ctx)
    }
    return new Response('Not found', { status: 404 })
  },
}

import OAuthProvider, { type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { BusinessComClient } from '../src/client.js'
import { createServer } from '../src/server.js'
import { verifyAccessJwt } from './access-jwt.js'

export interface Env {
  BUSINESSCOM_USERNAME: string
  BUSINESSCOM_PASSWORD: string
  BUSINESSCOM_BASE_URL?: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  BUSINESSCOM_MCP: DurableObjectNamespace<BusinessComMcp>
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers
}

// Server-only agent. Do not add outbound MCP-client features (this.mcp / addMcpServer):
// the installed agents package calls zod v4's z.fromJSONSchema on that path, which
// crashes at runtime against this project's zod v3 (installed with --legacy-peer-deps).
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

/**
 * Non-OAuth routes: /mcp (Cloudflare Access service token, used by Claude Code),
 * /authorize (Cloudflare Access SSO -> immediate OAuth grant), 404 otherwise.
 */
const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return BusinessComMcp.serve('/mcp', { binding: 'BUSINESSCOM_MCP' }).fetch(request, env, ctx)
    }

    if (url.pathname === '/authorize') {
      if (!env.ACCESS_AUD) {
        return new Response(
          'ACCESS_AUD is not configured — create the Zero Trust Access app for /authorize and set its AUD tag.',
          { status: 500 },
        )
      }
      let email: string
      try {
        const claims = await verifyAccessJwt(
          request.headers.get('Cf-Access-Jwt-Assertion'),
          env.ACCESS_TEAM_DOMAIN,
          env.ACCESS_AUD,
        )
        email = claims.email
      } catch {
        return new Response('Cloudflare Access authentication required', { status: 403 })
      }
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: email,
        metadata: {},
        scope: oauthReq.scope ?? [],
        props: { email },
      })
      return Response.redirect(redirectTo, 302)
    }

    return new Response('Not found', { status: 404 })
  },
}

export default new OAuthProvider<Env>({
  apiRoute: '/oauth/mcp',
  apiHandler: BusinessComMcp.serve('/oauth/mcp', { binding: 'BUSINESSCOM_MCP' }),
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})

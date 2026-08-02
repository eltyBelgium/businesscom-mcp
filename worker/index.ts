import OAuthProvider, { type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { BusinessComClient } from '../src/client.js'
import { createServer } from '../src/server.js'
import { verifyAccessJwt } from './access-jwt.js'

// Only Claude's official OAuth callbacks may receive authorization codes.
const ALLOWED_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]

export interface Env {
  BUSINESSCOM_USERNAME: string
  BUSINESSCOM_PASSWORD: string
  BUSINESSCOM_BASE_URL?: string
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  ACCESS_MCP_AUD: string
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
      // Defense in depth: when ACCESS_MCP_AUD is set, verify the Access JWT
      // in-worker as well (service tokens carry common_name, not email).
      // When empty, gating happens at the Cloudflare Access edge only.
      if (env.ACCESS_MCP_AUD) {
        try {
          await verifyAccessJwt(
            request.headers.get('Cf-Access-Jwt-Assertion'),
            env.ACCESS_TEAM_DOMAIN,
            env.ACCESS_MCP_AUD,
            { requireEmail: false },
          )
        } catch (err) {
          console.error('/mcp Access JWT verification failed:', err)
          return new Response('Cloudflare Access authentication required', { status: 403 })
        }
      }
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
        if (typeof claims.email !== 'string') {
          throw new Error('Access token has no email claim')
        }
        email = claims.email
      } catch (err) {
        console.error('/authorize Access JWT verification failed:', err)
        return new Response('Cloudflare Access authentication required', { status: 403 })
      }
      try {
        const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request)
        if (!ALLOWED_REDIRECT_URIS.includes(oauthReq.redirectUri)) {
          // Plain response — never redirect errors to an unvetted redirect_uri.
          return new Response('redirect_uri not allowed', { status: 400 })
        }
        const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: oauthReq,
          userId: email,
          metadata: {},
          scope: oauthReq.scope ?? [],
          props: { email },
        })
        return Response.redirect(redirectTo, 302)
      } catch (err) {
        console.error('/authorize OAuth request handling failed:', err)
        return new Response('Invalid authorization request', { status: 400 })
      }
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
  // Bound how long tokens outlive an Access deprovisioning.
  refreshTokenTTL: 7 * 24 * 60 * 60,
  // claude.ai uses S256; plain PKCE offers no cryptographic protection.
  allowPlainPKCE: false,
  // Reject registrations whose redirect_uris fall outside the Claude allowlist,
  // so attacker-registered clients can never receive authorization codes.
  clientRegistrationCallback: ({ clientMetadata }) => {
    const uris = clientMetadata.redirect_uris
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      !uris.every((uri) => typeof uri === 'string' && ALLOWED_REDIRECT_URIS.includes(uri))
    ) {
      return {
        code: 'invalid_client_metadata',
        description: 'redirect_uris must be Claude OAuth callbacks',
      }
    }
  },
})

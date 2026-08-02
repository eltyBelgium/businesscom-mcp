import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessClaims {
  email?: string
  sub?: string
  [claim: string]: unknown
}

export interface VerifyAccessJwtOptions {
  /**
   * Require an `email` claim (interactive SSO tokens). Set to false for
   * service-token JWTs, which carry `common_name` instead of `email`.
   * Signature, issuer, audience, and expiry are always verified.
   */
  requireEmail?: boolean
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/**
 * Verify a Cloudflare Access JWT (Cf-Access-Jwt-Assertion header) against the
 * team's public keys. Throws on missing/invalid/expired tokens or AUD mismatch.
 */
export async function verifyAccessJwt(
  jwt: string | null,
  teamDomain: string,
  aud: string,
  options: VerifyAccessJwtOptions = {},
): Promise<AccessClaims> {
  const { requireEmail = true } = options
  if (!jwt) throw new Error('Missing Cf-Access-Jwt-Assertion header')
  let jwks = jwksCache.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    jwksCache.set(teamDomain, jwks)
  }
  const { payload } = await jwtVerify(jwt, jwks, {
    issuer: `https://${teamDomain}`,
    audience: aud,
    algorithms: ['RS256'],
  })
  if (requireEmail && typeof payload.email !== 'string') {
    throw new Error('Access token has no email claim')
  }
  return payload as AccessClaims
}

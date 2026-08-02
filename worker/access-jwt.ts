import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessClaims {
  email: string
  sub?: string
  [claim: string]: unknown
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
): Promise<AccessClaims> {
  if (!jwt) throw new Error('Missing Cf-Access-Jwt-Assertion header')
  let jwks = jwksCache.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    jwksCache.set(teamDomain, jwks)
  }
  const { payload } = await jwtVerify(jwt, jwks, {
    issuer: `https://${teamDomain}`,
    audience: aud,
  })
  if (typeof payload.email !== 'string') {
    throw new Error('Access token has no email claim')
  }
  return payload as AccessClaims
}

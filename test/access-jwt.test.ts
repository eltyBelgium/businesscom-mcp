import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { verifyAccessJwt } from '../worker/access-jwt.js'

const TEAM = 'elty.cloudflareaccess.com'
const AUD = 'test-aud-tag'

let privateKey: CryptoKey
let jwks: { keys: unknown[] }

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as CryptoKey
  const jwk = await exportJWK(pair.publicKey)
  jwks = { keys: [{ ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' }] }
})

function stubJwksFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string | URL) => {
      expect(String(url)).toBe(`https://${TEAM}/cdn-cgi/access/certs`)
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

async function sign(payload: Record<string, unknown>, expiresIn = '5m') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt()
    .setIssuer(`https://${TEAM}`)
    .setAudience(AUD)
    .setExpirationTime(expiresIn)
    .sign(privateKey)
}

describe('verifyAccessJwt', () => {
  it('returns the email claim for a valid token', async () => {
    stubJwksFetch()
    const jwt = await sign({ email: 'tyas@elty.be' })
    const claims = await verifyAccessJwt(jwt, TEAM, AUD)
    expect(claims.email).toBe('tyas@elty.be')
  })

  it('rejects a token with the wrong audience', async () => {
    stubJwksFetch()
    const jwt = await sign({ email: 'tyas@elty.be' })
    await expect(verifyAccessJwt(jwt, TEAM, 'other-aud')).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    stubJwksFetch()
    const jwt = await new SignJWT({ email: 'x@elty.be' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(privateKey)
    await expect(verifyAccessJwt(jwt, TEAM, AUD)).rejects.toThrow()
  })

  it('rejects garbage and missing tokens', async () => {
    stubJwksFetch()
    await expect(verifyAccessJwt('not-a-jwt', TEAM, AUD)).rejects.toThrow()
    await expect(verifyAccessJwt(null, TEAM, AUD)).rejects.toThrow(/[Mm]issing/)
  })

  it('rejects a well-formed token signed by a different key', async () => {
    stubJwksFetch()
    const attacker = await generateKeyPair('RS256')
    const forged = await new SignJWT({ email: 'mallory@evil.example' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuedAt()
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime('5m')
      .sign(attacker.privateKey as CryptoKey)
    await expect(verifyAccessJwt(forged, TEAM, AUD)).rejects.toThrow()
  })
})

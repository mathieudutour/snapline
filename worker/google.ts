import { base64urlDecode } from './util'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

export interface GoogleIdentity {
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture: string
}

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  /** injectable for tests */
  fetch?: typeof fetch
  now?: () => number
}

export function buildAuthUrl(cfg: GoogleConfig, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params}`
}

export async function exchangeCode(cfg: GoogleConfig, code: string, redirectUri: string, codeVerifier: string): Promise<string> {
  const f = cfg.fetch ?? fetch
  const res = await f(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  const body = (await res.json()) as { id_token?: string }
  if (!body.id_token) throw new Error('no id_token in token response')
  return body.id_token
}

interface Jwk {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null

async function getJwks(f: typeof fetch, now: number): Promise<Jwk[]> {
  if (jwksCache && now - jwksCache.fetchedAt < 6 * 3600 * 1000) return jwksCache.keys
  const res = await f(GOOGLE_JWKS_URL)
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`)
  const body = (await res.json()) as { keys: Jwk[] }
  jwksCache = { keys: body.keys, fetchedAt: now }
  return body.keys
}

export function resetJwksCache() {
  jwksCache = null
}

/** Verify a Google ID token (RS256) and return the identity it asserts. */
export async function verifyIdToken(cfg: GoogleConfig, idToken: string): Promise<GoogleIdentity> {
  const f = cfg.fetch ?? fetch
  const now = (cfg.now ?? Date.now)()
  const [h, p, s] = idToken.split('.')
  if (!h || !p || !s) throw new Error('malformed token')
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(h))) as { alg: string; kid: string }
  if (header.alg !== 'RS256') throw new Error('unexpected alg')
  let keys = await getJwks(f, now)
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) {
    // key rotation: refresh once
    resetJwksCache()
    keys = await getJwks(f, now)
    jwk = keys.find((k) => k.kid === header.kid)
  }
  if (!jwk) throw new Error('unknown signing key')
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlDecode(s), new TextEncoder().encode(`${h}.${p}`))
  if (!ok) throw new Error('bad signature')
  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(p))) as Record<string, unknown>
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('bad issuer')
  if (claims.aud !== cfg.clientId) throw new Error('bad audience')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new Error('token expired')
  if (typeof claims.sub !== 'string') throw new Error('no subject')
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : '',
    picture: typeof claims.picture === 'string' ? claims.picture : '',
  }
}

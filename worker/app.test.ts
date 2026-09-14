import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, SESSION_COOKIE } from './app'
import { MemoryStore } from './store'
import { base64url, parseCookies } from './util'
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, resetJwksCache } from './google'

const ORIGIN = 'https://plans.example.com'
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'

async function makeGoogle() {
  const keyPair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey
  const kid = 'test-key-1'
  const sign = async (claims: Record<string, unknown>) => {
    const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)))
    const signingInput = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(signingInput))
    return `${signingInput}.${base64url(sig)}`
  }
  let nextIdToken = ''
  const fetchStub: typeof fetch = async (input) => {
    const url = String(input)
    if (url === GOOGLE_JWKS_URL) return new Response(JSON.stringify({ keys: [{ kid, kty: 'RSA', n: pub.n, e: pub.e, alg: 'RS256' }] }))
    if (url === GOOGLE_TOKEN_URL) return new Response(JSON.stringify({ id_token: nextIdToken }))
    return new Response('not found', { status: 404 })
  }
  return { sign, fetchStub, setIdToken: (t: string) => (nextIdToken = t) }
}

function setCookieHeaders(res: Response): string[] {
  return res.headers.getSetCookie()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (res: Response): Promise<any> => res.json()

describe('worker app', () => {
  let store: MemoryStore
  let handle: (req: Request) => Promise<Response>
  let google: Awaited<ReturnType<typeof makeGoogle>>

  beforeEach(async () => {
    resetJwksCache()
    store = new MemoryStore()
    google = await makeGoogle()
    handle = createApp({ store, google: { clientId: CLIENT_ID, clientSecret: 'secret', fetch: google.fetchStub } })
  })

  async function signIn(claims: Partial<Record<string, unknown>> = {}) {
    const start = await handle(new Request(`${ORIGIN}/auth/google`))
    expect(start.status).toBe(302)
    const location = new URL(start.headers.get('Location')!)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    const oauthCookie = parseCookies(setCookieHeaders(start)[0].split(';')[0])
    const state = location.searchParams.get('state')!
    const idToken = await google.sign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-sub-1', email: 'mathieu@example.com', email_verified: true, name: 'Mathieu', picture: 'https://p/x.png', exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
    google.setIdToken(idToken)
    const cb = await handle(new Request(`${ORIGIN}/auth/google/callback?code=abc&state=${state}`, { headers: { Cookie: `sl_oauth=${encodeURIComponent(oauthCookie.sl_oauth)}` } }))
    return cb
  }

  it('completes the Google sign-in flow and sets a session cookie', async () => {
    const cb = await signIn()
    expect(cb.status).toBe(302)
    expect(cb.headers.get('Location')).toBe('/')
    const session = setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE + '='))!
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
    const token = parseCookies(session.split(';')[0])[SESSION_COOKIE]
    const me = await handle(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }))
    expect((await body(me)).user.email).toBe('mathieu@example.com')
    expect(store.users.size).toBe(1)
  })

  it('rejects a tampered state and a token for another audience', async () => {
    const start = await handle(new Request(`${ORIGIN}/auth/google`))
    const cookie = parseCookies(setCookieHeaders(start)[0].split(';')[0]).sl_oauth
    const bad = await handle(new Request(`${ORIGIN}/auth/google/callback?code=abc&state=wrong`, { headers: { Cookie: `sl_oauth=${encodeURIComponent(cookie)}` } }))
    expect(bad.status).toBe(400)
    const wrongAud = await signIn({ aud: 'someone-else' })
    expect(wrongAud.status).toBe(401)
    const unverified = await signIn({ email_verified: false })
    expect(unverified.status).toBe(403)
  })

  it('stores, lists, updates and deletes projects per user', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    const put = await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project }) }))
    expect(put.status).toBe(200)
    const list = await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth })))
    expect(list.projects).toHaveLength(1)
    expect(list.projects[0].name).toBe('House')
    const got = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth })))
    expect(got.project.floors).toHaveLength(1)
    // another user cannot see or overwrite it
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth2 = { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth2 }))).status).toBe(404)
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth2, body: JSON.stringify({ project: { ...project, name: 'Hijack' } }) }))
    const still = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth })))
    expect(still.project.name).toBe('House')
    // delete
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'DELETE', headers: auth }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth }))).status).toBe(404)
  })

  it('requires a matching Origin on mutations and a session on the API', async () => {
    const noAuth = await handle(new Request(`${ORIGIN}/api/projects`))
    expect(noAuth.status).toBe(401)
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const crossSite = await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: 'https://evil.example' }, body: '{}' }))
    expect(crossSite.status).toBe(403)
    const logout = await handle(new Request(`${ORIGIN}/auth/logout`, { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN } }))
    expect(logout.status).toBe(200)
    const after = await handle(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } }))
    expect((await body(after)).user).toBeNull()
  })
})

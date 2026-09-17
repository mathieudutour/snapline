import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, LIMITS, SESSION_COOKIE } from './app'
import { MemoryObjects, MemoryStore } from './store'
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
  let objects: MemoryObjects
  let handle: (req: Request) => Promise<Response>
  let google: Awaited<ReturnType<typeof makeGoogle>>

  beforeEach(async () => {
    resetJwksCache()
    store = new MemoryStore()
    objects = new MemoryObjects()
    google = await makeGoogle()
    handle = createApp({ store, objects, google: { clientId: CLIENT_ID, clientSecret: 'secret', fetch: google.fetchStub } })
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

  it('deletes an account with its projects, memberships, models and sessions', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj-del', name: 'Mine', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj-del`, { method: 'PUT', headers: auth, body: JSON.stringify({ project }) }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/models/u-abcdefabcdef`, { method: 'PUT', headers: auth, body: JSON.stringify({ name: 'Chair', width: 1, depth: 1, height: 1, fit: {} }) }))).status).toBe(200)
    // a second user shares a project with the first, who then deletes their account
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth2 = { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }
    await handle(new Request(`${ORIGIN}/api/projects/prj-theirs`, { method: 'PUT', headers: auth2, body: JSON.stringify({ project: { ...project, id: 'prj-theirs', name: 'Theirs' } }) }))
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj-theirs/members`, { method: 'POST', headers: auth2, body: JSON.stringify({ email: 'mathieu@example.com', role: 'editor' }) }))).status).toBe(200)
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth })))).projects).toHaveLength(2)

    expect((await handle(new Request(`${ORIGIN}/api/me`, { method: 'DELETE', headers: { Origin: ORIGIN } }))).status).toBe(401)
    const del = await handle(new Request(`${ORIGIN}/api/me`, { method: 'DELETE', headers: auth }))
    expect(del.status).toBe(200)
    expect(setCookieHeaders(del).some((c) => c.startsWith(SESSION_COOKIE) && /Max-Age=0/i.test(c))).toBe(true)
    // the session is gone, and so is everything the account owned
    expect((await body(await handle(new Request(`${ORIGIN}/api/me`, { headers: auth })))).user).toBeNull()
    expect(store.projects.has('prj-del')).toBe(false)
    expect(store.models.size).toBe(0)
    expect(store.users.size).toBe(1)
    // the other user's project survives, minus the deleted member
    const theirs = await body(await handle(new Request(`${ORIGIN}/api/projects/prj-theirs/members`, { headers: auth2 })))
    expect(theirs.members).toHaveLength(0)
    // signing in again with the same Google account starts from nothing
    resetJwksCache()
    const cb3 = await signIn()
    const token3 = parseCookies(setCookieHeaders(cb3).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: { ...auth, Cookie: `${SESSION_COOKIE}=${token3}` } })))).projects).toHaveLength(0)
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

  it('stores imported model metadata and files per user', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN }
    const key = 'u-0123456789ab'
    // files before metadata are refused
    const early = await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'model/gltf-binary' }, body: new Uint8Array([1, 2, 3]) }))
    expect(early.status).toBe(404)
    const meta = await handle(new Request(`${ORIGIN}/api/models/${key}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Chair', width: 0.5, depth: 0.5, height: 0.9, fit: { unitScale: 1, center: [0, 0, 0] } }) }))
    expect(meta.status).toBe(200)
    const up = await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'model/gltf-binary' }, body: new Uint8Array([1, 2, 3, 4]) }))
    expect(up.status).toBe(200)
    const list = await body(await handle(new Request(`${ORIGIN}/api/models`, { headers: auth })))
    expect(list.storage).toBe(true)
    expect(list.models).toHaveLength(1)
    expect(list.models[0].fit.unitScale).toBe(1)
    const down = await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { headers: auth }))
    expect(down.status).toBe(200)
    expect(down.headers.get('Content-Type')).toBe('model/gltf-binary')
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    // another user sees nothing
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const other = await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { headers: { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` } }))
    expect(other.status).toBe(404)
    // delete removes metadata and files
    expect((await handle(new Request(`${ORIGIN}/api/models/${key}`, { method: 'DELETE', headers: auth }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { headers: auth }))).status).toBe(404)
  })

  it('reports missing file storage instead of failing uploads when no bucket is bound', async () => {
    handle = createApp({ store, google: { clientId: CLIENT_ID, clientSecret: 'secret', fetch: google.fetchStub } })
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN }
    const list = await body(await handle(new Request(`${ORIGIN}/api/models`, { headers: auth })))
    expect(list.storage).toBe(false)
    expect(list.models).toEqual([])
    const key = 'u-0123456789ab'
    const meta = await handle(new Request(`${ORIGIN}/api/models/${key}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Chair', width: 0.5, depth: 0.5, height: 0.9, fit: { unitScale: 1, center: [0, 0, 0] } }) }))
    expect(meta.status).toBe(200)
    const up = await handle(new Request(`${ORIGIN}/api/models/${key}/glb`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'model/gltf-binary' }, body: new Uint8Array([1]) }))
    expect(up.status).toBe(503)
  })

  it('shares a project with an email and lets both sides save on the same version chain', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    const created = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project, baseVersion: 0 }) })))
    expect(created.version).toBe(1)
    // only the owner can invite, and only valid addresses
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'nope' }) }))).status).toBe(400)
    const invited = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: ' Other@Example.com ' }) })))
    expect(invited.members.map((m: { email: string }) => m.email)).toEqual(['other@example.com'])
    // the invitee signs in and sees the project as an editor
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com', name: 'Other' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth2 = { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }
    const list2 = await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth2 })))
    expect(list2.projects).toHaveLength(1)
    expect(list2.projects[0].role).toBe('editor')
    expect(list2.projects[0].owner.email).toBe('mathieu@example.com')
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth2, body: JSON.stringify({ email: 'third@example.com' }) }))).status).toBe(403)
    // the editor saves on top of version 1 → version 2, recorded as theirs
    const saved = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth2, body: JSON.stringify({ project: { ...project, name: 'House v2' }, baseVersion: 1 }) })))
    expect(saved.version).toBe(2)
    const owner = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth })))
    expect(owner.project.name).toBe('House v2')
    expect(owner.updatedBy.email).toBe('other@example.com')
    const members = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { headers: auth })))
    expect(members.members[0].name).toBe('Other')
    expect(members.role).toBe('owner')
    // the editor leaves; the project is still there for the owner but gone for them
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'DELETE', headers: auth2 }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth2 }))).status).toBe(404)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth }))).status).toBe(200)
    // removing by the owner and self-only removal for members
    await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'other@example.com' }) }))
    await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'third@example.com' }) }))
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members/third%40example.com`, { method: 'DELETE', headers: auth2 }))).status).toBe(403)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members/third%40example.com`, { method: 'DELETE', headers: auth }))).status).toBe(200)
    const after = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { headers: auth })))
    expect(after.members.map((m: { email: string }) => m.email)).toEqual(['other@example.com'])
  })

  it('rejects a save based on a stale version and accepts a forced overwrite', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project, baseVersion: 0 }) }))
    const v2 = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project: { ...project, name: 'Device A' }, baseVersion: 1 }) })))
    expect(v2.version).toBe(2)
    // device B still thinks it is on version 1
    const stale = await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project: { ...project, name: 'Device B' }, baseVersion: 1 }) }))
    expect(stale.status).toBe(409)
    const conflict = await body(stale)
    expect(conflict.conflict).toBe(true)
    expect(conflict.version).toBe(2)
    expect(conflict.project.name).toBe('Device A')
    expect(conflict.updatedBy.email).toBe('mathieu@example.com')
    // nothing was written
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth })))).project.name).toBe('Device A')
    // the user chooses to overwrite
    const forced = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project: { ...project, name: 'Device B' }, baseVersion: 1, force: true }) })))
    expect(forced.version).toBe(3)
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth })))).project.name).toBe('Device B')
    // a project id that belongs to someone else cannot be created over
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const hijack = await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }, body: JSON.stringify({ project, baseVersion: 0 }) }))
    expect(hijack.status).toBe(403)
  })

  it('supports read-only viewers and a view link that needs no account', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project, baseVersion: 0 }) }))
    const invited = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'other@example.com', role: 'viewer' }) })))
    expect(invited.members[0].role).toBe('viewer')
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com', name: 'Other' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth2 = { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }
    const list2 = await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth2 })))
    expect(list2.projects[0].role).toBe('viewer')
    expect(list2.projects[0].viewToken).toBeNull() // only the owner sees the link token
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1`, { headers: auth2 }))).status).toBe(200)
    const denied = await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth2, body: JSON.stringify({ project: { ...project, name: 'Nope' }, baseVersion: 1 }) }))
    expect(denied.status).toBe(403)
    // promote to editor by inviting again with the new role
    await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'other@example.com', role: 'editor' }) }))
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth2 })))).projects[0].role).toBe('editor')
    // view link: owner only, works signed out, can be revoked
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/link`, { method: 'POST', headers: auth2 }))).status).toBe(403)
    expect((await body(await handle(new Request(`${ORIGIN}/api/view/nope-nope-nope`)))).error).toBeDefined()
    const linked = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/link`, { method: 'POST', headers: auth })))
    expect(linked.token).toMatch(/^[A-Za-z0-9_-]{8,}$/)
    const again = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/link`, { method: 'POST', headers: auth })))
    expect(again.token).toBe(linked.token)
    const viewed = await body(await handle(new Request(`${ORIGIN}/api/view/${linked.token}`)))
    expect(viewed.project.name).toBe('House')
    expect(viewed.owner.email).toBe('mathieu@example.com')
    expect((await body(await handle(new Request(`${ORIGIN}/api/projects`, { headers: auth })))).projects[0].viewToken).toBe(linked.token)
    await handle(new Request(`${ORIGIN}/api/projects/prj1/link`, { method: 'DELETE', headers: auth }))
    expect((await handle(new Request(`${ORIGIN}/api/view/${linked.token}`))).status).toBe(404)
  })

  it('answers 429 once the limiter says no, and caps how many people a project is shared with', async () => {
    let allowed = 3
    const kinds: string[] = []
    handle = createApp({ store, google: { clientId: CLIENT_ID, clientSecret: 'secret', fetch: google.fetchStub }, limiter: async (kind) => (kinds.push(kind), allowed-- > 0) })
    expect((await handle(new Request(`${ORIGIN}/api/me`))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/auth/google`))).status).toBe(302)
    expect((await handle(new Request(`${ORIGIN}/api/me`))).status).toBe(200)
    const blocked = await handle(new Request(`${ORIGIN}/api/me`))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('10')
    expect(kinds).toEqual(['api', 'strict', 'api', 'api'])
    // caps
    allowed = 1000
    resetJwksCache()
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project, baseVersion: 0 }) }))
    for (let i = 0; i < LIMITS.membersPerProject; i++) expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: `p${i}@example.com` }) }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'one-too-many@example.com' }) }))).status).toBe(429)
    // changing the role of an existing member is still fine at the cap
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'p1@example.com', role: 'viewer' }) }))).status).toBe(200)
  })

  it('stores plan underlay images per project for members and view links', async () => {
    const cb = await signIn()
    const token = parseCookies(setCookieHeaders(cb).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth = { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const project = { id: 'prj1', name: 'House', floors: [{ id: 'f', name: 'Ground', plan: {} }], roof: { type: 'none' } }
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'PUT', headers: auth, body: JSON.stringify({ project, baseVersion: 0 }) }))
    const png = new Uint8Array([137, 80, 78, 71])
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'text/html' }, body: png }))).status).toBe(415)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/png' }, body: png }))).status).toBe(200)
    const got = await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { headers: auth }))
    expect(got.status).toBe(200)
    expect(got.headers.get('Content-Type')).toBe('image/png')
    // a viewer can read, not write; a link visitor can read
    await handle(new Request(`${ORIGIN}/api/projects/prj1/members`, { method: 'POST', headers: auth, body: JSON.stringify({ email: 'other@example.com', role: 'viewer' }) }))
    resetJwksCache()
    const cb2 = await signIn({ sub: 'google-sub-2', email: 'other@example.com' })
    const token2 = parseCookies(setCookieHeaders(cb2).find((c) => c.startsWith(SESSION_COOKIE))!.split(';')[0])[SESSION_COOKIE]
    const auth2 = { ...auth, Cookie: `${SESSION_COOKIE}=${token2}` }
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { headers: auth2 }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { method: 'PUT', headers: { ...auth2, 'Content-Type': 'image/png' }, body: png }))).status).toBe(403)
    const linked = await body(await handle(new Request(`${ORIGIN}/api/projects/prj1/link`, { method: 'POST', headers: auth })))
    expect((await handle(new Request(`${ORIGIN}/api/view/${linked.token}/files/uf-abcd`))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/view/${linked.token}/files/uf-nope`))).status).toBe(404)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { method: 'DELETE', headers: auth }))).status).toBe(200)
    expect((await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-abcd`, { headers: auth }))).status).toBe(404)
    // deleting the project removes its files
    await handle(new Request(`${ORIGIN}/api/projects/prj1/files/uf-keep`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'image/png' }, body: png }))
    expect(objects.objects.has('projects/prj1/uf-keep')).toBe(true)
    await handle(new Request(`${ORIGIN}/api/projects/prj1`, { method: 'DELETE', headers: auth }))
    expect(objects.objects.has('projects/prj1/uf-keep')).toBe(false)
  })
})

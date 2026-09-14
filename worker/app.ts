import type { ObjectStore, Store, User } from './store'
import { buildAuthUrl, exchangeCode, verifyIdToken, type GoogleConfig } from './google'
import { error, json, parseCookies, randomToken, serializeCookie, sha256Base64url, sha256Hex } from './util'

export const SESSION_COOKIE = 'sl_session'
const OAUTH_COOKIE = 'sl_oauth'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const MAX_PROJECT_BYTES = 2 * 1024 * 1024
const MAX_MODEL_BYTES = 15 * 1024 * 1024
const MAX_ICON_BYTES = 512 * 1024

export interface AppConfig {
  store: Store
  /** file storage for imported models; undefined when no bucket is bound */
  objects?: ObjectStore
  google: GoogleConfig
  now?: () => number
  /** set to false for local http dev */
  secureCookies?: boolean
}

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, picture: u.picture }
}

export function createApp(cfg: AppConfig) {
  const now = cfg.now ?? Date.now
  const secure = cfg.secureCookies ?? true

  async function currentUser(req: Request): Promise<{ user: User; tokenHash: string } | null> {
    const token = parseCookies(req.headers.get('Cookie'))[SESSION_COOKIE]
    if (!token) return null
    const tokenHash = await sha256Hex(token)
    const session = await cfg.store.getSession(tokenHash)
    if (!session) return null
    if (session.expiresAt < now()) {
      await cfg.store.deleteSession(tokenHash)
      return null
    }
    const user = await cfg.store.getUser(session.userId)
    return user ? { user, tokenHash } : null
  }

  /** browsers send Origin on cross-site and same-site POST/PUT/DELETE; require it to match */
  function csrfOk(req: Request, url: URL): boolean {
    if (req.method === 'GET' || req.method === 'HEAD') return true
    const origin = req.headers.get('Origin')
    return origin === url.origin
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const redirectUri = `${url.origin}/auth/google/callback`

    // ---- auth ----
    if (path === '/auth/google' && req.method === 'GET') {
      const state = randomToken(16)
      const verifier = randomToken(32)
      const challenge = await sha256Base64url(verifier)
      const returnTo = url.searchParams.get('return') ?? '/'
      const headers = new Headers({ Location: buildAuthUrl(cfg.google, redirectUri, state, challenge) })
      headers.append('Set-Cookie', serializeCookie(OAUTH_COOKIE, `${state}.${verifier}.${encodeURIComponent(returnTo)}`, { maxAge: 600, secure, path: '/auth' }))
      return new Response(null, { status: 302, headers })
    }
    if (path === '/auth/google/callback' && req.method === 'GET') {
      const cookie = parseCookies(req.headers.get('Cookie'))[OAUTH_COOKIE]
      const [state, verifier, returnTo] = (cookie ?? '').split('.')
      const clear = serializeCookie(OAUTH_COOKIE, '', { maxAge: 0, secure, path: '/auth' })
      if (!state || !verifier || url.searchParams.get('state') !== state) return new Response('Sign-in failed: invalid state. Please try again.', { status: 400, headers: { 'Set-Cookie': clear } })
      const code = url.searchParams.get('code')
      if (!code) return new Response(`Sign-in cancelled (${url.searchParams.get('error') ?? 'no code'}).`, { status: 400, headers: { 'Set-Cookie': clear } })
      let identity
      try {
        const idToken = await exchangeCode(cfg.google, code, redirectUri, verifier)
        identity = await verifyIdToken(cfg.google, idToken)
      } catch (e) {
        return new Response(`Sign-in failed: ${(e as Error).message}`, { status: 401, headers: { 'Set-Cookie': clear } })
      }
      if (!identity.emailVerified) return new Response('Sign-in failed: Google account email is not verified.', { status: 403, headers: { 'Set-Cookie': clear } })
      const user = await cfg.store.upsertUser({ googleSub: identity.sub, email: identity.email, name: identity.name, picture: identity.picture })
      const token = randomToken(32)
      await cfg.store.createSession({ tokenHash: await sha256Hex(token), userId: user.id, expiresAt: now() + SESSION_TTL_MS })
      const headers = new Headers({ Location: safeReturn(returnTo ? decodeURIComponent(returnTo) : '/') })
      headers.append('Set-Cookie', clear)
      headers.append('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000, secure }))
      return new Response(null, { status: 302, headers })
    }
    if (path === '/auth/logout' && req.method === 'POST') {
      if (!csrfOk(req, url)) return error(403, 'bad origin')
      const me = await currentUser(req)
      if (me) await cfg.store.deleteSession(me.tokenHash)
      return json({ ok: true }, { headers: { 'Set-Cookie': serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure }) } })
    }

    // ---- api ----
    if (path.startsWith('/api/')) {
      if (!csrfOk(req, url)) return error(403, 'bad origin')
      const me = await currentUser(req)
      if (path === '/api/me' && req.method === 'GET') return json({ user: me ? publicUser(me.user) : null })
      if (!me) return error(401, 'sign in required')
      const userId = me.user.id
      if (path === '/api/projects' && req.method === 'GET') return json({ projects: await cfg.store.listProjects(userId) })
      const m = /^\/api\/projects\/([A-Za-z0-9_-]{1,64})$/.exec(path)
      if (m) {
        const id = m[1]
        if (req.method === 'GET') {
          const row = await cfg.store.getProject(userId, id)
          if (!row) return error(404, 'not found')
          return json({ project: JSON.parse(row.data), updatedAt: row.updatedAt })
        }
        if (req.method === 'PUT') {
          const text = await req.text()
          if (text.length > MAX_PROJECT_BYTES) return error(413, 'project too large')
          let body: { project?: Record<string, unknown> }
          try {
            body = JSON.parse(text)
          } catch {
            return error(400, 'invalid json')
          }
          const project = body.project
          if (!project || typeof project !== 'object' || !Array.isArray(project.floors)) return error(400, 'invalid project')
          const existing = await cfg.store.getProject(userId, id)
          const updatedAt = now()
          const name = typeof project.name === 'string' && project.name.trim() ? project.name : 'Untitled project'
          await cfg.store.putProject({ id, userId, name, data: JSON.stringify({ ...project, id, updatedAt }), updatedAt, createdAt: existing?.createdAt ?? updatedAt })
          return json({ ok: true, updatedAt })
        }
        if (req.method === 'DELETE') {
          await cfg.store.deleteProject(userId, id)
          return json({ ok: true })
        }
      }
      // ---- imported 3D models ----
      if (path === '/api/models' && req.method === 'GET') {
        const rows = await cfg.store.listModels(userId)
        return json({ models: rows.map((r) => ({ key: r.key, name: r.name, width: r.width, depth: r.depth, height: r.height, fit: JSON.parse(r.fit), createdAt: r.createdAt })) })
      }
      const mm = /^\/api\/models\/(u-[a-f0-9]{12})(?:\/(glb|plan|thumb))?$/.exec(path)
      if (mm) {
        const key = mm[1]
        const part = mm[2] as 'glb' | 'plan' | 'thumb' | undefined
        const objectKey = (p: string) => `users/${userId}/${key}.${p}`
        if (!part) {
          if (req.method === 'PUT') {
            let body: Record<string, unknown>
            try {
              body = JSON.parse(await req.text())
            } catch {
              return error(400, 'invalid json')
            }
            const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
            const width = num(body.width)
            const depth = num(body.depth)
            const height = num(body.height)
            if (!width || !depth || !height || typeof body.fit !== 'object' || !body.fit) return error(400, 'invalid model')
            const existing = await cfg.store.getModel(userId, key)
            await cfg.store.putModel({ key, userId, name: typeof body.name === 'string' && body.name.trim() ? body.name.slice(0, 120) : 'Model', width, depth, height, fit: JSON.stringify(body.fit), createdAt: existing?.createdAt ?? (typeof body.createdAt === 'number' ? body.createdAt : now()) })
            return json({ ok: true })
          }
          if (req.method === 'DELETE') {
            await cfg.store.deleteModel(userId, key)
            if (cfg.objects) await Promise.all(['glb', 'plan', 'thumb'].map((p) => cfg.objects!.delete(objectKey(p))))
            return json({ ok: true })
          }
          return error(404, 'not found')
        }
        if (!cfg.objects) return error(503, 'model storage is not configured')
        if (req.method === 'PUT') {
          const length = Number(req.headers.get('content-length') ?? '0')
          const cap = part === 'glb' ? MAX_MODEL_BYTES : MAX_ICON_BYTES
          if (length > cap) return error(413, 'file too large')
          if (!(await cfg.store.getModel(userId, key))) return error(404, 'register the model metadata first')
          const buf = await req.arrayBuffer()
          if (buf.byteLength > cap) return error(413, 'file too large')
          await cfg.objects.put(objectKey(part), buf, part === 'glb' ? 'model/gltf-binary' : 'image/png')
          return json({ ok: true })
        }
        if (req.method === 'GET') {
          if (!(await cfg.store.getModel(userId, key))) return error(404, 'not found')
          const obj = await cfg.objects.get(objectKey(part))
          if (!obj) return error(404, 'not found')
          return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' } })
        }
      }
      return error(404, 'not found')
    }
    return error(404, 'not found')
  }
}

/** only allow same-site relative paths as post-login destinations */
function safeReturn(to: string): string {
  return to.startsWith('/') && !to.startsWith('//') ? to : '/'
}

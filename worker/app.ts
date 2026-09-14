import { normalizeEmail, type MemberRole, type ObjectStore, type Store, type User } from './store'
import { buildAuthUrl, exchangeCode, verifyIdToken, type GoogleConfig } from './google'
import { error, json, parseCookies, randomToken, serializeCookie, sha256Base64url, sha256Hex } from './util'

export const SESSION_COOKIE = 'sl_session'
const OAUTH_COOKIE = 'sl_oauth'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const MAX_PROJECT_BYTES = 2 * 1024 * 1024
const MAX_MODEL_BYTES = 15 * 1024 * 1024
const MAX_ICON_BYTES = 512 * 1024
/** per-account and per-project caps, so one account cannot fill the database */
export const LIMITS = { projectsPerUser: 200, membersPerProject: 50, modelsPerUser: 100 }

export interface AppConfig {
  store: Store
  /** file storage for imported models; undefined when no bucket is bound */
  objects?: ObjectStore
  /** live collaboration: hand an authenticated WebSocket upgrade to the project's room; viewers only receive */
  live?: (req: Request, ctx: { projectId: string; user: User; role: 'owner' | 'editor' | 'viewer' }) => Promise<Response>
  /** tell an open room that the stored project changed through the REST API */
  onProjectSaved?: (projectId: string, project: Record<string, unknown>, version: number) => Promise<void>
  /**
   * rate limiting: true when the request may proceed. `strict` covers sign-in, view links, invitations
   * and live connections; `api` everything else. The key is the client IP, or the user id when signed in.
   */
  limiter?: (kind: 'api' | 'strict', key: string) => Promise<boolean>
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

    if (cfg.limiter) {
      const strict = path.startsWith('/auth/') || path.startsWith('/api/view/') || path.endsWith('/live') || (req.method === 'POST' && /\/members$/.test(path))
      const key = parseCookies(req.headers.get('Cookie'))[SESSION_COOKIE]?.slice(0, 16) ?? req.headers.get('CF-Connecting-IP') ?? 'anonymous'
      if (!(await cfg.limiter(strict ? 'strict' : 'api', key))) return json({ error: 'too many requests, slow down' }, { status: 429, headers: { 'Retry-After': '10' } })
    }

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
      // ---- view links need no account ----
      const view = /^\/api\/view\/([A-Za-z0-9_-]{8,64})(\/live)?$/.exec(path)
      if (view && req.method === 'GET') {
        const row = await cfg.store.getProjectByViewToken(view[1])
        if (!row) return error(404, 'this link is not valid any more')
        if (view[2]) {
          if (!cfg.live) return error(503, 'live collaboration is not configured')
          const guest: User = me?.user ?? { id: 'guest', googleSub: '', email: '', name: 'Guest', picture: '', createdAt: 0 }
          return cfg.live(req, { projectId: row.id, user: guest, role: 'viewer' })
        }
        return json({ project: JSON.parse(row.data), version: row.version, updatedAt: row.updatedAt, owner: row.owner })
      }
      if (!me) return error(401, 'sign in required')
      const userId = me.user.id
      const access = { userId, email: me.user.email }
      const roleOf = (meta: { ownerId: string; memberRole: MemberRole | null }) => (meta.ownerId === userId ? ('owner' as const) : meta.memberRole === 'viewer' ? ('viewer' as const) : ('editor' as const))
      const withRole = <T extends { ownerId: string; memberRole: MemberRole | null; viewToken: string | null }>(meta: T) => ({ ...meta, role: roleOf(meta), viewToken: meta.ownerId === userId ? meta.viewToken : null })
      if (path === '/api/projects' && req.method === 'GET') return json({ projects: (await cfg.store.listProjects(access)).map(withRole) })
      const live = /^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/live$/.exec(path)
      if (live && req.method === 'GET') {
        if (!cfg.live) return error(503, 'live collaboration is not configured')
        const meta = await cfg.store.getProjectMeta(access, live[1])
        if (!meta) return error(404, 'not found')
        return cfg.live(req, { projectId: live[1], user: me.user, role: roleOf(meta) })
      }
      // ---- "anyone with the link can view" ----
      const link = /^\/api\/projects\/([A-Za-z0-9_-]{1,64})\/link$/.exec(path)
      if (link) {
        const meta = await cfg.store.getProjectMeta(access, link[1])
        if (!meta) return error(404, 'not found')
        if (meta.ownerId !== userId) return error(403, 'only the owner can manage the view link')
        if (req.method === 'GET') return json({ token: meta.viewToken })
        if (req.method === 'POST') {
          const token = meta.viewToken ?? randomToken(18)
          await cfg.store.setViewToken(link[1], token)
          return json({ token })
        }
        if (req.method === 'DELETE') {
          await cfg.store.setViewToken(link[1], null)
          return json({ token: null })
        }
      }
      const m = /^\/api\/projects\/([A-Za-z0-9_-]{1,64})(?:\/members(?:\/([^/]{1,254}))?)?$/.exec(path)
      if (m) {
        const id = m[1]
        const membersPath = path.includes('/members')
        const memberEmail = m[2] ? normalizeEmail(decodeURIComponent(m[2])) : null
        // ---- sharing ----
        if (membersPath) {
          const meta = await cfg.store.getProjectMeta(access, id)
          if (!meta) return error(404, 'not found')
          const isOwner = meta.ownerId === userId
          if (req.method === 'GET' && !memberEmail) {
            return json({ owner: meta.owner, role: roleOf(meta), members: await cfg.store.listMembers(id) })
          }
          if (req.method === 'POST' && !memberEmail) {
            if (!isOwner) return error(403, 'only the owner can share a project')
            let body: { email?: unknown; role?: unknown }
            try {
              body = JSON.parse(await req.text())
            } catch {
              return error(400, 'invalid json')
            }
            const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(400, 'invalid email')
            if (email === normalizeEmail(me.user.email)) return error(400, 'that is your own address')
            const role: MemberRole = body.role === 'viewer' ? 'viewer' : 'editor'
            const current = await cfg.store.listMembers(id)
            if (current.length >= LIMITS.membersPerProject && !current.some((m) => m.email === email)) return error(429, `a project can be shared with at most ${LIMITS.membersPerProject} people`)
            await cfg.store.addMember(id, email, userId, role)
            return json({ ok: true, members: await cfg.store.listMembers(id) })
          }
          if (req.method === 'DELETE' && memberEmail) {
            // the owner can remove anyone; a member can remove themselves (leave)
            if (!isOwner && memberEmail !== normalizeEmail(me.user.email)) return error(403, 'only the owner can remove members')
            await cfg.store.removeMember(id, memberEmail)
            return json({ ok: true })
          }
          return error(404, 'not found')
        }
        if (req.method === 'GET') {
          const row = await cfg.store.getProject(access, id)
          if (!row) return error(404, 'not found')
          const meta = await cfg.store.getProjectMeta(access, id)
          return json({ project: JSON.parse(row.data), updatedAt: row.updatedAt, version: row.version, updatedBy: meta?.updatedBy ?? null, role: row.userId === userId ? 'owner' : 'editor' })
        }
        if (req.method === 'PUT') {
          const text = await req.text()
          if (text.length > MAX_PROJECT_BYTES) return error(413, 'project too large')
          let body: { project?: Record<string, unknown>; baseVersion?: unknown; force?: unknown }
          try {
            body = JSON.parse(text)
          } catch {
            return error(400, 'invalid json')
          }
          const project = body.project
          if (!project || typeof project !== 'object' || !Array.isArray(project.floors)) return error(400, 'invalid project')
          const meta = await cfg.store.getProjectMeta(access, id)
          if (meta && roleOf(meta) === 'viewer') return error(403, 'this project is shared with you read-only')
          const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : 0
          const force = body.force === true
          const updatedAt = now()
          const name = typeof project.name === 'string' && project.name.trim() ? project.name : 'Untitled project'
          for (let attempt = 0; attempt < 2; attempt++) {
            const existing = await cfg.store.getProject(access, id)
            if (!existing) {
              const owned = (await cfg.store.listProjects(access)).filter((p) => p.ownerId === userId).length
              if (owned >= LIMITS.projectsPerUser) return error(429, `you have reached the limit of ${LIMITS.projectsPerUser} projects`)
              // a project with this id that the caller cannot see: never overwrite someone else's
              const version = 1
              const ok = await cfg.store.putProject({ id, userId, name, data: JSON.stringify({ ...project, id, updatedAt }), updatedAt, createdAt: updatedAt, version, updatedBy: userId }, null)
              if (ok) return json({ ok: true, updatedAt, version })
              if ((await cfg.store.getProject(access, id)) === null) return error(403, 'this project id belongs to someone else')
              continue
            }
            if (!force && existing.version !== baseVersion) {
              // the copy the client started from is stale: hand back the current version so it can decide
              const meta = await cfg.store.getProjectMeta(access, id)
              return json({ conflict: true, project: JSON.parse(existing.data), version: existing.version, updatedAt: existing.updatedAt, updatedBy: meta?.updatedBy ?? null }, { status: 409 })
            }
            const version = existing.version + 1
            const data = { ...project, id, updatedAt }
            const ok = await cfg.store.putProject({ ...existing, name, data: JSON.stringify(data), updatedAt, version, updatedBy: userId }, existing.version)
            if (ok) {
              if (cfg.onProjectSaved) await cfg.onProjectSaved(id, data, version).catch(() => undefined)
              return json({ ok: true, updatedAt, version })
            }
            // someone saved between our read and write: loop once more (a forced save retries, a normal one will report the conflict)
          }
          return error(409, 'save raced with another save, try again')
        }
        if (req.method === 'DELETE') {
          const meta = await cfg.store.getProjectMeta(access, id)
          if (!meta) return json({ ok: true })
          if (meta.ownerId === userId) await cfg.store.deleteProject(userId, id)
          else await cfg.store.removeMember(id, normalizeEmail(me.user.email)) // a member deleting = leaving
          return json({ ok: true })
        }
      }
      // ---- imported 3D models ----
      if (path === '/api/models' && req.method === 'GET') {
        const rows = await cfg.store.listModels(userId)
        // `storage` tells the client whether model files can be uploaded at all (no R2 bucket bound → keep models local)
        return json({ storage: Boolean(cfg.objects), models: rows.map((r) => ({ key: r.key, name: r.name, width: r.width, depth: r.depth, height: r.height, fit: JSON.parse(r.fit), createdAt: r.createdAt })) })
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
            if (!existing && (await cfg.store.listModels(userId)).length >= LIMITS.modelsPerUser) return error(429, `you have reached the limit of ${LIMITS.modelsPerUser} imported models`)
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

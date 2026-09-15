export interface User {
  id: string
  googleSub: string
  email: string
  name: string
  picture: string
  createdAt: number
}

export interface ProjectRow {
  id: string
  /** owner */
  userId: string
  name: string
  /** JSON text of the project */
  data: string
  updatedAt: number
  createdAt: number
  /** bumped on every save; clients send the version they started from so diverging edits are caught */
  version: number
  /** id of the user who saved the current version */
  updatedBy: string
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
  version: number
  ownerId: string
  owner: { email: string; name: string }
  updatedBy: { email: string; name: string } | null
  /** number of people the project is shared with */
  memberCount: number
  /** the caller's membership role when not the owner */
  memberRole: MemberRole | null
  /** set when "anyone with the link can view" is on */
  viewToken: string | null
}

export type MemberRole = 'editor' | 'viewer'

export interface ProjectMember {
  email: string
  /** display name when the invitee has signed in before */
  name: string | null
  role: MemberRole
  createdAt: number
}

/** who is asking: projects are visible to their owner and to invited emails */
export interface Access {
  userId: string
  email: string
}

export interface ModelRow {
  key: string
  userId: string
  name: string
  width: number
  depth: number
  height: number
  /** JSON text describing how the raw file is normalised */
  fit: string
  createdAt: number
}

/** binary storage for model files (R2 in production, memory in tests) */
export interface ObjectStore {
  put(key: string, body: ReadableStream | ArrayBuffer | Blob, contentType: string): Promise<void>
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string } | null>
  delete(key: string): Promise<void>
  /** remove every object under a prefix (a project's files when it is deleted) */
  deletePrefix(prefix: string): Promise<void>
}

export interface Store {
  listModels(userId: string): Promise<ModelRow[]>
  getModel(userId: string, key: string): Promise<ModelRow | null>
  putModel(row: ModelRow): Promise<void>
  deleteModel(userId: string, key: string): Promise<void>
  upsertUser(input: { googleSub: string; email: string; name: string; picture: string }): Promise<User>
  getUser(id: string): Promise<User | null>
  createSession(input: { tokenHash: string; userId: string; expiresAt: number }): Promise<void>
  getSession(tokenHash: string): Promise<{ userId: string; expiresAt: number } | null>
  deleteSession(tokenHash: string): Promise<void>
  /** projects owned by or shared with the caller */
  listProjects(access: Access): Promise<ProjectMeta[]>
  getProject(access: Access, id: string): Promise<ProjectRow | null>
  getProjectMeta(access: Access, id: string): Promise<ProjectMeta | null>
  /** insert, or update when the stored version equals `expectedVersion`; false when someone saved in between */
  putProject(row: ProjectRow, expectedVersion: number | null): Promise<boolean>
  deleteProject(ownerId: string, id: string): Promise<void>
  listMembers(projectId: string): Promise<ProjectMember[]>
  /** insert or update the role */
  addMember(projectId: string, email: string, invitedBy: string, role: MemberRole): Promise<void>
  removeMember(projectId: string, email: string): Promise<void>
  setViewToken(projectId: string, token: string | null): Promise<void>
  /** project behind a view link, with its owner */
  getProjectByViewToken(token: string): Promise<(ProjectRow & { owner: { email: string; name: string } }) | null>
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase()

function newId(prefix: string): string {
  const buf = new Uint8Array(12)
  crypto.getRandomValues(buf)
  return prefix + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cloudflare D1 implementation; schema in worker/migrations */
export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async upsertUser(input: { googleSub: string; email: string; name: string; picture: string }): Promise<User> {
    const existing = await this.db.prepare('SELECT * FROM users WHERE google_sub = ?').bind(input.googleSub).first<Record<string, unknown>>()
    if (existing) {
      await this.db.prepare('UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?').bind(input.email, input.name, input.picture, existing.id).run()
      return { id: existing.id as string, googleSub: input.googleSub, email: input.email, name: input.name, picture: input.picture, createdAt: existing.created_at as number }
    }
    const user: User = { id: newId('u_'), googleSub: input.googleSub, email: input.email, name: input.name, picture: input.picture, createdAt: Date.now() }
    await this.db.prepare('INSERT INTO users (id, google_sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(user.id, user.googleSub, user.email, user.name, user.picture, user.createdAt).run()
    return user
  }

  async getUser(id: string): Promise<User | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>()
    if (!row) return null
    return { id: row.id as string, googleSub: row.google_sub as string, email: row.email as string, name: row.name as string, picture: row.picture as string, createdAt: row.created_at as number }
  }

  async createSession(input: { tokenHash: string; userId: string; expiresAt: number }): Promise<void> {
    await this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(input.tokenHash, input.userId, input.expiresAt, Date.now()).run()
  }

  async getSession(tokenHash: string): Promise<{ userId: string; expiresAt: number } | null> {
    const row = await this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first<Record<string, unknown>>()
    return row ? { userId: row.user_id as string, expiresAt: row.expires_at as number } : null
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
  }

  private static PROJECT_META = `SELECT p.id, p.name, p.updated_at, p.version, p.user_id, p.view_token, o.email AS owner_email, o.name AS owner_name, ub.email AS updated_by_email, ub.name AS updated_by_name,
      (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
      (SELECT role FROM project_members m WHERE m.project_id = p.id AND m.email = ?2) AS member_role
      FROM projects p JOIN users o ON o.id = p.user_id LEFT JOIN users ub ON ub.id = p.updated_by`
  private static ACCESS = `(p.user_id = ?1 OR p.id IN (SELECT project_id FROM project_members WHERE email = ?2))`

  private projectMeta(r: Record<string, unknown>): ProjectMeta {
    return {
      id: r.id as string,
      name: r.name as string,
      updatedAt: r.updated_at as number,
      version: (r.version as number) ?? 1,
      ownerId: r.user_id as string,
      owner: { email: r.owner_email as string, name: (r.owner_name as string) ?? '' },
      updatedBy: r.updated_by_email ? { email: r.updated_by_email as string, name: (r.updated_by_name as string) ?? '' } : null,
      memberCount: (r.member_count as number) ?? 0,
      memberRole: (r.member_role as MemberRole | null) ?? null,
      viewToken: (r.view_token as string | null) ?? null,
    }
  }

  async listProjects(access: Access): Promise<ProjectMeta[]> {
    const { results } = await this.db
      .prepare(`${D1Store.PROJECT_META} WHERE ${D1Store.ACCESS} ORDER BY p.updated_at DESC`)
      .bind(access.userId, normalizeEmail(access.email))
      .all<Record<string, unknown>>()
    return results.map((r) => this.projectMeta(r))
  }

  async getProjectMeta(access: Access, id: string): Promise<ProjectMeta | null> {
    const r = await this.db.prepare(`${D1Store.PROJECT_META} WHERE ${D1Store.ACCESS} AND p.id = ?3`).bind(access.userId, normalizeEmail(access.email), id).first<Record<string, unknown>>()
    return r ? this.projectMeta(r) : null
  }

  async getProject(access: Access, id: string): Promise<ProjectRow | null> {
    const r = await this.db.prepare(`SELECT p.* FROM projects p WHERE ${D1Store.ACCESS} AND p.id = ?3`).bind(access.userId, normalizeEmail(access.email), id).first<Record<string, unknown>>()
    if (!r) return null
    return { id: r.id as string, userId: r.user_id as string, name: r.name as string, data: r.data as string, updatedAt: r.updated_at as number, createdAt: r.created_at as number, version: (r.version as number) ?? 1, updatedBy: (r.updated_by as string) ?? '' }
  }

  async putProject(row: ProjectRow, expectedVersion: number | null): Promise<boolean> {
    if (expectedVersion === null) {
      const res = await this.db
        .prepare('INSERT INTO projects (id, user_id, name, data, updated_at, created_at, version, updated_by) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = ?)')
        .bind(row.id, row.userId, row.name, row.data, row.updatedAt, row.createdAt, row.version, row.updatedBy, row.id)
        .run()
      return res.meta.changes > 0
    }
    const res = await this.db
      .prepare('UPDATE projects SET name = ?, data = ?, updated_at = ?, version = ?, updated_by = ? WHERE id = ? AND version = ?')
      .bind(row.name, row.data, row.updatedAt, row.version, row.updatedBy, row.id, expectedVersion)
      .run()
    return res.meta.changes > 0
  }

  async deleteProject(ownerId: string, id: string): Promise<void> {
    await this.db.batch([this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)').bind(id, ownerId), this.db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(ownerId, id)])
  }

  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const { results } = await this.db
      .prepare('SELECT m.email, m.role, m.created_at, (SELECT name FROM users u WHERE lower(u.email) = m.email LIMIT 1) AS name FROM project_members m WHERE m.project_id = ? ORDER BY m.created_at')
      .bind(projectId)
      .all<Record<string, unknown>>()
    return results.map((r) => ({ email: r.email as string, name: (r.name as string | null) ?? null, role: ((r.role as string) === 'viewer' ? 'viewer' : 'editor') as MemberRole, createdAt: r.created_at as number }))
  }
  async addMember(projectId: string, email: string, invitedBy: string, role: MemberRole): Promise<void> {
    await this.db
      .prepare('INSERT INTO project_members (project_id, email, invited_by, created_at, role) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role')
      .bind(projectId, normalizeEmail(email), invitedBy, Date.now(), role)
      .run()
  }
  async removeMember(projectId: string, email: string): Promise<void> {
    await this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND email = ?').bind(projectId, normalizeEmail(email)).run()
  }
  async setViewToken(projectId: string, token: string | null): Promise<void> {
    await this.db.prepare('UPDATE projects SET view_token = ? WHERE id = ?').bind(token, projectId).run()
  }
  async getProjectByViewToken(token: string) {
    const r = await this.db.prepare('SELECT p.*, o.email AS owner_email, o.name AS owner_name FROM projects p JOIN users o ON o.id = p.user_id WHERE p.view_token = ?').bind(token).first<Record<string, unknown>>()
    if (!r) return null
    return { id: r.id as string, userId: r.user_id as string, name: r.name as string, data: r.data as string, updatedAt: r.updated_at as number, createdAt: r.created_at as number, version: (r.version as number) ?? 1, updatedBy: (r.updated_by as string) ?? '', owner: { email: r.owner_email as string, name: (r.owner_name as string) ?? '' } }
  }

  private modelRow(r: Record<string, unknown>): ModelRow {
    return { key: r.key as string, userId: r.user_id as string, name: r.name as string, width: r.width as number, depth: r.depth as number, height: r.height as number, fit: r.fit as string, createdAt: r.created_at as number }
  }
  async listModels(userId: string): Promise<ModelRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM models WHERE user_id = ? ORDER BY created_at').bind(userId).all<Record<string, unknown>>()
    return results.map((r) => this.modelRow(r))
  }
  async getModel(userId: string, key: string): Promise<ModelRow | null> {
    const r = await this.db.prepare('SELECT * FROM models WHERE user_id = ? AND key = ?').bind(userId, key).first<Record<string, unknown>>()
    return r ? this.modelRow(r) : null
  }
  async putModel(row: ModelRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO models (key, user_id, name, width, depth, height, fit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, width = excluded.width, depth = excluded.depth, height = excluded.height, fit = excluded.fit WHERE models.user_id = excluded.user_id`,
      )
      .bind(row.key, row.userId, row.name, row.width, row.depth, row.height, row.fit, row.createdAt)
      .run()
  }
  async deleteModel(userId: string, key: string): Promise<void> {
    await this.db.prepare('DELETE FROM models WHERE user_id = ? AND key = ?').bind(userId, key).run()
  }
}

export class R2Objects implements ObjectStore {
  constructor(private bucket: R2Bucket) {}
  async put(key: string, body: ReadableStream | ArrayBuffer | Blob, contentType: string) {
    await this.bucket.put(key, body, { httpMetadata: { contentType } })
  }
  async get(key: string) {
    const obj = await this.bucket.get(key)
    return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream' } : null
  }
  async delete(key: string) {
    await this.bucket.delete(key)
  }
  async deletePrefix(prefix: string) {
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix, cursor })
      if (page.objects.length) await this.bucket.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
}

export class MemoryObjects implements ObjectStore {
  objects = new Map<string, { body: ArrayBuffer; contentType: string }>()
  async put(key: string, body: ReadableStream | ArrayBuffer | Blob, contentType: string) {
    const buf = body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer()
    this.objects.set(key, { body: buf, contentType })
  }
  async get(key: string) {
    return this.objects.get(key) ?? null
  }
  async delete(key: string) {
    this.objects.delete(key)
  }
  async deletePrefix(prefix: string) {
    for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k)
  }
}

/** In-memory implementation for tests */
export class MemoryStore implements Store {
  users = new Map<string, User>()
  sessions = new Map<string, { userId: string; expiresAt: number }>()
  projects = new Map<string, ProjectRow>()
  models = new Map<string, ModelRow>()

  async listModels(userId: string) {
    return [...this.models.values()].filter((m) => m.userId === userId)
  }
  async getModel(userId: string, key: string) {
    const m = this.models.get(key)
    return m && m.userId === userId ? m : null
  }
  async putModel(row: ModelRow) {
    const existing = this.models.get(row.key)
    if (existing && existing.userId !== row.userId) return
    this.models.set(row.key, row)
  }
  async deleteModel(userId: string, key: string) {
    const m = this.models.get(key)
    if (m && m.userId === userId) this.models.delete(key)
  }

  async upsertUser(input: { googleSub: string; email: string; name: string; picture: string }): Promise<User> {
    for (const u of this.users.values()) {
      if (u.googleSub === input.googleSub) {
        const updated = { ...u, email: input.email, name: input.name, picture: input.picture }
        this.users.set(u.id, updated)
        return updated
      }
    }
    const user: User = { id: newId('u_'), ...input, createdAt: Date.now() }
    this.users.set(user.id, user)
    return user
  }
  async getUser(id: string) {
    return this.users.get(id) ?? null
  }
  async createSession(input: { tokenHash: string; userId: string; expiresAt: number }) {
    this.sessions.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt })
  }
  async getSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash)
  }
  members = new Map<string, { email: string; invitedBy: string; createdAt: number; role: MemberRole }[]>()
  viewTokens = new Map<string, string>()

  private canAccess(p: ProjectRow, access: Access) {
    return p.userId === access.userId || (this.members.get(p.id) ?? []).some((m) => m.email === normalizeEmail(access.email))
  }
  private meta(p: ProjectRow): ProjectMeta {
    const owner = this.users.get(p.userId)
    const ub = this.users.get(p.updatedBy)
    return { id: p.id, name: p.name, updatedAt: p.updatedAt, version: p.version, ownerId: p.userId, owner: { email: owner?.email ?? '', name: owner?.name ?? '' }, updatedBy: ub ? { email: ub.email, name: ub.name } : null, memberCount: (this.members.get(p.id) ?? []).length, memberRole: null, viewToken: this.viewTokens.get(p.id) ?? null }
  }
  private metaFor(p: ProjectRow, access: Access): ProjectMeta {
    const m = (this.members.get(p.id) ?? []).find((x) => x.email === normalizeEmail(access.email))
    return { ...this.meta(p), memberRole: m?.role ?? null }
  }
  async listProjects(access: Access) {
    return [...this.projects.values()]
      .filter((p) => this.canAccess(p, access))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => this.metaFor(p, access))
  }
  async getProjectMeta(access: Access, id: string) {
    const p = this.projects.get(id)
    return p && this.canAccess(p, access) ? this.metaFor(p, access) : null
  }
  async getProject(access: Access, id: string) {
    const p = this.projects.get(id)
    return p && this.canAccess(p, access) ? p : null
  }
  async putProject(row: ProjectRow, expectedVersion: number | null) {
    const existing = this.projects.get(row.id)
    if (expectedVersion === null) {
      if (existing) return false
      this.projects.set(row.id, row)
      return true
    }
    if (!existing || existing.version !== expectedVersion) return false
    this.projects.set(row.id, { ...row, userId: existing.userId, createdAt: existing.createdAt })
    return true
  }
  async deleteProject(ownerId: string, id: string) {
    const p = this.projects.get(id)
    if (p && p.userId === ownerId) {
      this.projects.delete(id)
      this.members.delete(id)
    }
  }
  async listMembers(projectId: string) {
    return (this.members.get(projectId) ?? []).map((m) => ({ email: m.email, name: [...this.users.values()].find((u) => normalizeEmail(u.email) === m.email)?.name ?? null, role: m.role, createdAt: m.createdAt }))
  }
  async addMember(projectId: string, email: string, invitedBy: string, role: MemberRole) {
    const list = this.members.get(projectId) ?? []
    const existing = list.find((m) => m.email === normalizeEmail(email))
    if (existing) existing.role = role
    else list.push({ email: normalizeEmail(email), invitedBy, createdAt: Date.now(), role })
    this.members.set(projectId, list)
  }
  async setViewToken(projectId: string, token: string | null) {
    if (token) this.viewTokens.set(projectId, token)
    else this.viewTokens.delete(projectId)
  }
  async getProjectByViewToken(token: string) {
    for (const [id, t] of this.viewTokens) {
      if (t !== token) continue
      const p = this.projects.get(id)
      if (!p) return null
      const owner = this.users.get(p.userId)
      return { ...p, owner: { email: owner?.email ?? '', name: owner?.name ?? '' } }
    }
    return null
  }
  async removeMember(projectId: string, email: string) {
    this.members.set(projectId, (this.members.get(projectId) ?? []).filter((m) => m.email !== normalizeEmail(email)))
  }
}

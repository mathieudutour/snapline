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
  userId: string
  name: string
  /** JSON text of the project */
  data: string
  updatedAt: number
  createdAt: number
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
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
  listProjects(userId: string): Promise<ProjectMeta[]>
  getProject(userId: string, id: string): Promise<ProjectRow | null>
  putProject(row: ProjectRow): Promise<void>
  deleteProject(userId: string, id: string): Promise<void>
}

function newId(prefix: string): string {
  const buf = new Uint8Array(12)
  crypto.getRandomValues(buf)
  return prefix + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cloudflare D1 implementation; schema in worker/schema.sql */
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

  async listProjects(userId: string): Promise<ProjectMeta[]> {
    const { results } = await this.db.prepare('SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all<Record<string, unknown>>()
    return results.map((r) => ({ id: r.id as string, name: r.name as string, updatedAt: r.updated_at as number }))
  }

  async getProject(userId: string, id: string): Promise<ProjectRow | null> {
    const r = await this.db.prepare('SELECT * FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).first<Record<string, unknown>>()
    if (!r) return null
    return { id: r.id as string, userId: r.user_id as string, name: r.name as string, data: r.data as string, updatedAt: r.updated_at as number, createdAt: r.created_at as number }
  }

  async putProject(row: ProjectRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO projects (id, user_id, name, data, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at WHERE projects.user_id = excluded.user_id`,
      )
      .bind(row.id, row.userId, row.name, row.data, row.updatedAt, row.createdAt)
      .run()
  }

  async deleteProject(userId: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).run()
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
  async listProjects(userId: string) {
    return [...this.projects.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
  }
  async getProject(userId: string, id: string) {
    const p = this.projects.get(id)
    return p && p.userId === userId ? p : null
  }
  async putProject(row: ProjectRow) {
    const existing = this.projects.get(row.id)
    if (existing && existing.userId !== row.userId) return
    this.projects.set(row.id, row)
  }
  async deleteProject(userId: string, id: string) {
    const p = this.projects.get(id)
    if (p && p.userId === userId) this.projects.delete(id)
  }
}

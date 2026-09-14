import type { Project } from '../model/project'

export interface AccountUser {
  id: string
  email: string
  name: string
  picture: string
}

export interface RemoteProjectMeta {
  id: string
  name: string
  updatedAt: number
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`)
  return (await res.json()) as T
}

/** null when signed out; throws when the API is unreachable (e.g. plain `vite dev` without the worker) */
export async function fetchMe(): Promise<AccountUser | null> {
  const r = await call<{ user: AccountUser | null }>('/api/me')
  return r.user
}

export function signInUrl(returnTo = '/'): string {
  return `/auth/google?return=${encodeURIComponent(returnTo)}`
}

export async function signOut(): Promise<void> {
  await call('/auth/logout', { method: 'POST' })
}

export async function listRemoteProjects(): Promise<RemoteProjectMeta[]> {
  return (await call<{ projects: RemoteProjectMeta[] }>('/api/projects')).projects
}

export async function getRemoteProject(id: string): Promise<{ project: Project; updatedAt: number }> {
  return call(`/api/projects/${id}`)
}

export async function putRemoteProject(project: Project): Promise<number> {
  const r = await call<{ updatedAt: number }>(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ project }) })
  return r.updatedAt
}

export async function deleteRemoteProject(id: string): Promise<void> {
  await call(`/api/projects/${id}`, { method: 'DELETE' })
}

// ---- custom 3D models (metadata in D1, files in R2) ----
export interface RemoteModelMeta {
  key: string
  name: string
  width: number
  depth: number
  height: number
  fit: { unitScale: number; center: [number, number, number] }
  createdAt: number
}

export async function listRemoteModels(): Promise<RemoteModelMeta[]> {
  return (await call<{ models: RemoteModelMeta[] }>('/api/models')).models
}

export async function putRemoteModelMeta(meta: RemoteModelMeta): Promise<void> {
  await call(`/api/models/${meta.key}`, { method: 'PUT', body: JSON.stringify(meta) })
}

export async function putRemoteModelFile(key: string, part: 'glb' | 'plan' | 'thumb', body: Blob | ArrayBuffer): Promise<void> {
  const res = await fetch(`/api/models/${key}/${part}`, { method: 'PUT', body, headers: { 'Content-Type': part === 'glb' ? 'model/gltf-binary' : 'image/png' }, credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, `upload ${part} → ${res.status}`)
}

export async function getRemoteModelFile(key: string, part: 'glb' | 'plan' | 'thumb'): Promise<Blob> {
  const res = await fetch(`/api/models/${key}/${part}`, { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, `download ${part} → ${res.status}`)
  return res.blob()
}

export async function deleteRemoteModel(key: string): Promise<void> {
  await call(`/api/models/${key}`, { method: 'DELETE' })
}

import type { Project } from '../model/project'

export interface AccountUser {
  id: string
  email: string
  name: string
  picture: string
}

export interface Person {
  email: string
  name: string
}

export type ProjectRole = 'owner' | 'editor' | 'viewer'
export type MemberRole = 'editor' | 'viewer'

export interface RemoteProjectMeta {
  id: string
  name: string
  updatedAt: number
  version: number
  role: ProjectRole
  owner: Person
  updatedBy: Person | null
  memberCount: number
  /** "anyone with the link can view" token; only sent to the owner */
  viewToken: string | null
}

export interface RemoteProject {
  project: Project
  updatedAt: number
  version: number
  updatedBy: Person | null
  role: ProjectRole
}

export interface ProjectMember {
  email: string
  name: string | null
  role: MemberRole
  createdAt: number
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** the account copy moved on since this device last synced: the server refused the save and sent back the current version */
export class ConflictError extends Error {
  constructor(public remote: { project: Project; version: number; updatedAt: number; updatedBy: Person | null }) {
    super('project changed elsewhere')
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

/** the account and everything it owns on the server; the session cookie is cleared by the response */
export async function deleteAccount(): Promise<void> {
  await call('/api/me', { method: 'DELETE' })
}

export async function listRemoteProjects(): Promise<RemoteProjectMeta[]> {
  return (await call<{ projects: RemoteProjectMeta[] }>('/api/projects')).projects
}

export async function getRemoteProject(id: string): Promise<RemoteProject> {
  return call(`/api/projects/${id}`)
}

/**
 * Save a project on top of `baseVersion` (the version this device last synced, 0 for a new project).
 * Throws ConflictError when someone saved a newer version in between, unless `force` is set.
 */
export async function putRemoteProject(project: Project, baseVersion: number, force = false): Promise<{ version: number; updatedAt: number }> {
  const res = await fetch(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ project, baseVersion, force }), headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' })
  if (res.status === 409) {
    const data = (await res.json()) as { conflict?: boolean; project: Project; version: number; updatedAt: number; updatedBy: Person | null }
    if (data.conflict) throw new ConflictError(data)
  }
  if (!res.ok) throw new ApiError(res.status, `PUT /api/projects/${project.id} → ${res.status}`)
  return (await res.json()) as { version: number; updatedAt: number }
}

/** owners delete the project; invited editors just leave it */
export async function deleteRemoteProject(id: string): Promise<void> {
  await call(`/api/projects/${id}`, { method: 'DELETE' })
}

// ---- sharing ----
export async function listMembers(id: string): Promise<{ owner: Person; role: ProjectRole; members: ProjectMember[] }> {
  return call(`/api/projects/${id}/members`)
}

/** invite, or change the role of an existing member */
export async function addMember(id: string, email: string, role: MemberRole): Promise<ProjectMember[]> {
  return (await call<{ members: ProjectMember[] }>(`/api/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })).members
}

// ---- "anyone with the link can view" ----
export async function setViewLink(id: string, on: boolean): Promise<string | null> {
  return (await call<{ token: string | null }>(`/api/projects/${id}/link`, { method: on ? 'POST' : 'DELETE' })).token
}

export function viewLinkUrl(token: string): string {
  return `${location.origin}/view/${token}`
}

/** project behind a view link; works signed out */
export async function getViewedProject(token: string): Promise<{ project: Project; version: number; updatedAt: number; owner: Person }> {
  return call(`/api/view/${token}`)
}

export async function removeMember(id: string, email: string): Promise<void> {
  await call(`/api/projects/${id}/members/${encodeURIComponent(email)}`, { method: 'DELETE' })
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

/** `storage` is false when the worker has no file bucket bound: models then stay in this browser only */
export async function listRemoteModels(): Promise<{ storage: boolean; models: RemoteModelMeta[] }> {
  const res = await call<{ storage?: boolean; models: RemoteModelMeta[] }>('/api/models')
  return { storage: res.storage !== false, models: res.models }
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

// ---- files attached to a project (plan underlays) ----
export async function putProjectFile(projectId: string, key: string, blob: Blob): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/files/${key}`, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type }, credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, `upload file → ${res.status}`)
}

/** download a project file; `viewToken` when looking through a view link */
export async function getProjectFile(projectId: string, key: string, viewToken?: string | null): Promise<Blob> {
  const res = await fetch(viewToken ? `/api/view/${viewToken}/files/${key}` : `/api/projects/${projectId}/files/${key}`, { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, `download file → ${res.status}`)
  return res.blob()
}

export async function deleteProjectFile(projectId: string, key: string): Promise<void> {
  await call(`/api/projects/${projectId}/files/${key}`, { method: 'DELETE' })
}

import { createApp } from './app'
import { D1Store, R2Objects } from './store'
import { ProjectRoom } from './room-do'
import type { Project } from '../src/model/project'

export { ProjectRoom }

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** optional R2 bucket for imported 3D models */
  MODELS?: R2Bucket
  /** live collaboration rooms, one Durable Object per project */
  ROOM: DurableObjectNamespace<ProjectRoom>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      const handle = createApp({
        store: new D1Store(env.DB),
        objects: env.MODELS ? new R2Objects(env.MODELS) : undefined,
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
        secureCookies: url.protocol === 'https:',
        live: (req, { projectId, user, role }) => {
          const headers = new Headers(req.headers)
          headers.set('X-Project-Id', projectId)
          headers.set('X-User-Id', user.id)
          headers.set('X-User-Email', user.email)
          headers.set('X-User-Name', encodeURIComponent(user.name))
          headers.set('X-Role', role)
          return env.ROOM.getByName(projectId).fetch(new Request(req.url, { method: 'GET', headers }))
        },
        onProjectSaved: (projectId, project, version) => env.ROOM.getByName(projectId).externalSave(project as unknown as Project, version),
      })
      return handle(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

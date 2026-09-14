import { createApp } from './app'
import { D1Store } from './store'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      const handle = createApp({
        store: new D1Store(env.DB),
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
        secureCookies: url.protocol === 'https:',
      })
      return handle(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

import raw from './catalog.json'

export interface CatalogItem {
  key: string
  name: string
  category: string
  width: number
  depth: number
  height: number
  elevation: number
  creator: string
  license: string
  library: string
}

export const CATALOG: CatalogItem[] = raw as CatalogItem[]
export const CUSTOM_CATEGORY = 'My models'
export const CATALOG_BY_KEY: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.key, c]))
export const CATEGORIES: string[] = [...new Set(CATALOG.map((c) => c.category))]

const base = import.meta.env.BASE_URL.replace(/\/$/, '')
export const modelUrl = (key: string) => `${base}/furniture/models/${key}.glb`
export const iconUrl = (key: string) => `${base}/furniture/icons/${key}.png`
export const planIconUrl = (key: string) => `${base}/furniture/plan/${key}.png`
export const creditsUrl = `${base}/furniture/CREDITS.md`

import { customModelUrls, isCustomKey } from './customModels'

/** URLs for bundled or imported models; imported ones resolve to object URLs once their files are loaded */
export const resolveModelUrl = (key: string) => (isCustomKey(key) ? customModelUrls(key)?.glb ?? null : modelUrl(key))
export const resolvePlanIconUrl = (key: string) => (isCustomKey(key) ? customModelUrls(key)?.plan ?? null : planIconUrl(key))
export const resolveIconUrl = (key: string) => (isCustomKey(key) ? customModelUrls(key)?.thumb ?? null : iconUrl(key))

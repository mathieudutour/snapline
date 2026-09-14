// Rewrites wrangler.jsonc without the R2 bucket binding so the worker can be deployed on
// accounts where R2 has not been enabled yet. The worker treats a missing MODELS binding as
// "no file storage" and the app keeps imported models in the browser.
import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../wrangler.jsonc', import.meta.url)
const source = readFileSync(path, 'utf8')
// the config is plain JSON (no comments); strip `//` line comments defensively before parsing
const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''))
if (!config.r2_buckets) {
  console.log('wrangler.jsonc has no r2_buckets binding; nothing to do')
  process.exit(0)
}
delete config.r2_buckets
writeFileSync(path, JSON.stringify(config, null, '\t') + '\n')
console.log('removed the r2_buckets binding from wrangler.jsonc')

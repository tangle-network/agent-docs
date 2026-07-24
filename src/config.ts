import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { CartographConfig, RepoSlug } from './types'

/**
 * Optional per-repo config. All fields optional — cartograph auto-detects
 * everything by default; the config is the escape hatch for repos whose entry
 * points can't be inferred from tsup / package.json `exports`.
 */
export async function loadConfig(repoRoot: string): Promise<CartographConfig> {
  for (const name of ['cartograph.config.mjs', 'cartograph.config.js']) {
    const p = join(repoRoot, name)
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href)
      return (mod.default ?? mod.config ?? {}) as CartographConfig
    }
  }
  const jsonPath = join(repoRoot, 'cartograph.config.json')
  if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, 'utf8')) as CartographConfig
  return {}
}

/** Pure parse of a git remote URL → `{ host, owner, repo, slug }` or null. */
export function parseRemoteUrl(url: string | null | undefined): RepoSlug | null {
  if (!url) return null
  const ssh = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/)
  const https = url.match(/https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/)
  const parsed = ssh ?? https
  if (!parsed) return null
  const [, host, owner, repo] = parsed
  return { host, owner, repo, slug: `${owner}/${repo}` }
}

/**
 * `{ host, owner, repo, slug }` from the git `origin` remote, or null. Uses
 * `git` (worktree-safe) and falls back to parsing `.git/config`. Only GitHub
 * remotes carry a DeepWiki-usable slug; the caller decides what to do with it.
 */
export function detectRepoSlug(repoRoot: string): RepoSlug | null {
  let url: string
  try {
    url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    const cfg = join(repoRoot, '.git', 'config')
    if (!existsSync(cfg)) return null
    const m = readFileSync(cfg, 'utf8').match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/)
    if (!m) return null
    url = m[1].trim()
  }
  return parseRemoteUrl(url)
}

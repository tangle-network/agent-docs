import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { detectRepoSlug, loadConfig, parseRemoteUrl } from './config'
import { fetchDeepwiki } from './deepwiki'
import { resolveEntries } from './entries'
import { extractRows } from './extract'
import { buildFiles, renderWiki } from './render'
import { loadTs } from './ts'
import type { AnalyzeOptions, AnalyzeResult, CartographConfig, CheckResult, Meta } from './types'

export { parseRemoteUrl, detectRepoSlug } from './config'
export { fetchDeepwiki } from './deepwiki'
export type * from './types'

const DEFAULT_ASK = [
  'What is the high-level architecture and what are the main components?',
  'How do the main components fit together in a typical request or data flow?',
]

function describeSource(root: string, config: CartographConfig): string {
  if (config.entries?.length) return 'entries from agent-docs.config'
  if (['tsup.config.ts', 'tsup.config.js', 'tsup.config.mjs'].some((n) => existsSync(join(root, n)))) return 'tsup.config `entry`'
  const pkg = join(root, 'package.json')
  if (existsSync(pkg)) {
    try {
      if (JSON.parse(readFileSync(pkg, 'utf8')).exports) return 'package.json `exports`'
    } catch {
      /* fall through */
    }
  }
  return 'src/index'
}

/** Extract the surface + graph (+ optional DeepWiki) and build the output files. */
export async function analyze(repoRoot: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const root = resolve(repoRoot)
  const config = await loadConfig(root)
  const ts = await loadTs(root)
  const entries = resolveEntries(root, config, ts)
  const rows = extractRows(ts, root, entries, config)
  const slug = detectRepoSlug(root)
  const meta: Meta = {
    out: opts.out ?? config.out ?? 'docs',
    title: config.title ?? slug?.repo ?? basename(root),
    sourceLabel: describeSource(root, config),
    slug: slug?.slug,
  }
  const wantWiki = opts.deepwiki ?? config.deepwiki ?? false
  let deepwikiTried = false
  if (wantWiki && slug && /(^|\.)github\.com$/i.test(slug.host)) {
    deepwikiTried = true
    const dw = await fetchDeepwiki(slug.slug, { ask: opts.ask ?? config.ask ?? DEFAULT_ASK })
    if (dw) meta.deepwiki = dw
  }
  return { root, rows, meta, slug, wantWiki, deepwikiTried, files: buildFiles(rows, meta), wiki: renderWiki(meta) }
}

/** Regenerate all files to disk. Cleans stale `api/*.md` first. */
export async function write(
  repoRoot: string,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult & { written: string[] }> {
  const r = await analyze(repoRoot, opts)
  const apiDir = join(r.root, r.meta.out, 'api')
  if (existsSync(apiDir)) rmSync(apiDir, { recursive: true, force: true })
  const written: string[] = []
  for (const [rel, content] of r.files) {
    const abs = join(r.root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
    written.push(rel)
  }
  if (r.wiki) {
    const abs = join(r.root, r.wiki.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, r.wiki.content)
    written.push(r.wiki.path)
  }
  return { ...r, written }
}

/**
 * Compare the freshly-extracted DETERMINISTIC files against what's committed.
 * Forces DeepWiki off — the gate only ever inspects the deterministic surface,
 * so a `WIKI.md` (non-deterministic) never trips it.
 */
export async function check(repoRoot: string, opts: AnalyzeOptions = {}): Promise<CheckResult> {
  const r = await analyze(repoRoot, { ...opts, deepwiki: false })
  const stale: string[] = []
  const missing: string[] = []
  for (const [rel, content] of r.files) {
    const abs = join(r.root, rel)
    if (!existsSync(abs)) missing.push(rel)
    else if (readFileSync(abs, 'utf8') !== content) stale.push(rel)
  }
  const apiDir = join(r.root, r.meta.out, 'api')
  const orphan = existsSync(apiDir)
    ? readdirSync(apiDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => `${r.meta.out}/api/${f}`)
        .filter((rel) => !r.files.has(rel))
    : []
  return { ok: stale.length + missing.length + orphan.length === 0, stale, missing, orphan, meta: r.meta }
}

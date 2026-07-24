import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { CartographConfig, Entry, TS } from './types'

/**
 * Resolve the repo's public entry points, in priority order:
 *   1. `config.entries`       — explicit override (always wins)
 *   2. `tsup.config.ts`       — the build's `entry` map (accurate: points at src)
 *   3. package.json `exports` — reverse-mapped from dist → src
 *   4. `src/index.ts`         — single-entry fallback
 */
export function resolveEntries(repoRoot: string, config: CartographConfig, ts: TS | undefined): Entry[] {
  const srcRoot = join(repoRoot, config.srcDir ?? 'src')
  const rels =
    (config.entries && config.entries.length ? config.entries : null) ??
    fromTsup(repoRoot, ts) ??
    fromPackageExports(repoRoot) ??
    fromDefault(repoRoot)
  if (!rels || rels.length === 0) {
    throw new Error(
      'agent-docs: no entry points detected. Add a agent-docs.config.json with { "entries": ["src/index.ts", ...] }.',
    )
  }
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const rel of rels) {
    const abs = join(repoRoot, rel)
    if (seen.has(abs)) continue
    seen.add(abs)
    if (!existsSync(abs)) continue
    entries.push(toEntry(repoRoot, abs, srcRoot, rel))
  }
  return entries.sort((a, b) => a.exportPath.localeCompare(b.exportPath))
}

function toEntry(repoRoot: string, abs: string, srcRoot: string, rel: string): Entry {
  const underSrc = abs === srcRoot || abs.startsWith(srcRoot + '/')
  const key = (underSrc ? relative(srcRoot, abs) : relative(repoRoot, abs)).replace(/\.[tj]sx?$/, '')
  const id = key === 'index' ? '.' : key.replace(/\/index$/, '')
  const exportPath = id === '.' ? '.' : `./${id}`
  const apiName = (id === '.' ? 'index' : id).replace(/\//g, '-')
  const topDir = key.split('/')[0]
  return { id, exportPath, file: abs, apiName, topDir, srcDir: dirname(abs), rel: rel.replace(/\\/g, '/') }
}

/** Parse the `entry` map out of tsup.config.{ts,js} (object or array form). */
function fromTsup(repoRoot: string, ts: TS | undefined): string[] | null {
  if (!ts) return null
  const configPath = ['tsup.config.ts', 'tsup.config.js', 'tsup.config.mjs']
    .map((n) => join(repoRoot, n))
    .find((p) => existsSync(p))
  if (!configPath) return null
  const sf = ts.createSourceFile(configPath, readFileSync(configPath, 'utf8'), ts.ScriptTarget.Latest, true)
  let init: import('typescript').Expression | undefined
  const visit = (node: import('typescript').Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'entry' &&
      !init
    ) {
      init = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!init) return null
  const files: string[] = []
  if (ts.isObjectLiteralExpression(init)) {
    for (const prop of init.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) files.push(prop.initializer.text)
    }
  } else if (ts.isArrayLiteralExpression(init)) {
    for (const el of init.elements) if (ts.isStringLiteral(el)) files.push(el.text)
  }
  return files.length ? files : null
}

/** Reverse-map each package.json `exports` subpath's dist target → a src file. */
function fromPackageExports(repoRoot: string): string[] | null {
  const pkgPath = join(repoRoot, 'package.json')
  if (!existsSync(pkgPath)) return null
  let pkg: { exports?: Record<string, unknown> }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    return null
  }
  const exp = pkg.exports
  if (!exp || typeof exp !== 'object') return null
  const files: string[] = []
  for (const [sub, val] of Object.entries(exp)) {
    if (sub.includes('*') || sub.endsWith('package.json') || /\.(css|json)$/.test(sub)) continue
    const target =
      typeof val === 'string'
        ? val
        : val && typeof val === 'object'
          ? ((val as Record<string, unknown>).types ??
            (val as Record<string, unknown>).import ??
            (val as Record<string, unknown>).default ??
            (val as Record<string, unknown>).require)
          : undefined
    if (typeof target !== 'string') continue
    const src = distToSrc(target)
    if (src && existsSync(join(repoRoot, src))) files.push(src)
  }
  return files.length ? files : null
}

/** `./dist/chat-routes/index.js` → `src/chat-routes/index.ts` (best-effort). */
function distToSrc(target: string): string {
  let s = target.replace(/^\.\//, '')
  s = s.replace(/^dist\//, 'src/')
  s = s.replace(/\.d\.ts$/, '.ts').replace(/\.d\.mts$/, '.ts').replace(/\.m?js$/, '.ts')
  return s
}

function fromDefault(repoRoot: string): string[] | null {
  for (const rel of ['src/index.ts', 'src/index.tsx', 'index.ts', 'src/index.mts']) {
    if (existsSync(join(repoRoot, rel))) return [rel]
  }
  return null
}

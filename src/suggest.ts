import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type * as TSNS from 'typescript'

import { loadConfig } from './config'
import { resolveEntries } from './entries'
import { loadTs } from './ts'
import type { TS } from './types'

/**
 * `agent-docs suggest` — draft a one-line JSDoc for every UNDOCUMENTED public
 * export via a cheap model on an OpenAI-compatible endpoint (the Tangle router
 * by default), and insert it into source above the declaration.
 *
 * This is the ONLY LLM-touching authoring path, and it is deliberately at
 * AUTHORING time, not generation time: the model improves the source comments;
 * once committed, the deterministic extractor picks them up so the gated
 * `llms.txt` / `CODEMAP.md` stay type-derived and never contain raw model text.
 * Nothing here runs during `generate` or `check`.
 */

export interface SuggestOptions {
  /** Only document this export subpath id (e.g. `chat-routes`); default: all. */
  subpath?: string
  model?: string
  baseUrl?: string
  apiKey?: string
  /** Cap the number of exports documented in one run. */
  limit?: number
  /** Draft + report, but do NOT write to source. */
  dryRun?: boolean
  concurrency?: number
  log?: (msg: string) => void
}

interface Candidate {
  name: string
  kind: string
  signature: string
  file: string
  /** Insert position (start of the exported statement, after indent). */
  pos: number
  indent: string
  snippet: string
}

export interface SuggestResult {
  documented: number
  skipped: number
  files: string[]
  drafts: Array<{ name: string; file: string; doc: string }>
  dryRun: boolean
}

function modelConfig(opts: SuggestOptions): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = (opts.baseUrl ?? process.env.ROUTER_URL ?? 'https://router.tangle.tools/v1').replace(/\/$/, '')
  const apiKey = opts.apiKey ?? process.env.TANGLE_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
  const model = opts.model ?? 'gpt-4.1-mini'
  if (!apiKey) throw new Error('suggest: no API key. Set TANGLE_API_KEY (or pass --api-key).')
  return { baseUrl, apiKey, model }
}

const PROMPT_RULES =
  'Write ONE line of JSDoc summary for this TypeScript export. Rules: imperative mood ("Resolve…", "Build…"), describe what it IS or DOES, <= 110 characters, do NOT restate the type signature, do NOT start with "This function/type", no trailing period, no markdown. Return ONLY the summary text, nothing else.'

async function draftDoc(item: Candidate, cfg: { baseUrl: string; apiKey: string; model: string }): Promise<string | null> {
  const content = `${PROMPT_RULES}\n\nName: ${item.name}\nKind: ${item.kind}\nSignature: ${item.signature}\n\nSource:\n${item.snippet}`
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
        max_tokens: 120,
      }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = j.choices?.[0]?.message?.content?.trim()
  if (!raw) return null
  // Collapse to one clean line; strip surrounding quotes and any comment markers.
  const line = raw.replace(/\s+/g, ' ').replace(/^["'`]|["'`]$/g, '').replace(/^\/\*+|\*+\/$/g, '').replace(/\.$/, '').trim()
  return line || null
}

/** Walk up to the top-level statement that carries the `export` for `decl`. */
function statementOf(ts: TS, decl: TSNS.Node): TSNS.Node {
  let n = decl
  while (n.parent && !ts.isSourceFile(n.parent)) n = n.parent
  return n
}

function collectCandidates(ts: TS, repoRoot: string, entries: ReturnType<typeof resolveEntries>, subpath?: string): Candidate[] {
  const srcRoot = resolve(repoRoot, 'src')
  const scoped = subpath ? entries.filter((e) => e.id === subpath) : entries
  const options: TSNS.CompilerOptions = { noEmit: true, skipLibCheck: true, allowJs: true }
  const program = ts.createProgram(
    scoped.map((e) => e.file),
    options,
  )
  const checker = program.getTypeChecker()
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const entry of scoped) {
    const sf = program.getSourceFile(entry.file)
    if (!sf) continue
    const moduleSym = checker.getSymbolAtLocation(sf)
    if (!moduleSym) continue
    for (const exp of checker.getExportsOfModule(moduleSym)) {
      const name = exp.getName()
      if (name.startsWith('__')) continue
      // Already documented anywhere?
      let sym = exp
      if (sym.flags & ts.SymbolFlags.Alias) {
        try {
          sym = checker.getAliasedSymbol(sym)
        } catch {
          /* keep */
        }
      }
      if (ts.displayPartsToString(exp.getDocumentationComment(checker)).trim()) continue
      if (ts.displayPartsToString(sym.getDocumentationComment(checker)).trim()) continue
      const decl = sym.declarations?.[0]
      if (!decl) continue
      const declSf = decl.getSourceFile()
      // Only document declarations that live in THIS repo's src (not re-exported deps).
      if (!declSf.fileName.startsWith(srcRoot + '/')) continue
      const stmt = statementOf(ts, decl)
      const start = stmt.getStart(declSf)
      const key = `${declSf.fileName}:${start}`
      if (seen.has(key)) continue
      seen.add(key)
      const { line } = declSf.getLineAndCharacterOfPosition(start)
      const lineStart = declSf.getPositionOfLineAndCharacter(line, 0)
      const indent = (declSf.text.slice(lineStart, start).match(/^\s*/) ?? [''])[0]
      const kind = kindOf(ts, sym)
      const type = decl && sym.valueDeclaration ? checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration)) : ''
      const snippet = stmt.getText(declSf).split('\n').slice(0, 14).join('\n').slice(0, 1200)
      out.push({ name, kind, signature: (type || kind).replace(/\s+/g, ' ').slice(0, 200), file: declSf.fileName, pos: start, indent, snippet })
    }
  }
  return out
}

function kindOf(ts: TS, sym: TSNS.Symbol): string {
  const f = sym.flags
  if (f & ts.SymbolFlags.Class) return 'class'
  if (f & ts.SymbolFlags.Interface) return 'interface'
  if (f & ts.SymbolFlags.TypeAlias) return 'type'
  if (f & ts.SymbolFlags.Enum) return 'enum'
  if (f & ts.SymbolFlags.Function) return 'function'
  return 'const'
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  const q = [...items]
  const workers = Array.from({ length: Math.min(n, q.length) }, async () => {
    for (;;) {
      const item = q.shift()
      if (item === undefined) return
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export async function suggest(repoRoot: string, opts: SuggestOptions = {}): Promise<SuggestResult> {
  const root = resolve(repoRoot)
  const cfg = modelConfig(opts)
  const log = opts.log ?? (() => {})
  const config = await loadConfig(root)
  const ts = await loadTs(root)
  const entries = resolveEntries(root, config, ts)
  let candidates = collectCandidates(ts, root, entries, opts.subpath)
  if (opts.limit) candidates = candidates.slice(0, opts.limit)
  log(`suggest: ${candidates.length} undocumented exports to draft (model ${cfg.model})`)

  const drafts: SuggestResult['drafts'] = []
  const byFile = new Map<string, Array<{ pos: number; indent: string; doc: string }>>()
  let done = 0
  await pool(candidates, opts.concurrency ?? 5, async (c) => {
    const doc = await draftDoc(c, cfg)
    done++
    if (done % 20 === 0) log(`  drafted ${done}/${candidates.length}`)
    if (!doc) return
    drafts.push({ name: c.name, file: c.file, doc })
    const arr = byFile.get(c.file) ?? []
    arr.push({ pos: c.pos, indent: c.indent, doc })
    byFile.set(c.file, arr)
  })

  const files: string[] = []
  if (!opts.dryRun) {
    for (const [file, inserts] of byFile) {
      let text = readFileSync(file, 'utf8')
      // Apply bottom-up so earlier positions stay valid.
      for (const { pos, indent, doc } of inserts.sort((a, b) => b.pos - a.pos)) {
        text = text.slice(0, pos) + `/** ${doc} */\n${indent}` + text.slice(pos)
      }
      writeFileSync(file, text)
      files.push(file)
    }
  }
  return { documented: drafts.length, skipped: candidates.length - drafts.length, files, drafts, dryRun: !!opts.dryRun }
}

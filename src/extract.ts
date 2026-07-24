import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import type * as TSNS from 'typescript'

import type { CartographConfig, Entry, ExportInfo, ExportKind, Row, TS } from './types'

/** One TS program over every entry file, reusing the repo's tsconfig options. */
export function createProgram(ts: TS, repoRoot: string, entries: Entry[], tsconfigName = 'tsconfig.json'): TSNS.Program {
  const tsconfigPath = join(repoRoot, tsconfigName)
  let options: TSNS.CompilerOptions = { allowJs: true }
  if (existsSync(tsconfigPath)) {
    const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(cfg.config ?? {}, ts.sys, repoRoot)
    options = parsed.options
  }
  options = { ...options, noEmit: true, skipLibCheck: true, allowJs: true }
  return ts.createProgram(
    entries.map((e) => e.file),
    options,
  )
}

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const m = flat.match(/^(.*?[.!?])(\s|$)/)
  return truncate(m ? m[1] : flat, 200)
}

/** Kind + one-line signature + first-sentence doc for one exported symbol. */
function describe(ts: TS, checker: TSNS.TypeChecker, exported: TSNS.Symbol): ExportInfo {
  let sym = exported
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(sym)
    } catch {
      sym = exported
    }
  }
  const name = exported.getName()
  const decl = sym.valueDeclaration ?? sym.declarations?.[0]
  const f = sym.flags
  let kind: ExportKind
  let signature: string
  if (f & ts.SymbolFlags.Class) {
    kind = 'class'
    signature = `class ${name}`
  } else if (f & ts.SymbolFlags.Interface) {
    kind = 'interface'
    signature = `interface ${name}`
  } else if (f & ts.SymbolFlags.TypeAlias) {
    kind = 'type'
    signature = `type ${name}`
  } else if (f & ts.SymbolFlags.Enum || f & ts.SymbolFlags.EnumMember) {
    kind = 'enum'
    signature = `enum ${name}`
  } else if (f & (ts.SymbolFlags.Module | ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)) {
    kind = 'namespace'
    signature = `namespace ${name}`
  } else if (decl) {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl)
    const callable = type.getCallSignatures().length > 0
    kind = f & ts.SymbolFlags.Function || callable ? 'function' : 'const'
    signature = truncate(checker.typeToString(type).replace(/\s+/g, ' '), 120)
  } else {
    kind = 'value'
    signature = name
  }
  let doc = ts.displayPartsToString(exported.getDocumentationComment(checker)).trim()
  if (!doc && sym !== exported) doc = ts.displayPartsToString(sym.getDocumentationComment(checker)).trim()
  return { name, kind, signature, doc: firstSentence(doc) }
}

/** Public exports of one entry module, sorted, skipping synthetic `__` names. */
function exportsOf(
  ts: TS,
  program: TSNS.Program,
  checker: TSNS.TypeChecker,
  entry: Entry,
): { exports?: ExportInfo[]; error?: string } {
  const sf = program.getSourceFile(entry.file)
  if (!sf) return { error: `no source file for ${entry.rel}` }
  const moduleSym = checker.getSymbolAtLocation(sf)
  if (!moduleSym) return { error: `no module symbol for ${entry.rel} (empty or non-module?)` }
  const exports = checker
    .getExportsOfModule(moduleSym)
    .filter((s) => !s.getName().startsWith('__'))
    .map((s) => describe(ts, checker, s))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { exports }
}

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name)
        if (e.isDirectory()) return walk(p)
        return /\.(ts|tsx|mts|cts)$/.test(e.name) ? [p] : []
      })
    : []

/** Sibling subpaths this entry imports, via relative specifiers resolving under
 *  `srcRoot` to a different top-level segment that is itself an entry's topDir. */
function siblingDeps(entry: Entry, srcRoot: string, topDirs: Set<string>): string[] {
  const deps = new Set<string>()
  for (const file of walk(entry.srcDir)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g)) {
      const abs = resolve(dirname(file), m[1])
      if (!abs.startsWith(srcRoot + '/')) continue
      const seg = relative(srcRoot, abs).split('/')[0]
      if (seg && seg !== entry.topDir && topDirs.has(seg)) deps.add(seg)
    }
  }
  return [...deps].sort()
}

/** `Row[]`: `{ entry, exports, error, deps }` — the full surface + graph. */
export function extractRows(ts: TS, repoRoot: string, entries: Entry[], config: CartographConfig = {}): Row[] {
  const srcRoot = join(repoRoot, config.srcDir ?? 'src')
  const topDirs = new Set(entries.map((e) => e.topDir))
  const program = createProgram(ts, repoRoot, entries, config.tsconfig)
  const checker = program.getTypeChecker()
  return entries.map((entry) => {
    const { exports = [], error } = exportsOf(ts, program, checker, entry)
    return { entry, exports, error, deps: siblingDeps(entry, srcRoot, topDirs) }
  })
}

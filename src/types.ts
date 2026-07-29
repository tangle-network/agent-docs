/** The TypeScript compiler API used for source extraction. */
export type TS = typeof import('@typescript/typescript6')

export interface Entry {
  /** Public subpath id: `.` for the root, else e.g. `chat-routes`. */
  id: string
  /** Export path as written in `exports`: `.` or `./chat-routes`. */
  exportPath: string
  /** Absolute path to the entry source file. */
  file: string
  /** Flattened name for the API page file: `index` or `chat-routes`. */
  apiName: string
  /** First path segment under the source root — the sibling-graph key. */
  topDir: string
  /** Directory containing the entry (scanned for the import graph). */
  srcDir: string
  /** Repo-relative source path, for display. */
  rel: string
}

export type ExportKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'function'
  | 'const'
  | 'value'

export interface ExportInfo {
  name: string
  kind: ExportKind
  signature: string
  doc: string
}

export interface Row {
  entry: Entry
  exports: ExportInfo[]
  error?: string
  deps: string[]
}

export interface CartographConfig {
  entries?: string[]
  srcDir?: string
  tsconfig?: string
  out?: string
  title?: string
  deepwiki?: boolean
  ask?: string[]
}

export interface RepoSlug {
  host: string
  owner: string
  repo: string
  slug: string
}

export interface DeepwikiResult {
  structure: string
  answers: Array<{ q: string; a: string }>
}

export interface Meta {
  out: string
  title: string
  /** One-line purpose (from package.json `description`), for the llms.txt blockquote. */
  description?: string
  sourceLabel: string
  slug?: string
  deepwiki?: DeepwikiResult
}

export interface AnalyzeOptions {
  out?: string
  deepwiki?: boolean
  ask?: string[]
}

export interface AnalyzeResult {
  root: string
  rows: Row[]
  meta: Meta
  slug: RepoSlug | null
  wantWiki: boolean
  deepwikiTried: boolean
  files: Map<string, string>
  wiki: { path: string; content: string } | null
}

export interface CheckResult {
  ok: boolean
  stale: string[]
  missing: string[]
  orphan: string[]
  meta: Meta
}

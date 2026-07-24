#!/usr/bin/env node
import { check, suggest, write } from './index'

const HELP = `agent-docs — deterministic repo surface + dependency map for any TypeScript package.

Usage:
  agent-docs [gen]            Regenerate docs/CODEMAP.md + docs/api/*.md + llms.txt + codemap.json
  agent-docs --check         Exit 1 if the committed deterministic docs are stale (CI gate)
  agent-docs --deepwiki      Also write docs/WIKI.md from DeepWiki (public GitHub repos only)
  agent-docs suggest         Draft JSDoc for UNDOCUMENTED exports via a cheap model, write into source

Options:
  --repo <path>              Repo root (default: cwd)
  --out <dir>                Output dir (default: docs, or agent-docs.config \`out\`)
  suggest --subpath <id>     Only document one subpath (e.g. chat-routes)
  suggest --model <id>       Model (default: claude-haiku-4-5-20251001, via TANGLE_API_KEY + ROUTER_URL)
  suggest --limit <n>        Cap exports documented this run
  suggest --dry-run          Draft + print, do not write to source
  -h, --help

Entry points are auto-detected: agent-docs.config > tsup.config \`entry\` > package.json \`exports\` > src/index.
generate/check are deterministic and LLM-free; suggest is the only LLM path and runs at AUTHORING time — it edits
your JSDoc so the gated docs stay type-derived.`

interface Args {
  command: 'gen' | 'check' | 'suggest'
  repo: string
  deepwiki: boolean
  out?: string
  subpath?: string
  model?: string
  limit?: number
  concurrency?: number
  dryRun: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: 'gen', repo: process.cwd(), deepwiki: false, dryRun: false, help: false }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === 'suggest') args.command = 'suggest'
    else if (a === '--check' || a === 'check') args.command = 'check'
    else if (a === '--deepwiki') args.deepwiki = true
    else if (a === '--repo') args.repo = rest[++i]
    else if (a === '--out') args.out = rest[++i]
    else if (a === '--subpath') args.subpath = rest[++i]
    else if (a === '--model') args.model = rest[++i]
    else if (a === '--limit') args.limit = Number(rest[++i])
    else if (a === '--concurrency') args.concurrency = Number(rest[++i])
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '-h' || a === '--help') args.help = true
    else if (a === 'gen') {
      /* default action */
    } else if (a.startsWith('-')) {
      console.error(`agent-docs: unknown option ${a}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(process.argv)
if (args.help) {
  console.log(HELP)
  process.exit(0)
}

try {
  if (args.command === 'check') {
    const r = await check(args.repo, { out: args.out })
    if (r.ok) {
      console.log('agent-docs: docs are fresh')
      process.exit(0)
    }
    console.error('agent-docs: docs are STALE — run `agent-docs` and commit the result.')
    for (const f of r.missing) console.error(`  missing:  ${f}`)
    for (const f of r.stale) console.error(`  changed:  ${f}`)
    for (const f of r.orphan) console.error(`  orphaned: ${f}`)
    process.exit(1)
  }

  if (args.command === 'suggest') {
    const r = await suggest(args.repo, {
      subpath: args.subpath,
      model: args.model,
      limit: args.limit,
      concurrency: args.concurrency,
      dryRun: args.dryRun,
      log: (m) => console.error(m),
    })
    if (r.dryRun) {
      for (const d of r.drafts) console.log(`${d.name}: ${d.doc}`)
      console.log(`agent-docs: drafted ${r.documented} (dry run — nothing written)`)
    } else {
      console.log(`agent-docs: documented ${r.documented} exports across ${r.files.length} files (${r.skipped} skipped). Review the diff, then \`agent-docs\` to refresh the map.`)
    }
    process.exit(0)
  }

  const r = await write(args.repo, { out: args.out, deepwiki: args.deepwiki })
  const det = r.written.filter((f) => !f.endsWith('WIKI.md')).length
  console.log(`agent-docs: wrote ${det} files under ${r.meta.out}/ (${r.rows.length} entries)`)
  if (args.deepwiki) {
    if (r.wiki) console.log(`agent-docs: + ${r.wiki.path} (DeepWiki: ${r.slug?.slug})`)
    else if (r.deepwikiTried)
      console.log(`agent-docs: DeepWiki skipped — ${r.slug?.slug ?? 'repo'} not indexed or unreachable (deterministic map unaffected)`)
    else console.log('agent-docs: DeepWiki needs a public github.com remote; skipped')
  }
} catch (err) {
  console.error(`agent-docs: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
}

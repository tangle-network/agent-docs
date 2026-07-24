#!/usr/bin/env node
import { check, write } from './index'

const HELP = `agent-docs — deterministic repo surface + dependency map for any TypeScript package.

Usage:
  agent-docs [gen]            Regenerate docs/CODEMAP.md + docs/api/*.md + docs/codemap.json
  agent-docs --check         Exit 1 if the committed deterministic docs are stale (CI gate)
  agent-docs --deepwiki      Also write docs/WIKI.md from DeepWiki (public GitHub repos only)

Options:
  --repo <path>              Repo root (default: cwd)
  --out <dir>                Output dir (default: docs, or agent-docs.config \`out\`)
  -h, --help

Entry points are auto-detected: agent-docs.config > tsup.config \`entry\` > package.json \`exports\` > src/index.
The deterministic files are what --check gates on; the DeepWiki WIKI.md is a non-authoritative reading aid and is never gated.`

interface Args {
  repo: string
  check: boolean
  deepwiki: boolean
  out?: string
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repo: process.cwd(), check: false, deepwiki: false, help: false }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--check' || a === 'check') args.check = true
    else if (a === '--deepwiki') args.deepwiki = true
    else if (a === '--repo') args.repo = rest[++i]
    else if (a === '--out') args.out = rest[++i]
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
  if (args.check) {
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

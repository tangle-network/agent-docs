#!/usr/bin/env node
import { check, write } from '../src/index.mjs'

const HELP = `cartograph — deterministic repo surface + dependency map for any TypeScript package.

Usage:
  cartograph [gen]            Regenerate docs/CODEMAP.md + docs/api/*.md + docs/codemap.json
  cartograph --check         Exit 1 if the committed deterministic docs are stale (CI gate)
  cartograph --deepwiki      Also write docs/WIKI.md from DeepWiki (public GitHub repos only)

Options:
  --repo <path>              Repo root (default: cwd)
  --out <dir>                Output dir (default: docs, or cartograph.config \`out\`)
  -h, --help

Entry points are auto-detected: cartograph.config > tsup.config \`entry\` > package.json \`exports\` > src/index.
The deterministic files are what --check gates on; the DeepWiki WIKI.md is a non-authoritative reading aid and is never gated.`

function parseArgs(argv) {
  const args = { repo: process.cwd(), check: false, deepwiki: false, out: undefined, help: false }
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
      console.error(`cartograph: unknown option ${a}`)
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
      console.log('cartograph: docs are fresh')
      process.exit(0)
    }
    console.error('cartograph: docs are STALE — run `cartograph` and commit the result.')
    for (const f of r.missing) console.error(`  missing:  ${f}`)
    for (const f of r.stale) console.error(`  changed:  ${f}`)
    for (const f of r.orphan) console.error(`  orphaned: ${f}`)
    process.exit(1)
  }

  const r = await write(args.repo, { out: args.out, deepwiki: args.deepwiki })
  const det = r.written.filter((f) => !f.endsWith('WIKI.md')).length
  console.log(`cartograph: wrote ${det} files under ${r.meta.out}/ (${r.rows.length} entries)`)
  if (args.deepwiki) {
    if (r.wiki) console.log(`cartograph: + ${r.wiki.path} (DeepWiki: ${r.slug?.slug})`)
    else if (r.deepwikiTried)
      console.log(`cartograph: DeepWiki skipped — ${r.slug?.slug ?? 'repo'} not indexed or unreachable (deterministic map unaffected)`)
    else console.log('cartograph: DeepWiki needs a public github.com remote; skipped')
  }
} catch (err) {
  console.error(`cartograph: ${err.message}`)
  process.exit(2)
}

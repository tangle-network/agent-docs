# cartograph

A deterministic **repo surface + dependency map** for any TypeScript package, with an optional **DeepWiki** narrative augment for public repos.

It answers "what does this package actually export, and how do its parts depend on each other?" — from source, so it can't drift — and gates that answer in CI. For public repos it can also pull DeepWiki's AI-generated architecture wiki alongside, clearly separated so the non-deterministic prose never contaminates the part CI trusts.

## Why

Hand-maintained "modules" tables and architecture docs lie the moment code moves. The mature fix (Microsoft's api-extractor "api-report", docs-as-tests) is to generate the surface from source and fail CI when the committed copy is stale. cartograph is that pattern, shaped for **multi-entry packages** (a `exports` menu with many subpaths) and **agent readability** — it emits the real dependency graph between subpaths, not just a symbol list, and a machine-readable JSON alongside the markdown.

## Two layers

| Layer | Source | Deterministic? | Gated by `--check`? |
|---|---|---|---|
| **Code map + API** (`CODEMAP.md`, `api/*.md`, `codemap.json`) | The TypeScript compiler walking real exports + the import graph | Yes | **Yes** |
| **Architecture wiki** (`WIKI.md`) | DeepWiki's MCP (`read_wiki_structure` / `ask_question`) | No (LLM prose) | **Never** |

The split is deliberate: an LLM must never write the artifact CI depends on. The deterministic files are the contract; `WIKI.md` is a reading aid.

## Usage

```bash
# regenerate the deterministic map (docs/CODEMAP.md + docs/api/*.md + docs/codemap.json)
npx @tangle-network/cartograph

# CI gate — exit 1 if the committed map is stale
npx @tangle-network/cartograph --check

# also write docs/WIKI.md from DeepWiki (public GitHub repos only)
npx @tangle-network/cartograph --deepwiki

# options
npx @tangle-network/cartograph --repo path/to/repo --out docs
```

Wire the gate into CI (it needs only the `typescript` the repo already has):

```yaml
- run: npx @tangle-network/cartograph --check
```

## Entry-point detection

Auto-detected, in priority order — no config needed for the common cases:

1. `cartograph.config.{mjs,json}` — explicit `entries` override
2. `tsup.config.ts` `entry` map
3. `package.json` `exports` (reverse-mapped from `dist` → `src`)
4. `src/index.ts`

```js
// cartograph.config.mjs (only if auto-detection misses)
export default {
  entries: ['src/index.ts', 'src/server/index.ts'],
  out: 'docs',
  deepwiki: true, // augment when the repo is public
}
```

## Public vs private repos

- **Private repos:** the deterministic core runs fully offline — no network, no LLM, no external service. This is the whole tool for a private repo.
- **Public repos:** add `--deepwiki` to pull the free, no-auth DeepWiki wiki + Q&A for the repo. If the repo isn't indexed yet, the augment is skipped and the deterministic map is unaffected. (Index a public repo once at `deepwiki.com/<owner>/<repo>`.)

## Requirements

Node ≥ 20, and `typescript` resolvable from the target repo (it's a peer dependency — every TS repo has it). cartograph carries no runtime dependencies of its own.

## License

MIT

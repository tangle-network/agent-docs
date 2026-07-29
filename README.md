# agent-docs

A deterministic **repo surface + dependency map** for any TypeScript package, with an optional **DeepWiki** narrative augment for public repos.

It answers "what does this package actually export, and how do its parts depend on each other?" — from source, so it can't drift — and gates that answer in CI. For public repos it can also pull DeepWiki's AI-generated architecture wiki alongside, clearly separated so the non-deterministic prose never contaminates the part CI trusts.

## Why

Hand-maintained "modules" tables and architecture docs lie the moment code moves. The mature fix (Microsoft's api-extractor "api-report", docs-as-tests) is to generate the surface from source and fail CI when the committed copy is stale. agent-docs is that pattern, shaped for **multi-entry packages** (a `exports` menu with many subpaths) and **agent readability** — it emits the real dependency graph between subpaths, not just a symbol list, and a machine-readable JSON alongside the markdown.

## Two layers

| Layer | Source | Deterministic? | Gated by `--check`? |
|---|---|---|---|
| **Code map + API** (`CODEMAP.md`, `api/*.md`, `codemap.json`) | The TypeScript compiler walking real exports + the import graph | Yes | **Yes** |
| **Agent-readable surface** (`llms.txt`, `llms-full.txt`) | Same extraction, emitted in the [llms.txt](https://llmstxt.org) format | Yes | **Yes** |
| **Architecture wiki** (`WIKI.md`) | DeepWiki's MCP (`read_wiki_structure` / `ask_question`) | No (LLM prose) | **Never** |

The `llms.txt` files are the differentiator: an agent-readable index (consumable by GitMCP, Context7, Cursor, Claude) that is **type-derived**, so it can't rot — `--check` fails when it diverges from the real exports. Every `llms.txt` generator in the wild is hand-written or crawl-inferred and drifts silently; this one is gated. (It is not a search/SEO artifact — Google doesn't consume llms.txt — its value is coding agents pulling it.)

The split is deliberate: an LLM must never write the artifact CI depends on. The deterministic files are the contract; `WIKI.md` is a reading aid.

## Usage

```bash
# regenerate the deterministic map (docs/CODEMAP.md + docs/api/*.md + docs/codemap.json)
npx @tangle-network/agent-docs

# CI gate — exit 1 if the committed map is stale
npx @tangle-network/agent-docs --check

# also write docs/WIKI.md from DeepWiki (public GitHub repos only)
npx @tangle-network/agent-docs --deepwiki

# options
npx @tangle-network/agent-docs --repo path/to/repo --out docs
```

Wire the gate into CI (it needs only the `typescript` the repo already has):

```yaml
- run: npx @tangle-network/agent-docs --check
```

## Entry-point detection

Auto-detected, in priority order — no config needed for the common cases:

1. `agent-docs.config.{mjs,json}` — explicit `entries` override
2. `tsup.config.ts` `entry` map
3. `package.json` `exports` (reverse-mapped from `dist` → `src`)
4. `src/index.ts`

```js
// agent-docs.config.mjs (only if auto-detection misses)
export default {
  entries: ['src/index.ts', 'src/server/index.ts'],
  out: 'docs',
  deepwiki: true, // augment when the repo is public
}
```

## Public vs private repos

- **Private repos:** the deterministic core runs fully offline — no network, no LLM, no external service. This is the whole tool for a private repo.
- **Public repos:** add `--deepwiki` to pull the free, no-auth DeepWiki wiki + Q&A for the repo. If the repo isn't indexed yet, the augment is skipped and the deterministic map is unaffected. (Index a public repo once at `deepwiki.com/<owner>/<repo>`.)

## Filling the JSDoc gap (`suggest`)

The `llms.txt` / API pages are only as rich as your JSDoc — and most codebases leave the majority of exports undocumented. `agent-docs suggest` closes that gap with a cheap model, **at authoring time**:

```bash
export TANGLE_API_KEY=...   # any OpenAI-compatible endpoint via ROUTER_URL (default: Tangle router)
agent-docs suggest --subpath chat-routes   # draft JSDoc for undocumented exports, write into source
agent-docs suggest --dry-run               # draft + print, write nothing
```

It finds every exported declaration that has no JSDoc, drafts a one-line summary from the signature + source, and inserts it above the declaration. Review the diff, commit, then re-run `agent-docs` — the new comments flow into the gated `llms.txt` **deterministically**.

This is the tool's only LLM path, and it is deliberately at authoring time, not generation time: the model improves your **source comments**; the generated docs stay type-derived and never contain raw model text, so `--check` keeps working. Defaults to `gpt-4.1-mini` via the Tangle router; override with `--model`.

## Requirements

Node ≥ 20. `agent-docs` carries Microsoft's TypeScript 6 compatibility API, so it works when the target repo uses TypeScript 7 without requiring compiler internals from that repo.

## License

MIT

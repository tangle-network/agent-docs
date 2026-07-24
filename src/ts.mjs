import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Load the TypeScript compiler, preferring the TARGET repo's own copy (so the
 * extraction uses the same version the repo compiles with), then falling back
 * to cartograph's own if it happens to have one installed. TypeScript is a peer
 * dependency: every TS repo already has it, and cartograph carries no runtime
 * deps of its own.
 */
export async function loadTs(repoRoot) {
  const candidates = []
  try {
    candidates.push(createRequire(join(repoRoot, 'package.json')).resolve('typescript'))
  } catch {
    /* target repo has no typescript resolvable — try ours */
  }
  try {
    candidates.push(createRequire(import.meta.url).resolve('typescript'))
  } catch {
    /* cartograph has no typescript installed either */
  }
  for (const path of candidates) {
    try {
      const mod = await import(pathToFileURL(path).href)
      return mod.default ?? mod
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "could not load 'typescript'. Run cartograph inside a repo that has typescript installed (it's a peer dependency).",
  )
}

import ts from '@typescript/typescript6'

import type { TS } from './types'

/**
 * Return the maintained TypeScript 6 compatibility API.
 * TypeScript 7 intentionally ships no programmatic compiler API, so extraction
 * must not borrow the target repo's `typescript` package.
 */
export function loadTs(): TS {
  return ts
}

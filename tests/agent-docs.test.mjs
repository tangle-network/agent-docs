import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { analyze, check, parseRemoteUrl, write } from '../dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixture')

test('parseRemoteUrl handles ssh, https, and non-github', () => {
  assert.deepEqual(parseRemoteUrl('git@github.com:tangle-network/agent-app.git'), {
    host: 'github.com',
    owner: 'tangle-network',
    repo: 'agent-app',
    slug: 'tangle-network/agent-app',
  })
  assert.deepEqual(parseRemoteUrl('https://github.com/foo/bar'), {
    host: 'github.com',
    owner: 'foo',
    repo: 'bar',
    slug: 'foo/bar',
  })
  assert.equal(parseRemoteUrl('gitlab.example.com/x/y')?.host ?? null, null)
  assert.equal(parseRemoteUrl(''), null)
})

test('analyze detects both exports entries, their exports, and the dep edge', async () => {
  const { rows } = await analyze(FIXTURE)
  const ids = rows.map((r) => r.entry.exportPath).sort()
  assert.deepEqual(ids, ['.', './util'])

  const root = rows.find((r) => r.entry.exportPath === '.')
  const util = rows.find((r) => r.entry.exportPath === './util')

  assert.ok(root.exports.some((e) => e.name === 'makeWidget' && e.kind === 'function'))
  assert.ok(root.exports.find((e) => e.name === 'makeWidget').doc.startsWith('Build a widget id'))
  assert.ok(util.exports.some((e) => e.name === 'WidgetId' && e.kind === 'type'))
  assert.ok(util.exports.some((e) => e.name === 'WIDGET_PREFIX'))

  // root re-exports/imports from util → a recorded sibling dependency edge.
  assert.ok(root.deps.includes('util'), `expected root to depend on util, got ${JSON.stringify(root.deps)}`)
})

test('analyze does not require a compiler API from the target project', async () => {
  const target = mkdtempSync(join(tmpdir(), 'agent-docs-typescript7-'))
  try {
    cpSync(FIXTURE, target, { recursive: true })
    const targetTypescript = join(target, 'node_modules', 'typescript')
    mkdirSync(targetTypescript, { recursive: true })
    writeFileSync(
      join(targetTypescript, 'package.json'),
      JSON.stringify({ name: 'typescript', version: '7.0.2', type: 'module', exports: './index.js' }),
    )
    writeFileSync(join(targetTypescript, 'index.js'), "export default { version: '7.0.2' }\n")

    const { rows } = await analyze(target)
    assert.equal(rows.length, 2)
    assert.ok(rows.some((row) => row.exports.some((entry) => entry.name === 'makeWidget')))
  } finally {
    rmSync(target, { recursive: true, force: true })
  }
})

test('write then --check round-trips clean; a hand-edit trips the gate', async () => {
  const out = '.agent-docs-test'
  try {
    await write(FIXTURE, { out })
    const fresh = await check(FIXTURE, { out })
    assert.equal(fresh.ok, true, `expected fresh, got ${JSON.stringify(fresh)}`)

    // Corrupt one generated file → the gate must catch it.
    const { writeFileSync, readFileSync } = await import('node:fs')
    const codemap = join(FIXTURE, out, 'CODEMAP.md')
    writeFileSync(codemap, readFileSync(codemap, 'utf8') + '\nstray edit\n')
    const stale = await check(FIXTURE, { out })
    assert.equal(stale.ok, false)
    assert.ok(stale.stale.some((f) => f.endsWith('CODEMAP.md')))
  } finally {
    rmSync(join(FIXTURE, out), { recursive: true, force: true })
  }
})

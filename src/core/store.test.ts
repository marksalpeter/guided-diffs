import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewStore } from './store.js'
import type { ReviewEvent } from './events.js'

const created = (key: string): ReviewEvent => ({
  t: 'review.created',
  v: 1,
  key,
  kind: 'branch',
  branch: 'feature/x',
  baseSha: 'base',
  headSha: 'head',
  baseLabel: 'main',
  headLabel: 'feature/x',
  at: '2026-01-01T00:00:00Z',
})

describe('ReviewStore', () => {
  let dir: string
  let store: ReviewStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gdr-store-'))
    store = new ReviewStore(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('slugs branch names into safe keys', () => {
    expect(ReviewStore.keyForBranch('claude/guided-diff-viewer')).toBe('claude-guided-diff-viewer')
    expect(ReviewStore.keyForRange('abcdef1234567890', 'fedcba0987654321')).toBe('abcdef123456..fedcba098765')
  })

  it('makes the store self-ignoring so it never enters git', async () => {
    await store.ensureStoreDir()
    expect(await readFile(join(dir, '.guided-review/.gitignore'), 'utf8')).toContain('*')
  })

  it('round-trips appended events', async () => {
    await store.append('k', created('k'))
    await store.append('k', { t: 'thread.resolved', threadId: 't1', at: 'x' })
    const events = await store.read('k')
    expect(events.map(e => e.t)).toEqual(['review.created', 'thread.resolved'])
  })

  it('returns no events for a review that does not exist', async () => {
    expect(await store.read('missing')).toEqual([])
  })

  it('skips malformed and unknown lines instead of failing the whole log', async () => {
    await store.append('k', created('k'))
    await writeFile(store.pathFor('k'), 'not json\n{"t":"unknown.event"}\n{ broken\n', { flag: 'a' })
    await store.append('k', { t: 'thread.resolved', threadId: 't1', at: 'x' })

    const events = await store.read('k')
    expect(events.map(e => e.t)).toEqual(['review.created', 'thread.resolved'])
  })

  it('folds a log into review state', async () => {
    await store.append('k', created('k'))
    await store.append('k', {
      t: 'thread.opened',
      id: 't1',
      anchor: { kind: 'line', path: 'a.ts', side: 'new', line: 1, blob: 'b', text: 'x', contextHash: 'c' },
      at: 'a',
    })
    const state = await store.load('k')
    expect(state.branch).toBe('feature/x')
    expect(state.threads).toHaveLength(1)
  })

  it('appends a body larger than the atomic write ceiling without corruption', async () => {
    const body = 'x'.repeat(10_000)
    await store.append('k', created('k'))
    await store.append('k', { t: 'comment.added', id: 'c1', threadId: 't1', author: 'agent', body, at: 'a' })

    const events = await store.read('k')
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ t: 'comment.added', body })
  })

  it('survives many concurrent appends without losing or tearing a record', async () => {
    await store.append('k', created('k'))
    const writes = Array.from({ length: 40 }, (_, i) =>
      store.append('k', { t: 'comment.added', id: `c${i}`, threadId: 't1', author: 'human', body: `b${i}`, at: 'a' }),
    )
    await Promise.all(writes)

    const events = await store.read('k')
    expect(events).toHaveLength(41)
    const ids = new Set(events.filter(e => e.t === 'comment.added').map(e => e.id))
    expect(ids.size).toBe(40)
  })

  it('lists and deletes reviews', async () => {
    await store.append('one', created('one'))
    await store.append('two', created('two'))
    expect((await store.list()).sort()).toEqual(['one', 'two'])

    await store.delete('one')
    expect(await store.list()).toEqual(['two'])
  })

  it('finds the review whose head matches a sha', async () => {
    await store.append('one', created('one'))
    await store.append('one', { t: 'review.head_moved', headSha: 'deadbeef', headLabel: 'f', at: 'b' })
    expect(await store.findByHead('deadbeef')).toBe('one')
    expect(await store.findByHead('nope')).toBeNull()
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SystemExec } from './exec.js'
import { Git } from './git.js'

describe('Git', () => {
  let dir: string
  let git: Git

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gr-git-'))
    const exec = new SystemExec(dir)
    await exec.run('git', ['init', '-q', '-b', 'main'])
    await exec.run('git', ['config', 'user.email', 'test@example.com'])
    await exec.run('git', ['config', 'user.name', 'Test'])
    git = new Git(dir, exec)

    await writeFile(join(dir, 'a.ts'), 'export const a = 1\nexport const b = 2\n')
    await writeFile(join(dir, 'keep.ts'), 'export const keep = true\n')
    await exec.run('git', ['add', '-A'])
    await exec.run('git', ['commit', '-qm', 'base'])

    await exec.run('git', ['checkout', '-qb', 'feature'])
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\nexport const b = 22\nexport const c = 3\n')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub/new.ts'), 'export const n = 1\n')
    await exec.run('git', ['add', '-A'])
    await exec.run('git', ['commit', '-qm', 'feature work'])
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves the merge base between two refs', async () => {
    const base = await git.mergeBase('main', 'feature')
    const mainSha = await git.revParse('main')
    expect(base).toBe(mainSha)
  })

  it('reports the current branch', async () => {
    expect(await git.currentBranch()).toBe('feature')
  })

  it('rejects an invalid revision', async () => {
    await expect(git.revParse('no-such-ref')).rejects.toThrow()
  })

  it('lists changed files with blobs and line counts', async () => {
    const files = await git.changedFiles('main', 'feature')
    const byPath = Object.fromEntries(files.map(f => [f.path, f]))

    expect(Object.keys(byPath).sort()).toEqual(['a.ts', 'sub/new.ts'])
    expect(byPath['a.ts']?.status).toBe('modified')
    expect(byPath['a.ts']?.additions).toBe(2)
    expect(byPath['a.ts']?.deletions).toBe(1)
    expect(byPath['a.ts']?.oldBlob).toMatch(/^[0-9a-f]{40}$/)
    expect(byPath['a.ts']?.newBlob).toMatch(/^[0-9a-f]{40}$/)
    expect(byPath['sub/new.ts']?.status).toBe('added')
    expect(byPath['sub/new.ts']?.oldBlob).toBeNull()
  })

  it('excludes the review store from the diff', async () => {
    const exec = new SystemExec(dir)
    await mkdir(join(dir, '.guided-review'), { recursive: true })
    await writeFile(join(dir, '.guided-review/feature.jsonl'), '{}\n')
    await exec.run('git', ['add', '-Af'])
    await exec.run('git', ['commit', '-qm', 'store'])

    const files = await git.changedFiles('main', 'feature')
    expect(files.map(f => f.path)).not.toContain('.guided-review/feature.jsonl')
  })

  it('produces a unified diff', async () => {
    const diff = await git.unifiedDiff('main', 'feature')
    expect(diff).toContain('diff --git')
    expect(diff).toContain('+export const c = 3')
  })

  it('reads blob contents', async () => {
    const files = await git.changedFiles('main', 'feature')
    const a = files.find(f => f.path === 'a.ts')
    const text = await git.blobText(a!.newBlob!)
    expect(text).toContain('export const c = 3')
  })

  it('detects renames', async () => {
    const exec = new SystemExec(dir)
    await exec.run('git', ['mv', 'keep.ts', 'moved.ts'])
    await exec.run('git', ['commit', '-qm', 'rename'])

    const files = await git.changedFiles('main', 'feature')
    const renamed = files.find(f => f.status === 'renamed')
    expect(renamed?.oldPath).toBe('keep.ts')
    expect(renamed?.path).toBe('moved.ts')
  })

  it('lists local branches and recent commits', async () => {
    expect(await git.localBranches()).toEqual(expect.arrayContaining(['main', 'feature']))
    const commits = await git.recentCommits(5)
    expect(commits.length).toBeGreaterThan(0)
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(commits[0]?.subject).toBeTruthy()
  })

  it('falls back through default-branch candidates when no origin exists', async () => {
    expect(await git.defaultBranch()).toBe('main')
  })

  it('honours an explicit default-branch override', async () => {
    const overridden = new Git(dir, new SystemExec(dir), 'feature')
    expect(await overridden.defaultBranch()).toBe('feature')
  })
})

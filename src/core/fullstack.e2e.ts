import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SystemExec } from './exec.js'
import { unresolvedThreads } from './fold.js'
import { Git } from './git.js'
import { ClaudeCli } from './guide.js'
import { ReviewService } from './review.js'
import { main } from '../cli/main.js'

/** Capture collects CLI output for assertions. */
class Capture {
  text = ''
  write(chunk: string): void {
    this.text += chunk
  }
}

describe('full stack against the real claude binary', () => {
  let dir: string
  let cwd: string
  let exec: SystemExec
  let service: ReviewService
  let key: string

  beforeAll(async () => {
    cwd = process.cwd()
    dir = await mkdtemp(join(tmpdir(), 'gdr-e2e-'))
    exec = new SystemExec(dir)
    await exec.run('git', ['init', '-q', '-b', 'main'])
    await exec.run('git', ['config', 'user.email', 'test@example.com'])
    await exec.run('git', ['config', 'user.name', 'Test'])

    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/server.ts'), 'export function handle(req: Request) {\n  return new Response("ok")\n}\n')
    await writeFile(join(dir, 'package.json'), '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n')
    await exec.run('git', ['add', '-A'])
    await exec.run('git', ['commit', '-qm', 'base'])

    await exec.run('git', ['checkout', '-qb', 'add-auth'])
    await writeFile(
      join(dir, 'src/auth.ts'),
      [
        'export interface Session {',
        '  userId: string',
        '  expiresAt: number',
        '}',
        '',
        'export function verify(token: string): Session | null {',
        '  const parts = token.split(".")',
        '  if (parts.length !== 3) {',
        '    return null',
        '  }',
        '  return { userId: parts[1], expiresAt: Number(parts[2]) }',
        '}',
        '',
      ].join('\n'),
    )
    await writeFile(
      join(dir, 'src/server.ts'),
      [
        'import { verify } from "./auth"',
        '',
        'export function handle(req: Request) {',
        '  const token = req.headers.get("authorization")',
        '  const session = verify(token)',
        '  if (!session) {',
        '    return new Response("unauthorized", { status: 401 })',
        '  }',
        '  return new Response("ok")',
        '}',
        '',
      ].join('\n'),
    )
    await writeFile(join(dir, 'package.json'), '{\n  "name": "demo",\n  "version": "1.1.0"\n}\n')
    await exec.run('git', ['add', '-A'])
    await exec.run('git', ['commit', '-qm', 'add session verification'])

    service = new ReviewService(new Git(dir, exec))
    key = await service.openBranchReview()
  })

  afterAll(async () => {
    process.chdir(cwd)
    await rm(dir, { recursive: true, force: true })
  })

  it('sees the whole change between the merge base and HEAD', async () => {
    const { state, files } = await service.load(key)
    expect(state.refs.baseLabel).toBe('main')
    expect(files.map(f => f.path).sort()).toEqual(['package.json', 'src/auth.ts', 'src/server.ts'])
  })

  it('generates a guide from the real claude binary', async () => {
    await service.generateGuide(key, new ClaudeCli('claude', 'claude-opus-5'))

    const { state, files } = await service.load(key)
    expect(state.guideError).toBeUndefined()
    expect(state.guide).toBeDefined()
    expect(state.guide!.groups.length).toBeGreaterThan(0)

    const assigned = state.guide!.groups.flatMap(g => g.files)
    expect(assigned.slice().sort()).toEqual(files.map(f => f.path).sort())
    expect(new Set(assigned).size).toBe(assigned.length)

    for (const group of state.guide!.groups) {
      expect(group.title.length).toBeGreaterThan(0)
      expect(group.summary.length).toBeGreaterThan(0)
    }

    console.log(
      '\nGenerated guide:\n' +
        state.guide!.groups.map(g => `  ${g.title}\n    ${g.summary}\n    ${g.files.join(', ')}`).join('\n'),
    )
  }, 300_000)

  it('leads with the core of the change', async () => {
    const { state } = await service.load(key)
    expect(state.guide!.groups[0]?.files).toContain('src/auth.ts')
  })

  it('hands an agent the human comment through the CLI', async () => {
    await service.startThread(key, 'src/auth.ts', 'new', 7, 'token can be null here — verify() will throw')
    process.chdir(dir)

    const out = new Capture()
    expect(await main(['comments'], out, new Capture())).toBe(0)
    expect(out.text).toContain('src/auth.ts:7')
    expect(out.text).toContain('token can be null here')
    expect(out.text).toContain('gdr reply <thread-id>')
  })

  it('shows the agent reply back to the human', async () => {
    const { state } = await service.load(key)
    const threadId = state.threads[0]!.id

    process.chdir(dir)
    expect(await main(['reply', threadId, '-m', 'guarded the null token in HEAD'], new Capture(), new Capture())).toBe(0)

    const after = await service.load(key)
    expect(after.state.threads[0]?.comments.map(c => c.author)).toEqual(['human', 'agent'])
  })

  it('carries the thread forward and re-pins it after the agent commits', async () => {
    await writeFile(
      join(dir, 'src/auth.ts'),
      [
        '// guard the null token before verifying',
        '',
        'export interface Session {',
        '  userId: string',
        '  expiresAt: number',
        '}',
        '',
        'export function verify(token: string | null): Session | null {',
        '  if (!token) {',
        '    return null',
        '  }',
        '  const parts = token.split(".")',
        '  if (parts.length !== 3) {',
        '    return null',
        '  }',
        '  return { userId: parts[1], expiresAt: Number(parts[2]) }',
        '}',
        '',
      ].join('\n'),
    )
    await exec.run('git', ['add', '-A'])
    await exec.run('git', ['commit', '-qm', 'guard null token'])
    await service.openBranchReview()

    const { state } = await service.load(key)
    const thread = state.threads[0]!
    expect(thread.state).toBe('open')
    expect(['relocated', 'outdated']).toContain(thread.status)
    expect(thread.comments).toHaveLength(2)
    expect(state.guideStale).toBe(true)
  })

  it('hides the thread from the agent once the human resolves it', async () => {
    const { state } = await service.load(key)
    await service.resolveThread(key, state.threads[0]!.id)

    expect(unresolvedThreads((await service.load(key)).state)).toHaveLength(0)

    process.chdir(dir)
    const out = new Capture()
    await main(['comments'], out, new Capture())
    expect(out.text).toContain('No unresolved review comments')
  })
})

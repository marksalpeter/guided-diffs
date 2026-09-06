import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SystemExec } from '../core/exec.js'
import {
  excludeFromGit,
  installAgentSupport,
  shimRelativePath,
  skillRelativePath,
  writeShim,
} from './agentSupport.js'

describe('agent support', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gr-agent-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes an executable shim inside the ignored store', async () => {
    const path = await writeShim(dir, '/usr/bin/code', '/ext/dist/cli.js')
    const script = await readFile(path, 'utf8')

    expect(path).toContain(shimRelativePath)
    expect(script).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(script).toContain("'/usr/bin/code'")
    expect(script).toContain("'/ext/dist/cli.js'")
    expect((await stat(path)).mode & 0o111).toBeTruthy()
  })

  it('records the editor uri scheme so the cli can deep-link back', async () => {
    const path = await writeShim(dir, '/usr/bin/code', '/ext/dist/cli.js', { REVIEW_URI_SCHEME: 'cursor' })
    expect(await readFile(path, 'utf8')).toContain("REVIEW_URI_SCHEME='cursor' ELECTRON_RUN_AS_NODE=1")
  })

  it('quotes paths containing spaces', async () => {
    const path = await writeShim(dir, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/a b/cli.js')
    expect(await readFile(path, 'utf8')).toContain("'/Applications/Visual Studio Code.app/Contents/MacOS/Electron'")
  })

  it('appends the skill to this clone private ignore list', async () => {
    const gitDir = join(dir, '.git')
    await mkdir(gitDir, { recursive: true })

    await excludeFromGit(gitDir, skillRelativePath)
    expect(await readFile(join(gitDir, 'info/exclude'), 'utf8')).toContain(skillRelativePath)
  })

  it('does not duplicate an exclude entry across activations', async () => {
    const gitDir = join(dir, '.git')
    await mkdir(gitDir, { recursive: true })

    await excludeFromGit(gitDir, skillRelativePath)
    await excludeFromGit(gitDir, skillRelativePath)
    await excludeFromGit(gitDir, skillRelativePath)

    const contents = await readFile(join(gitDir, 'info/exclude'), 'utf8')
    expect(contents.split('\n').filter(l => l.trim() === skillRelativePath)).toHaveLength(1)
  })

  it('preserves existing exclude entries and fixes a missing trailing newline', async () => {
    const gitDir = join(dir, '.git')
    await mkdir(join(gitDir, 'info'), { recursive: true })
    await writeFile(join(gitDir, 'info/exclude'), '# custom\nscratch/')

    await excludeFromGit(gitDir, skillRelativePath)
    const lines = (await readFile(join(gitDir, 'info/exclude'), 'utf8')).split('\n')
    expect(lines).toContain('scratch/')
    expect(lines).toContain(skillRelativePath)
  })

  it('writes a skill that tells the agent it cannot resolve threads', async () => {
    await installAgentSupport({
      repoRoot: dir,
      gitCommonDir: join(dir, '.git'),
      nodePath: '/usr/bin/code',
      cliPath: '/ext/dist/cli.js',
      uriScheme: 'vscode',
    })

    const skill = await readFile(join(dir, skillRelativePath), 'utf8')
    expect(skill).toContain('name: guided-reviews')
    expect(skill).toContain('You cannot resolve threads')
    expect(skill).toContain(`${shimRelativePath} comments`)
    expect(skill).toContain(`${shimRelativePath} reply`)
  })

  it('really keeps the skill out of git status', async () => {
    const exec = new SystemExec(dir)
    await exec.run('git', ['init', '-q', '-b', 'main'])
    await exec.run('git', ['config', 'user.email', 't@e.com'])
    await exec.run('git', ['config', 'user.name', 'T'])
    const gitCommonDir = (await exec.run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()

    await installAgentSupport({ repoRoot: dir, gitCommonDir, nodePath: '/usr/bin/code', cliPath: '/ext/dist/cli.js', uriScheme: 'vscode' })

    const status = await exec.run('git', ['status', '--porcelain'])
    expect(status).not.toContain('.claude')
    expect(status).not.toContain('guided-review')
  })
})

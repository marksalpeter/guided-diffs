import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

const repo = await mkdtemp(join(tmpdir(), 'gdr-agent-'))
const git = (...a) => run('git', a, { cwd: repo })
await git('init', '-q', '-b', 'main')
await git('config', 'user.email', 'demo@example.com')
await git('config', 'user.name', 'Demo')
await mkdir(join(repo, 'src'), { recursive: true })
await writeFile(join(repo, 'src/parse.ts'), 'export function parse(raw: string) {\n  return JSON.parse(raw)\n}\n')
await git('add', '-A'); await git('commit', '-qm', 'base')
await git('checkout', '-qb', 'feature')
await writeFile(join(repo, 'src/parse.ts'),
  'export interface Config {\n  name: string\n}\n\nexport function parse(raw: string): Config {\n  const value = JSON.parse(raw)\n  return { name: value.name }\n}\n')
await git('add', '-A'); await git('commit', '-qm', 'type the config parser')

// what the extension does on activation
const { installAgentSupport } = await import('../dist/extension-api.mjs').catch(() => ({}))
const { ReviewService } = await import('./bridge.mjs')
const svc = await ReviewService(repo)
await svc.install(process.execPath, join(process.cwd(), 'dist/cli.js'))
const key = await svc.openBranchReview()
await svc.startThread(key, 'src/parse.ts', 'new', 6, 'JSON.parse throws on malformed input — this should return a typed error, not blow up the caller.')

console.log('--- skill installed at .claude/skills/guided-diffs/SKILL.md')
console.log('--- shim installed at .guided-review/bin/gdr')
console.log('--- one unresolved thread seeded\n')

const claude = spawn('claude', [
  '-p', 'Address the guided review comments on this branch.',
  '--permission-mode', 'auto',
  '--output-format', 'stream-json', '--verbose', '--model', 'claude-opus-5',
], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
claude.stderr.on('data', d => process.stderr.write(d))

let buf = ''
const toolCalls = []
claude.stdout.on('data', d => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    try {
      const ev = JSON.parse(line)
      if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) {
        if (c.type === 'tool_use') {
          const desc = c.input?.command ?? c.input?.file_path ?? c.input?.skill ?? ''
          toolCalls.push(`${c.name} ${String(desc).slice(0, 110)}`)
          console.log(`  ${c.name} ${String(desc).slice(0, 110)}`)
        }
      }
    } catch {}
  }
})
await new Promise(r => claude.on('close', r))

console.log('\n--- final store state ---')
const log = await readFile(join(repo, `.guided-review/${key}.jsonl`), 'utf8')
for (const line of log.trim().split('\n')) {
  const e = JSON.parse(line)
  if (e.t === 'comment.added') console.log(`  ${e.author}: ${e.body}`)
}
console.log('\n--- git log ---')
console.log((await git('log', '--oneline', '-3')).stdout.trim())
console.log('\n--- final src/parse.ts ---')
console.log(await readFile(join(repo, 'src/parse.ts'), 'utf8'))
console.log('used gdr:', toolCalls.some(t => t.includes('gdr')))
await rm(repo, { recursive: true, force: true })

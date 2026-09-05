import { spawn } from 'node:child_process'
import type { ChangedFile, GroupKind, GuideGroup } from './types.js'

/** kindOrder is the reading order of guide chapters: the core change, its fallout, then glue. */
const kindOrder: readonly GroupKind[] = ['core', 'consequence', 'auxiliary']

/** otherChangesTitle names the group that holds files the model left unassigned. */
const otherChangesTitle = 'Other changes'

/** systemPrompt fixes the output contract; the diff itself arrives on stdin. */
const systemPrompt = [
  'You group a git diff into a guided code review, like a chapter outline.',
  'Reply with JSON only, matching: {"groups":[{"title":string,"summary":string,"kind":"core"|"consequence"|"auxiliary","files":string[]}]}',
  'Order groups so a reader meets the core of the change first, then its consequences, then glue and secondary changes.',
  'title: a short, informative noun phrase. summary: one or two sentences saying what the change is, then what it causes.',
  'Assign every changed file to exactly one group. Use only the paths given to you.',
].join('\n')

/** GuideGenerator turns a diff into ordered, validated guide chapters. */
export class GuideGenerator {
  private runner: ClaudeRunner

  constructor(runner: ClaudeRunner) {
    this.runner = runner
  }

  /** generate asks the model for a grouping and repairs whatever it returns. */
  async generate(files: readonly ChangedFile[], diff: string): Promise<GuideGroup[]> {
    const raw = await this.runner.run(buildGuidePrompt(files), diff)
    const groups = parseGuideResponse(raw)
    if (groups === null) {
      throw new Error('the guided review response could not be parsed as JSON')
    }
    return repairGroups(groups, files.map(f => f.path))
  }
}

/** ClaudeCli runs one headless, tool-free `claude -p` turn and returns its raw stdout. */
export class ClaudeCli implements ClaudeRunner {
  private command: string
  private model: string

  constructor(command = 'claude', model = 'claude-opus-5') {
    this.command = command
    this.model = model
  }

  run(prompt: string, stdin: string): Promise<string> {
    // no tools: grouping is pure inference, and it must not be able to touch the repo it reviews
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--max-turns',
      '1',
      '--model',
      this.model,
      '--allowed-tools',
      '',
      '--append-system-prompt',
      systemPrompt,
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.stderr.on('data', (d: Buffer) => (err += d.toString()))
      child.on('error', e => reject(new Error(`could not run ${this.command}: ${e.message}`)))
      child.on('close', code => {
        if (code === 0) {
          resolve(out)
          return
        }
        reject(new Error(err.trim() || `${this.command} exited with code ${code}`))
      })
      child.stdin.end(stdin)
    })
  }
}

/** buildGuidePrompt states the task and the exact set of paths the model may assign. */
export function buildGuidePrompt(files: readonly ChangedFile[]): string {
  const manifest = files
    .map(f => `- ${f.path} (+${f.additions}/-${f.deletions}${f.binary ? ', binary' : ''}, ${f.status})`)
    .join('\n')
  return [
    'Group the unified diff on stdin into a guided review.',
    '',
    'Changed files:',
    manifest,
    '',
    'Reply with JSON only.',
  ].join('\n')
}

/** parseGuideResponse digs the groups array out of Claude Code's json envelope. */
export function parseGuideResponse(raw: string): RawGroup[] | null {
  const text = unwrapEnvelope(raw)
  const payload = extractJsonObject(text)
  if (payload === null) {
    return null
  }
  const groups = (payload as { groups?: unknown }).groups
  return Array.isArray(groups) ? (groups as RawGroup[]) : null
}

/** repairGroups enforces the one-file-one-group invariant, visibly rather than silently. */
export function repairGroups(groups: readonly RawGroup[], changedPaths: readonly string[]): GuideGroup[] {
  const valid = new Set(changedPaths)
  const claimed = new Set<string>()

  const repaired = groups
    .map((group, index) => toGuideGroup(group, index, valid, claimed))
    .filter(group => group.files.length > 0)
    .sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind))

  const unassigned = changedPaths.filter(path => !claimed.has(path))
  if (unassigned.length > 0) {
    repaired.push({
      id: `g${repaired.length}-other`,
      title: otherChangesTitle,
      summary: 'Files the guide did not classify.',
      kind: 'auxiliary',
      files: unassigned,
      repaired: true,
    })
  }
  return repaired
}

/** toGuideGroup normalises one model-supplied group, claiming each file for its first group. */
function toGuideGroup(group: RawGroup, index: number, valid: Set<string>, claimed: Set<string>): GuideGroup {
  const files: string[] = []
  for (const path of Array.isArray(group.files) ? group.files : []) {
    if (valid.has(path) && !claimed.has(path)) {
      claimed.add(path)
      files.push(path)
    }
  }
  return {
    id: `g${index}-${slug(String(group.title ?? 'group'))}`,
    title: String(group.title ?? 'Untitled'),
    summary: String(group.summary ?? ''),
    kind: toGroupKind(group.kind),
    files,
  }
}

/** toGroupKind coerces an unrecognised kind to the least prominent chapter. */
function toGroupKind(kind: unknown): GroupKind {
  return kindOrder.includes(kind as GroupKind) ? (kind as GroupKind) : 'auxiliary'
}

/** unwrapEnvelope returns the assistant text from a Claude Code json result, or the input as-is. */
function unwrapEnvelope(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = (parsed as { result?: unknown }).result
    return typeof result === 'string' ? result : raw
  } catch {
    return raw
  }
}

/** extractJsonObject finds the first balanced JSON object in text that may carry prose or fences. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) {
    return null
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** slug reduces a title to an id-safe fragment. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'group'
}

/** ClaudeRunner is the inference seam, mocked in tests and backed by `claude -p` in production. */
export interface ClaudeRunner {
  run(prompt: string, stdin: string): Promise<string>
}

/** RawGroup is one unvalidated group as the model returned it. */
export interface RawGroup {
  title?: unknown
  summary?: unknown
  kind?: unknown
  files?: unknown
}

export const __test = { extractJsonObject, unwrapEnvelope, slug, systemPrompt }

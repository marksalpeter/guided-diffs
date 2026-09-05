import { spawn } from 'node:child_process'
import type { ChangedFile, GuideGroup } from './types.js'

/** otherChangesTitle names the group that holds files the model left unassigned. */
const otherChangesTitle = 'Other changes'

/** describeSystemPrompt asks what each file's edit does, with no grouping to bias the answer. */
const describeSystemPrompt = [
  'You read a git diff and say what each changed file does.',
  'One sentence per file: what its edit does, and what that serves. Name the feature or behaviour it belongs to.',
  'Do not group the files, rank them, or judge the change.',
  'Reply with JSON only, matching: {"files":[{"path":string,"does":string}]}',
  'Cover every path given to you, once each, using only those paths.',
].join('\n')

/** groupSystemPrompt turns the per-file descriptions into chapters, never seeing the diff. */
const groupSystemPrompt = [
  'You are given one sentence per changed file, describing what it does. Group them into the chapters of a code review.',
  'A chapter is one thing the change does. Files that serve the same thing belong together however far apart they sit in the tree.',
  'Merge two chapters if you cannot explain one without the other.',
  'Reply with JSON only, matching: {"groups":[{"title":string,"summary":string,"files":string[]}]}',
  'title: a short noun phrase. summary: one or two sentences on what the chapter does and why those files are together.',
  'Put the main thing first and incidental edits last. Assign every path to exactly one chapter, using only the paths given to you.',
].join('\n')

/** GuideGenerator turns a diff into ordered, validated guide chapters. */
export class GuideGenerator {
  private runner: ClaudeRunner

  constructor(runner: ClaudeRunner) {
    this.runner = runner
  }

  /** generate describes each file, groups those descriptions, then repairs whatever came back. */
  async generate(files: readonly ChangedFile[], diff: string): Promise<GuideGroup[]> {
    // two passes: describing and grouping in one call makes the model partition by path, not by purpose
    const described = await this.runner.run(buildDescribePrompt(files), diff, describeSystemPrompt)
    const notes = parseDescriptions(described, files.map(f => f.path))
    if (notes.length === 0) {
      throw new Error('the guided review could not describe any changed file')
    }
    const raw = await this.runner.run(buildGroupPrompt(notes), '', groupSystemPrompt)
    const groups = parseGuideResponse(raw)
    if (groups === null) {
      throw new Error('the guided review response could not be parsed as JSON')
    }
    const repaired = repairGroups(groups, files.map(f => f.path))
    if (repaired.every(group => group.repaired)) {
      throw new Error('the guided review assigned no files to any chapter')
    }
    return repaired
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

  run(prompt: string, stdin: string, system: string): Promise<string> {
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
      system,
    ]
    return new Promise((resolve, reject) => {
      // grouping is a judgement call, so buy it room to think before it commits to chapters
      const env = { ...process.env, MAX_THINKING_TOKENS: '8000' }
      const child = spawn(this.command, args, { stdio: ['pipe', 'pipe', 'pipe'], env })
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

/** buildDescribePrompt states the exact set of paths the model must describe. */
export function buildDescribePrompt(files: readonly ChangedFile[]): string {
  const manifest = files
    .map(f => `- ${f.path} (+${f.additions}/-${f.deletions}${f.binary ? ', binary' : ''}, ${f.status})`)
    .join('\n')
  return ['Describe each file changed by the unified diff on stdin.', '', 'Changed files:', manifest, '', 'Reply with JSON only.'].join('\n')
}

/** buildGroupPrompt hands the grouping pass the descriptions and nothing else. */
export function buildGroupPrompt(notes: readonly FileNote[]): string {
  const described = notes.map(note => `- ${note.path}: ${note.does}`).join('\n')
  return ['Group these changed files into the chapters of a code review.', '', described, '', 'Reply with JSON only.'].join('\n')
}

/** parseDescriptions reads the first pass back, keeping one note per real path. */
export function parseDescriptions(raw: string, changedPaths: readonly string[]): FileNote[] {
  const payload = extractJsonObject(unwrapEnvelope(raw))
  const described = (payload as { files?: unknown } | null)?.files
  const notes = new Map<string, string>()
  for (const entry of Array.isArray(described) ? (described as RawNote[]) : []) {
    const path = String(entry?.path ?? '')
    if (changedPaths.includes(path) && !notes.has(path)) {
      notes.set(path, String(entry?.does ?? ''))
    }
  }
  // a file the first pass skipped still has to reach the grouping pass, so fall back to its path
  return changedPaths.map(path => ({ path, does: notes.get(path) ?? 'no description' }))
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

  const unassigned = changedPaths.filter(path => !claimed.has(path))
  if (unassigned.length > 0) {
    repaired.push({
      id: `g${repaired.length}-other`,
      title: otherChangesTitle,
      summary: 'Files the guide did not classify.',
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
    files,
  }
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

/** extractJsonObject picks the grouping out of a reply that reasons in prose before its JSON. */
function extractJsonObject(text: string): unknown {
  let fallback: unknown = null
  let withGroups: unknown = null
  for (const candidate of balancedObjects(text)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    // the reasoning can quote the schema, so the answer is the last object that actually carries groups
    if (Array.isArray((parsed as { groups?: unknown }).groups)) {
      withGroups = parsed
    }
    fallback ??= parsed
  }
  return withGroups ?? fallback
}

/** balancedObjects yields each top-level {...} span in text, skipping braces inside strings. */
function* balancedObjects(text: string): Generator<string> {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"' && depth > 0) {
      inString = !inString
      continue
    }
    if (inString) {
      continue
    }
    if (char === '{') {
      if (depth === 0) {
        start = i
      }
      depth++
    } else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        yield text.slice(start, i + 1)
      }
    }
  }
}

/** slug reduces a title to an id-safe fragment. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'group'
}

/** ClaudeRunner is the inference seam, mocked in tests and backed by `claude -p` in production. */
export interface ClaudeRunner {
  run(prompt: string, stdin: string, system: string): Promise<string>
}

/** FileNote is one file's description, the only thing the grouping pass sees. */
export interface FileNote {
  path: string
  does: string
}

/** RawNote is one unvalidated description from the first pass. */
interface RawNote {
  path?: unknown
  does?: unknown
}

/** RawGroup is one unvalidated group as the model returned it. */
export interface RawGroup {
  title?: unknown
  summary?: unknown
  files?: unknown
}

export const __test = { extractJsonObject, unwrapEnvelope, slug, describeSystemPrompt, groupSystemPrompt }

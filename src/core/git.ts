import { SystemExec, type Exec } from './exec.js'
import type { ChangedFile, FileStatus } from './types.js'

/** storeDir is the review store, excluded from every diff so a review never reviews itself. */
export const storeDir = '.guided-review'

/** defaultBranchCandidates are tried in order when origin/HEAD is absent. */
const defaultBranchCandidates = ['origin/main', 'origin/master', 'main', 'master']

/** renameDetection turns on git's similarity-based rename following. */
const renameDetection = '-M'

/** Git is every git side effect the extension performs, scoped to one repository root. */
export class Git {
  private root: string
  private exec: Exec
  private branchOverride: string

  constructor(root: string, exec: Exec = new SystemExec(root), branchOverride = '') {
    this.root = root
    this.exec = exec
    this.branchOverride = branchOverride
  }

  /** repoRoot is the absolute path this instance operates on. */
  get repoRoot(): string {
    return this.root
  }

  /** defaultBranch resolves the branch a feature branch is considered to fork from. */
  async defaultBranch(): Promise<string> {
    if (this.branchOverride) {
      return this.branchOverride
    }
    const symbolic = await this.tryGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    if (symbolic) {
      return symbolic.trim()
    }
    for (const candidate of defaultBranchCandidates) {
      if (await this.tryGit(['rev-parse', '--verify', '--quiet', candidate])) {
        return candidate
      }
    }
    throw new Error('could not determine a default branch; set guidedDiffs.defaultBranch')
  }

  /** mergeBase returns the common ancestor of two revisions. */
  async mergeBase(a: string, b: string): Promise<string> {
    const out = await this.git(['merge-base', a, b])
    return out.trim()
  }

  /** revParse resolves any revspec to a full sha, throwing when it does not exist. */
  async revParse(rev: string): Promise<string> {
    const out = await this.git(['rev-parse', '--verify', `${rev}^{commit}`])
    return out.trim()
  }

  /** currentBranch is the checked-out branch name, or an empty string when detached. */
  async currentBranch(): Promise<string> {
    const out = await this.tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    return out ? out.trim() : ''
  }

  /** gitCommonDir is the shared .git directory, which differs from .git in a worktree. */
  async gitCommonDir(): Promise<string> {
    const out = await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    return out.trim()
  }

  /** changedFiles lists every path that differs between two commits, with blobs and counts. */
  async changedFiles(base: string, head: string): Promise<ChangedFile[]> {
    // --abbrev=40 because raw output shortens blob shas, and anchors are keyed by full blob
    const raw = await this.git([
      'diff',
      '--raw',
      '--abbrev=40',
      '-z',
      renameDetection,
      base,
      head,
      '--',
      '.',
      `:(exclude)${storeDir}`,
    ])
    const stats = await this.numstat(base, head)
    return parseRawDiff(raw).map(entry => ({
      ...entry,
      additions: stats.get(entry.path)?.additions ?? 0,
      deletions: stats.get(entry.path)?.deletions ?? 0,
      binary: stats.get(entry.path)?.binary ?? false,
    }))
  }

  /** unifiedDiff is the full patch between two commits, excluding the review store. */
  unifiedDiff(base: string, head: string, contextLines = 3): Promise<string> {
    return this.git([
      'diff',
      renameDetection,
      `--unified=${contextLines}`,
      base,
      head,
      '--',
      '.',
      `:(exclude)${storeDir}`,
    ])
  }

  /** diffBlobs is the patch between two blobs, used to map thread anchors across commits. */
  async diffBlobs(oldBlob: string, newBlob: string): Promise<string> {
    return this.tryGit(['diff', '--unified=0', '--no-color', oldBlob, newBlob]).then(out => out ?? '')
  }

  /** blobText reads one blob's contents. */
  blobText(blob: string): Promise<string> {
    return this.git(['cat-file', 'blob', blob])
  }

  /** localBranches lists every local branch name, current branch first. */
  async localBranches(): Promise<string[]> {
    const out = await this.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    return out.split('\n').map(l => l.trim()).filter(Boolean)
  }

  /** recentCommits lists the newest commits reachable from HEAD. */
  async recentCommits(limit: number): Promise<CommitSummary[]> {
    const out = await this.git(['log', `-${limit}`, '--format=%H%x00%s%x00%an%x00%ar'])
    return out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [sha = '', subject = '', author = '', when = ''] = line.split('\0')
        return { sha, subject, author, when }
      })
  }

  /** git runs a git subcommand in the repository root. */
  private git(args: readonly string[]): Promise<string> {
    return this.exec.run('git', args)
  }

  /** tryGit runs a git subcommand, returning null instead of throwing when it fails. */
  private async tryGit(args: readonly string[]): Promise<string | null> {
    try {
      return await this.git(args)
    } catch {
      return null
    }
  }

  /** numstat collects per-path line counts and binary flags for a commit pair. */
  private async numstat(base: string, head: string): Promise<Map<string, NumStat>> {
    const out = await this.git(['diff', '--numstat', '-z', renameDetection, base, head, '--', '.', `:(exclude)${storeDir}`])
    return parseNumstat(out)
  }
}

/** parseRawDiff turns `git diff --raw -z` output into per-path blob and status records. */
function parseRawDiff(raw: string): RawEntry[] {
  const fields = raw.split('\0').filter(f => f.length > 0)
  const entries: RawEntry[] = []
  let i = 0
  while (i < fields.length) {
    const meta = fields[i]
    if (!meta || !meta.startsWith(':')) {
      i++
      continue
    }
    const parts = meta.slice(1).split(' ')
    const [oldMode = '', newMode = '', oldSha = '', newSha = '', statusCode = ''] = parts
    const isRename = statusCode.startsWith('R') || statusCode.startsWith('C')
    const first = fields[i + 1] ?? ''
    const second = isRename ? (fields[i + 2] ?? '') : ''
    i += isRename ? 3 : 2

    entries.push({
      path: isRename ? second : first,
      ...(isRename ? { oldPath: first } : {}),
      status: toFileStatus(statusCode),
      oldBlob: isNullSha(oldSha) ? null : oldSha,
      newBlob: isNullSha(newSha) ? null : newSha,
      oldMode,
      newMode,
    })
  }
  return entries
}

/** parseNumstat turns `git diff --numstat -z` output into per-path counts. */
function parseNumstat(out: string): Map<string, NumStat> {
  const stats = new Map<string, NumStat>()
  const fields = out.split('\0').filter(f => f.length > 0)
  let i = 0
  while (i < fields.length) {
    const record = fields[i] ?? ''
    const [addRaw = '', delRaw = '', inlinePath = ''] = record.split('\t')
    // a rename emits an empty trailing path, then old and new paths as separate fields
    if (inlinePath === '') {
      const newPath = fields[i + 2] ?? ''
      stats.set(newPath, toNumStat(addRaw, delRaw))
      i += 3
      continue
    }
    stats.set(inlinePath, toNumStat(addRaw, delRaw))
    i += 1
  }
  return stats
}

/** toNumStat reads one numstat pair, treating git's `-` markers as a binary file. */
function toNumStat(additions: string, deletions: string): NumStat {
  const binary = additions === '-' || deletions === '-'
  return {
    additions: binary ? 0 : Number(additions) || 0,
    deletions: binary ? 0 : Number(deletions) || 0,
    binary,
  }
}

/** toFileStatus maps a git raw status code to the domain status. */
function toFileStatus(code: string): FileStatus {
  switch (code.charAt(0)) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

/** isNullSha reports whether a raw-diff sha is git's all-zero placeholder. */
function isNullSha(sha: string): boolean {
  return /^0+$/.test(sha)
}

/** CommitSummary is one entry in the commit picker. */
export interface CommitSummary {
  sha: string
  subject: string
  author: string
  when: string
}

/** RawEntry is one parsed `git diff --raw` record before line counts are joined in. */
type RawEntry = Omit<ChangedFile, 'additions' | 'deletions' | 'binary'>

/** NumStat is the per-path line counts joined onto a raw entry. */
interface NumStat {
  additions: number
  deletions: number
  binary: boolean
}

export const __test = { parseRawDiff, parseNumstat, toFileStatus }

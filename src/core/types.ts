/** ReviewKind distinguishes a branch-tracking review from a frozen two-commit comparison. */
export type ReviewKind = 'branch' | 'range'

/** ThreadState is the lifecycle of a comment thread. */
export type ThreadState = 'open' | 'resolved'

/** AnchorSide is the side of the diff a line anchor refers to. */
export type AnchorSide = 'old' | 'new'

/** FileStatus is how a path changed between base and head. */
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** ChangedFile is one path in the diff, with the blobs on each side. */
export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileStatus
  oldBlob: string | null
  newBlob: string | null
  additions: number
  deletions: number
  binary: boolean
  oldMode?: string
  newMode?: string
}

/** LineAnchor pins a thread to one line of one blob, with enough context to relocate it. */
export interface LineAnchor {
  kind: 'line'
  path: string
  side: AnchorSide
  line: number
  endLine?: number
  blob: string
  text: string
  contextHash: string
}

/** GroupAnchor pins a thread to a guide chapter, falling back to the file set it covered. */
export interface GroupAnchor {
  kind: 'group'
  groupId: string
  files: string[]
}

/** Anchor is where a thread lives in the review. */
export type Anchor = LineAnchor | GroupAnchor

/** AnchorStatus reports whether an anchor still points at live code. */
export type AnchorStatus = 'current' | 'relocated' | 'outdated'

/** Comment is one message in a thread. */
export interface Comment {
  id: string
  author: 'human' | 'agent'
  body: string
  at: string
}

/** Thread is a comment conversation attached to an anchor. */
export interface Thread {
  id: string
  anchor: Anchor
  state: ThreadState
  comments: Comment[]
  createdAt: string
  /** resolvedLine is the anchor's current line after relocation, absent when outdated. */
  resolvedLine?: number
  status: AnchorStatus
}

/** GuideGroup is one chapter of the guided review. */
export interface GuideGroup {
  id: string
  title: string
  summary: string
  files: string[]
  /** repaired marks a group the validator synthesised rather than the model producing it. */
  repaired?: boolean
}

/** Guide is the generated narrative for one (base, head) pair. */
export interface Guide {
  baseSha: string
  headSha: string
  groups: GuideGroup[]
  generatedAt: string
}

/** ReviewRefs is the commit pair a review covers. */
export interface ReviewRefs {
  baseSha: string
  headSha: string
  baseLabel: string
  headLabel: string
}

/** ReviewState is the folded, renderable state of one review. */
export interface ReviewState {
  key: string
  kind: ReviewKind
  branch?: string
  refs: ReviewRefs
  threads: Thread[]
  guide?: Guide
  guideStale: boolean
  guideError?: string
  /** reviewedBlobs maps a path to the blob the reviewer last ticked off. */
  reviewedBlobs: Record<string, string>
}

/** CommitSummary is one entry in the commit picker. */
export interface CommitSummary {
  sha: string
  subject: string
  author: string
  when: string
}

/** BranchSummary is one row of the branch dropdown. */
export interface BranchSummary {
  name: string
  headSha: string
  when: string
  /** ahead is how many commits the branch carries beyond the default branch. */
  ahead: number
  isDefault: boolean
}

/** TimelineCommit is one row of a commit dropdown; afterFork decides its colour. */
export interface TimelineCommit extends CommitSummary {
  afterFork: boolean
}

/** Timeline is the single ancestry both commit dropdowns select from. */
export interface Timeline {
  branch: string
  /** forkedFrom names the branch this one grew out of, empty when the branch is itself the default. */
  forkedFrom: string
  forkSha: string
  commits: TimelineCommit[]
}

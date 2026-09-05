import type { Anchor, GuideGroup, ReviewKind } from './types.js'

/** schemaVersion is written on every review-created event so the fold can migrate later. */
export const schemaVersion = 1

/** ReviewEvent is one appended record in a review's log. */
export type ReviewEvent =
  | ReviewCreated
  | HeadMoved
  | ThreadOpened
  | CommentAdded
  | ThreadResolved
  | ThreadReopened
  | GuideGenerated
  | GuideFailed
  | FileViewed
  | FileUnviewed

/** parseEvent reads one log line, returning null for anything malformed. */
export function parseEvent(line: string): ReviewEvent | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isReviewEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** serializeEvent renders one event as a single log line. */
export function serializeEvent(event: ReviewEvent): string {
  return `${JSON.stringify(event)}\n`
}

/** isReviewEvent narrows unknown parsed JSON to a recognised event. */
function isReviewEvent(value: unknown): value is ReviewEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const type = (value as { t?: unknown }).t
  return typeof type === 'string' && knownTypes.has(type)
}

/** knownTypes is every event tag the fold understands. */
const knownTypes = new Set([
  'review.created',
  'review.head_moved',
  'thread.opened',
  'comment.added',
  'thread.resolved',
  'thread.reopened',
  'guide.generated',
  'guide.failed',
  'file.viewed',
  'file.unviewed',
])

/** ReviewCreated opens a review and pins its base. */
export interface ReviewCreated {
  t: 'review.created'
  v: number
  key: string
  kind: ReviewKind
  branch?: string
  baseSha: string
  headSha: string
  baseLabel: string
  headLabel: string
  at: string
}

/** HeadMoved records the review's head advancing to a new commit. */
export interface HeadMoved {
  t: 'review.head_moved'
  headSha: string
  headLabel: string
  at: string
}

/** ThreadOpened starts a comment thread at an anchor. */
export interface ThreadOpened {
  t: 'thread.opened'
  id: string
  anchor: Anchor
  at: string
}

/** CommentAdded appends one message to a thread. */
export interface CommentAdded {
  t: 'comment.added'
  id: string
  threadId: string
  author: 'human' | 'agent'
  body: string
  at: string
}

/** ThreadResolved closes a thread, hiding it from the agent. */
export interface ThreadResolved {
  t: 'thread.resolved'
  threadId: string
  at: string
}

/** ThreadReopened returns a resolved thread to the agent's view. */
export interface ThreadReopened {
  t: 'thread.reopened'
  threadId: string
  at: string
}

/** GuideGenerated stores a grouping for one commit pair. */
export interface GuideGenerated {
  t: 'guide.generated'
  baseSha: string
  headSha: string
  groups: GuideGroup[]
  at: string
}

/** FileViewed marks one blob of one file as reviewed, so a later edit un-marks it. */
export interface FileViewed {
  t: 'file.viewed'
  path: string
  blob: string
  at: string
}

/** FileUnviewed clears the reviewed mark on a file. */
export interface FileUnviewed {
  t: 'file.unviewed'
  path: string
  at: string
}

/** GuideFailed records why the last generation attempt did not produce a guide. */
export interface GuideFailed {
  t: 'guide.failed'
  message: string
  at: string
}

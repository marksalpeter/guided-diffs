import { describe, it, expect } from 'vitest'
import { isReviewed, reviewedCount } from './FileList.js'
import type { ChangedFile } from '../core/types.js'

const file = (path: string, newBlob: string | null): ChangedFile => ({
  path,
  status: 'modified',
  oldBlob: 'old',
  newBlob,
  additions: 1,
  deletions: 0,
  binary: false,
})

describe('isReviewed', () => {
  it('is true only when the tick matches the blob on screen', () => {
    expect(isReviewed('blob1', 'blob1')).toBe(true)
    expect(isReviewed('blob1', 'blob2')).toBe(false)
  })

  it('is false when the file was never ticked', () => {
    expect(isReviewed(undefined, 'blob1')).toBe(false)
  })

  it('treats a deleted file with a recorded tick as reviewed', () => {
    expect(isReviewed('', null)).toBe(true)
  })
})

describe('reviewedCount', () => {
  const files = [file('a.ts', 'blob-a'), file('b.ts', 'blob-b'), file('c.ts', 'blob-c')]

  it('counts only ticks made against the current blob', () => {
    expect(reviewedCount(['a.ts', 'b.ts', 'c.ts'], files, { 'a.ts': 'blob-a', 'b.ts': 'stale' })).toBe(1)
  })

  it('counts nothing when nothing is ticked', () => {
    expect(reviewedCount(['a.ts', 'b.ts'], files, {})).toBe(0)
  })

  it('counts every file in a fully reviewed section', () => {
    expect(reviewedCount(['a.ts', 'b.ts'], files, { 'a.ts': 'blob-a', 'b.ts': 'blob-b' })).toBe(2)
  })

  it('ignores ticks for paths outside the section', () => {
    expect(reviewedCount(['a.ts'], files, { 'a.ts': 'blob-a', 'b.ts': 'blob-b' })).toBe(1)
  })
})

import { describe, it, expect } from 'vitest'
import { contextHash, mapLineThroughPatch, relocate, __test } from './anchors.js'
import type { LineAnchor } from './types.js'

const anchorAt = (line: number, text: string, blob = 'old'): LineAnchor => ({
  kind: 'line',
  path: 'a.ts',
  side: 'new',
  line,
  blob,
  text,
  contextHash: contextHash(['x', text, 'y']),
})

describe('mapLineThroughPatch', () => {
  it('leaves a line before every hunk untouched', () => {
    const patch = '@@ -50,1 +50,2 @@\n-old\n+new\n+extra\n'
    expect(mapLineThroughPatch(10, patch)).toBe(10)
  })

  it('shifts a line below an insertion by the inserted count', () => {
    const patch = '@@ -5,0 +6,3 @@\n+a\n+b\n+c\n'
    expect(mapLineThroughPatch(10, patch)).toBe(13)
  })

  it('shifts a line below a deletion back by the deleted count', () => {
    const patch = '@@ -5,2 +5,0 @@\n-a\n-b\n'
    expect(mapLineThroughPatch(10, patch)).toBe(8)
  })

  it('accumulates offsets across several hunks', () => {
    const patch = '@@ -5,0 +6,2 @@\n+a\n+b\n@@ -20,3 +22,1 @@\n-x\n-y\n-z\n+q\n'
    expect(mapLineThroughPatch(30, patch)).toBe(30)
  })

  it('returns null when the line itself was changed', () => {
    const patch = '@@ -10,2 +10,2 @@\n-a\n-b\n+c\n+d\n'
    expect(mapLineThroughPatch(11, patch)).toBeNull()
  })

  it('treats a zero-length old range as covering nothing', () => {
    const patch = '@@ -10,0 +11,1 @@\n+inserted\n'
    expect(mapLineThroughPatch(10, patch)).toBe(10)
  })

  it('handles headers that omit the count', () => {
    const patch = '@@ -5 +5,3 @@\n-a\n+a\n+b\n+c\n'
    expect(mapLineThroughPatch(20, patch)).toBe(22)
  })
})

describe('relocate', () => {
  it('reports current when the blob has not changed', () => {
    const anchor = anchorAt(4, 'const b = 2')
    expect(relocate(anchor, 'old', '', '')).toEqual({ status: 'current', line: 4 })
  })

  it('relocates exactly through the patch when the line survived', () => {
    const anchor = anchorAt(10, 'const b = 2')
    const patch = '@@ -2,0 +3,2 @@\n+a\n+b\n'
    expect(relocate(anchor, 'new', patch, '')).toEqual({ status: 'relocated', line: 12 })
  })

  it('falls back to a unique content match when the line was inside a hunk', () => {
    const anchor = anchorAt(2, 'const target = 1')
    const patch = '@@ -1,3 +1,4 @@\n-a\n-const target = 1\n-c\n+a\n+b\n+const target = 1\n+c\n'
    const newSource = 'a\nb\nconst target = 1\nc\n'
    expect(relocate(anchor, 'new', patch, newSource)).toEqual({ status: 'relocated', line: 3 })
  })

  it('marks outdated when the content no longer exists', () => {
    const anchor = anchorAt(2, 'const gone = 1')
    const patch = '@@ -1,3 +1,2 @@\n-a\n-const gone = 1\n-c\n+a\n+c\n'
    const newSource = 'a\nc\n'
    expect(relocate(anchor, 'new', patch, newSource).status).toBe('outdated')
  })

  it('picks the nearest match when the content is ambiguous', () => {
    const anchor = anchorAt(9, 'return null')
    const patch = '@@ -1,20 +1,20 @@\n-x\n+y\n'
    const newSource = ['a', 'return null', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'return null', 'i'].join('\n')
    expect(relocate(anchor, 'new', patch, newSource)).toEqual({ status: 'relocated', line: 10 })
  })

  it('ignores leading and trailing whitespace when matching content', () => {
    const anchor = anchorAt(2, '  const x = 1')
    const patch = '@@ -1,2 +1,2 @@\n-a\n-  const x = 1\n+a\n+    const x = 1\n'
    expect(relocate(anchor, 'new', patch, 'a\n    const x = 1\n')).toEqual({ status: 'relocated', line: 2 })
  })
})

describe('contextHash', () => {
  it('is stable for the same lines and differs for different ones', () => {
    expect(contextHash(['a', 'b', 'c'])).toBe(contextHash(['a', 'b', 'c']))
    expect(contextHash(['a', 'b', 'c'])).not.toBe(contextHash(['a', 'b', 'd']))
  })
})

describe('parseHunkHeaders', () => {
  it('reads starts and counts, defaulting an omitted count to one', () => {
    const headers = __test.parseHunkHeaders('@@ -5 +5,3 @@\n@@ -20,0 +23,1 @@\n')
    expect(headers).toEqual([
      { oldStart: 5, oldCount: 1, newStart: 5, newCount: 3 },
      { oldStart: 20, oldCount: 0, newStart: 23, newCount: 1 },
    ])
  })
})

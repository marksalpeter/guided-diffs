import { createHash } from 'node:crypto'
import type { AnchorStatus, LineAnchor } from './types.js'

/** hunkHeader matches a unified-diff hunk header, whose counts may be omitted when one. */
const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** contextLines is how many lines around an anchor feed its context hash. */
export const contextLines = 3

/** relocate re-pins an anchor against the current blob, exactly when possible. */
export function relocate(anchor: LineAnchor, currentBlob: string, patch: string, currentSource: string): Relocation {
  if (anchor.blob === currentBlob) {
    return { status: 'current', line: anchor.line }
  }

  const mapped = mapLineThroughPatch(anchor.line, patch)
  if (mapped !== null) {
    return { status: 'relocated', line: mapped }
  }

  const matched = findByContent(anchor.text, anchor.line, currentSource)
  return matched === null ? { status: 'outdated' } : { status: 'relocated', line: matched }
}

/** mapLineThroughPatch shifts a line number by hunk offsets, or returns null if the line changed. */
export function mapLineThroughPatch(line: number, patch: string): number | null {
  let offset = 0
  for (const hunk of parseHunkHeaders(patch)) {
    // a zero-length old range inserts *after* oldStart, so oldStart itself is unaffected
    const firstAffected = hunk.oldCount > 0 ? hunk.oldStart : hunk.oldStart + 1
    if (line < firstAffected) {
      break
    }
    if (hunk.oldCount > 0 && line < hunk.oldStart + hunk.oldCount) {
      return null
    }
    offset += hunk.newCount - hunk.oldCount
  }
  return line + offset
}

/** contextHash fingerprints the lines surrounding an anchor so a move can be recognised. */
export function contextHash(lines: readonly string[]): string {
  return createHash('sha1').update(lines.map(l => l.trim()).join('\n')).digest('hex').slice(0, 16)
}

/** anchorContext collects the lines around a one-based line number for hashing. */
export function anchorContext(source: string, line: number): string[] {
  const lines = source.split('\n')
  const start = Math.max(0, line - 1 - Math.floor(contextLines / 2))
  return lines.slice(start, start + contextLines)
}

/** findByContent locates the anchor's text in the current source, preferring the nearest match. */
function findByContent(text: string, originalLine: number, source: string): number | null {
  const needle = text.trim()
  if (!needle) {
    return null
  }
  const matches: number[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === needle) {
      matches.push(i + 1)
    }
  }
  if (matches.length === 0) {
    return null
  }
  return matches.reduce((best, candidate) =>
    Math.abs(candidate - originalLine) < Math.abs(best - originalLine) ? candidate : best,
  )
}

/** parseHunkHeaders reads every hunk range from a unified diff, ignoring its body. */
function parseHunkHeaders(patch: string): HunkRange[] {
  const ranges: HunkRange[] = []
  for (const line of patch.split('\n')) {
    const match = hunkHeader.exec(line)
    if (!match) {
      continue
    }
    ranges.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    })
  }
  return ranges
}

/** Relocation is the outcome of re-pinning an anchor, carrying a line unless outdated. */
export type Relocation = { status: Exclude<AnchorStatus, 'outdated'>; line: number } | { status: 'outdated' }

/** HunkRange is one hunk's old and new line ranges. */
interface HunkRange {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

export const __test = { parseHunkHeaders, findByContent }

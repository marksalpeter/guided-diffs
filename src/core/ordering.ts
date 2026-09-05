import type { Guide } from './types.js'

/** orderPaths sorts diff paths into the guide's reading order, keeping unguided paths last. */
export function orderPaths(paths: readonly string[], guide: Guide | undefined): string[] {
  if (!guide) {
    return [...paths]
  }
  const rank = new Map<string, number>()
  let next = 0
  for (const group of guide.groups) {
    for (const path of group.files) {
      if (!rank.has(path)) {
        rank.set(path, next++)
      }
    }
  }
  return [...paths].sort((a, b) => rankOf(rank, a, paths) - rankOf(rank, b, paths))
}

/** rankOf places a guided path by chapter order and an unguided one after every guided path. */
function rankOf(rank: Map<string, number>, path: string, paths: readonly string[]): number {
  const guided = rank.get(path)
  return guided ?? rank.size + paths.indexOf(path)
}

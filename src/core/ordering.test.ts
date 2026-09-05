import { describe, it, expect } from 'vitest'
import { orderPaths } from './ordering.js'
import type { Guide } from './types.js'

const guide = (groups: Guide['groups']): Guide => ({ baseSha: 'b', headSha: 'h', groups, generatedAt: 'a' })

describe('orderPaths', () => {
  it('keeps git order when there is no guide', () => {
    expect(orderPaths(['b.ts', 'a.ts'], undefined)).toEqual(['b.ts', 'a.ts'])
  })

  it('reorders files into the guide reading order', () => {
    const ordered = orderPaths(
      ['glue.ts', 'core.ts', 'fallout.ts'],
      guide([
        { id: 'g1', title: 'Core', summary: '', files: ['core.ts'] },
        { id: 'g2', title: 'Fallout', summary: '', files: ['fallout.ts'] },
        { id: 'g3', title: 'Glue', summary: '', files: ['glue.ts'] },
      ]),
    )
    expect(ordered).toEqual(['core.ts', 'fallout.ts', 'glue.ts'])
  })

  it('puts paths the guide never mentioned after every guided path', () => {
    const ordered = orderPaths(
      ['stray.ts', 'core.ts'],
      guide([{ id: 'g1', title: 'Core', summary: '', files: ['core.ts'] }]),
    )
    expect(ordered).toEqual(['core.ts', 'stray.ts'])
  })

  it('ignores guide paths that are not in the diff', () => {
    const ordered = orderPaths(['a.ts'], guide([{ id: 'g1', title: 'C', summary: '', files: ['ghost.ts', 'a.ts'] }]))
    expect(ordered).toEqual(['a.ts'])
  })

  it('does not lose or duplicate any path', () => {
    const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    const ordered = orderPaths(
      paths,
      guide([
        { id: 'g1', title: 'One', summary: '', files: ['c.ts'] },
        { id: 'g2', title: 'Two', summary: '', files: ['a.ts'] },
      ]),
    )
    expect(ordered.slice().sort()).toEqual(paths.slice().sort())
    expect(new Set(ordered).size).toBe(paths.length)
  })
})

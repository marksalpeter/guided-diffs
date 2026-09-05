import { describe, it, expect } from 'vitest'
import { GuideGenerator, buildGuidePrompt, parseGuideResponse, repairGroups } from './guide.js'
import type { ChangedFile } from './types.js'

const file = (path: string): ChangedFile => ({
  path,
  status: 'modified',
  oldBlob: 'a',
  newBlob: 'b',
  additions: 1,
  deletions: 1,
  binary: false,
})

describe('parseGuideResponse', () => {
  it('reads groups out of the Claude Code json envelope', () => {
    const envelope = JSON.stringify({
      type: 'result',
      result: '{"groups":[{"title":"Core","summary":"s","kind":"core","files":["a.ts"]}]}',
    })
    expect(parseGuideResponse(envelope)?.[0]?.title).toBe('Core')
  })

  it('tolerates a fenced code block around the json', () => {
    const envelope = JSON.stringify({
      result: '```json\n{"groups":[{"title":"Core","summary":"s","kind":"core","files":["a.ts"]}]}\n```',
    })
    expect(parseGuideResponse(envelope)?.[0]?.files).toEqual(['a.ts'])
  })

  it('tolerates prose surrounding the json', () => {
    const envelope = JSON.stringify({
      result: 'Here you go:\n{"groups":[{"title":"C","summary":"s","kind":"core","files":["a.ts"]}]}\nHope that helps.',
    })
    expect(parseGuideResponse(envelope)?.[0]?.title).toBe('C')
  })

  it('accepts a bare json payload with no envelope', () => {
    expect(parseGuideResponse('{"groups":[{"title":"C","summary":"s","kind":"core","files":[]}]}')?.length).toBe(1)
  })

  it('returns null when there is no json at all', () => {
    expect(parseGuideResponse('total failure')).toBeNull()
  })
})

describe('repairGroups', () => {
  const paths = ['a.ts', 'b.ts', 'c.ts']

  it('keeps a well-formed grouping untouched', () => {
    const groups = repairGroups(
      [
        { title: 'Core', summary: 's1', kind: 'core', files: ['a.ts', 'b.ts'] },
        { title: 'Glue', summary: 's2', kind: 'auxiliary', files: ['c.ts'] },
      ],
      paths,
    )
    expect(groups.map(g => g.title)).toEqual(['Core', 'Glue'])
    expect(groups.some(g => g.repaired)).toBe(false)
  })

  it('drops paths the model invented', () => {
    const groups = repairGroups([{ title: 'Core', summary: 's', kind: 'core', files: ['a.ts', 'ghost.ts'] }], ['a.ts'])
    expect(groups[0]?.files).toEqual(['a.ts'])
  })

  it('sweeps unassigned files into a visible trailing group', () => {
    const groups = repairGroups([{ title: 'Core', summary: 's', kind: 'core', files: ['a.ts'] }], paths)
    const last = groups[groups.length - 1]
    expect(last?.title).toBe('Other changes')
    expect(last?.kind).toBe('auxiliary')
    expect(last?.repaired).toBe(true)
    expect(last?.files).toEqual(['b.ts', 'c.ts'])
  })

  it('assigns a duplicated file to its first group only', () => {
    const groups = repairGroups(
      [
        { title: 'One', summary: 's', kind: 'core', files: ['a.ts'] },
        { title: 'Two', summary: 's', kind: 'consequence', files: ['a.ts', 'b.ts'] },
      ],
      ['a.ts', 'b.ts'],
    )
    expect(groups[0]?.files).toEqual(['a.ts'])
    expect(groups[1]?.files).toEqual(['b.ts'])
  })

  it('guarantees every changed file appears exactly once', () => {
    const groups = repairGroups(
      [
        { title: 'One', summary: 's', kind: 'core', files: ['a.ts', 'a.ts'] },
        { title: 'Two', summary: 's', kind: 'core', files: ['ghost.ts'] },
      ],
      paths,
    )
    const assigned = groups.flatMap(g => g.files)
    expect(assigned.slice().sort()).toEqual(paths.slice().sort())
    expect(new Set(assigned).size).toBe(assigned.length)
  })

  it('drops groups left empty after repair', () => {
    const groups = repairGroups([{ title: 'Ghosts', summary: 's', kind: 'core', files: ['ghost.ts'] }], ['a.ts'])
    expect(groups.map(g => g.title)).toEqual(['Other changes'])
  })

  it('orders chapters core, then consequence, then auxiliary', () => {
    const groups = repairGroups(
      [
        { title: 'Glue', summary: 's', kind: 'auxiliary', files: ['c.ts'] },
        { title: 'Fallout', summary: 's', kind: 'consequence', files: ['b.ts'] },
        { title: 'Core', summary: 's', kind: 'core', files: ['a.ts'] },
      ],
      paths,
    )
    expect(groups.map(g => g.kind)).toEqual(['core', 'consequence', 'auxiliary'])
  })

  it('coerces an unrecognised kind to auxiliary', () => {
    const groups = repairGroups([{ title: 'X', summary: 's', kind: 'nonsense', files: ['a.ts'] }], ['a.ts'])
    expect(groups[0]?.kind).toBe('auxiliary')
  })

  it('gives every group a stable unique id', () => {
    const groups = repairGroups(
      [
        { title: 'One', summary: 's', kind: 'core', files: ['a.ts'] },
        { title: 'Two', summary: 's', kind: 'core', files: ['b.ts'] },
      ],
      ['a.ts', 'b.ts'],
    )
    expect(new Set(groups.map(g => g.id)).size).toBe(2)
  })
})

describe('buildGuidePrompt', () => {
  it('lists every changed file with its line counts', () => {
    const prompt = buildGuidePrompt([file('a.ts'), file('b.ts')])
    expect(prompt).toContain('a.ts')
    expect(prompt).toContain('b.ts')
  })
})

describe('GuideGenerator', () => {
  it('returns repaired groups from the runner output', async () => {
    const runner = {
      run: async () =>
        JSON.stringify({ result: '{"groups":[{"title":"Core","summary":"s","kind":"core","files":["a.ts"]}]}' }),
    }
    const groups = await new GuideGenerator(runner).generate([file('a.ts')], 'diff text')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.title).toBe('Core')
  })

  it('surfaces an unparseable response as an error rather than an empty guide', async () => {
    const runner = { run: async () => 'not json' }
    await expect(new GuideGenerator(runner).generate([file('a.ts')], 'diff')).rejects.toThrow(/could not be parsed/i)
  })

  it('propagates a runner failure unchanged', async () => {
    const runner = {
      run: async () => {
        throw new Error('claude not found')
      },
    }
    await expect(new GuideGenerator(runner).generate([file('a.ts')], 'diff')).rejects.toThrow('claude not found')
  })

  it('sends the whole diff without truncation', async () => {
    const diff = 'x'.repeat(500_000)
    let received = ''
    const runner = {
      run: async (_prompt: string, stdin: string) => {
        received = stdin
        return JSON.stringify({ result: '{"groups":[]}' })
      },
    }
    await new GuideGenerator(runner).generate([file('a.ts')], diff)
    expect(received).toContain(diff)
  })
})

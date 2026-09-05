import { describe, it, expect } from 'vitest'
import { languageForPath, loadRefractor, plaintext, __test, type HastNode } from './highlight.js'

/** textOf concatenates every text node, which must reproduce the input exactly. */
function textOf(nodes: readonly HastNode[]): string {
  return nodes
    .map(node => (node.type === 'text' ? (node.value ?? '') : textOf(node.children ?? [])))
    .join('')
}

describe('languageForPath', () => {
  it('maps the common extensions to their grammar', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('src/a.tsx')).toBe('tsx')
    expect(languageForPath('a.mjs')).toBe('javascript')
    expect(languageForPath('package.json')).toBe('json')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('main.rs')).toBe('rust')
    expect(languageForPath('main.go')).toBe('go')
    expect(languageForPath('Main.java')).toBe('java')
    expect(languageForPath('app.kt')).toBe('kotlin')
    expect(languageForPath('run.sh')).toBe('shellscript')
    expect(languageForPath('index.php')).toBe('php')
    expect(languageForPath('script.py')).toBe('python')
  })

  it('maps the config formats a real diff is full of', () => {
    expect(languageForPath('.github/workflows/ci.yml')).toBe('yaml')
    expect(languageForPath('Cargo.toml')).toBe('toml')
    expect(languageForPath('main.tf')).toBe('hcl')
    expect(languageForPath('schema.sql')).toBe('sql')
    expect(languageForPath('api.proto')).toBe('proto')
    expect(languageForPath('setup.cfg')).toBe('ini')
  })

  it('recognises files whose name carries the language, not the extension', () => {
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('build/Makefile')).toBe('make')
    expect(languageForPath('Gemfile')).toBe('ruby')
  })

  it('treats C and C++ headers by their own extension', () => {
    expect(languageForPath('a.c')).toBe('c')
    expect(languageForPath('a.h')).toBe('c')
    expect(languageForPath('a.cpp')).toBe('cpp')
    expect(languageForPath('a.hpp')).toBe('cpp')
  })

  it('falls back to plaintext for anything unmapped', () => {
    expect(languageForPath('notes.xyz')).toBe(plaintext)
    expect(languageForPath('LICENSE')).toBe(plaintext)
    expect(languageForPath('noextension')).toBe(plaintext)
    expect(languageForPath('')).toBe(plaintext)
  })

  it('only maps extensions to grammars it can actually load', () => {
    for (const [extension, language] of Object.entries(__test.extensionLanguages)) {
      expect(__test.grammarLoaders[language], `${extension} -> ${language}`).toBeDefined()
    }
    for (const [name, language] of Object.entries(__test.filenameLanguages)) {
      expect(__test.grammarLoaders[language], `${name} -> ${language}`).toBeDefined()
    }
  })
})

describe('loadRefractor', () => {
  it('loads only the grammars the given paths need', async () => {
    const shim = await loadRefractor(['src/a.ts'], 'dark-plus')
    expect(shim.highlight('const a = 1', 'typescript').some(n => n.properties?.style)).toBe(true)
    // never asked for, so it must not silently highlight
    expect(shim.highlight('fn main() {}', 'rust')).toEqual([{ type: 'text', value: 'fn main() {}' }])
  })

  it('loads a second review’s languages on top of the first', async () => {
    await loadRefractor(['src/a.ts'], 'dark-plus')
    const shim = await loadRefractor(['main.rs', 'main.go'], 'dark-plus')
    expect(shim.highlight('fn main() {}', 'rust').some(n => n.properties?.style)).toBe(true)
    expect(shim.highlight('func main() {}', 'go').some(n => n.properties?.style)).toBe(true)
    expect(shim.highlight('const a = 1', 'typescript').some(n => n.properties?.style)).toBe(true)
  })

  it('never loses or reorders source text', async () => {
    const shim = await loadRefractor(['a.ts'], 'dark-plus')
    const source = 'const a = 1\nfunction b(): void {}\n\nexport default b'
    expect(textOf(shim.highlight(source, 'typescript'))).toBe(source)
  })

  it('preserves trailing newlines and indentation exactly', async () => {
    const shim = await loadRefractor(['a.ts'], 'dark-plus')
    const source = 'function a() {\n    return {\n        b: 1,\n    }\n}\n'
    expect(textOf(shim.highlight(source, 'typescript'))).toBe(source)
  })

  it('separates lines with a newline text node rather than a wrapper element', async () => {
    const shim = await loadRefractor(['a.ts'], 'dark-plus')
    const nodes = shim.highlight('const a = 1\nconst b = 2', 'typescript')
    expect(nodes.some(node => node.type === 'text' && node.value === '\n')).toBe(true)
    expect(nodes.some(node => node.properties?.className === 'line')).toBe(false)
  })

  it('tokenises a mixed-language review', async () => {
    const shim = await loadRefractor(['app.py', 'Dockerfile', 'ci.yml'], 'dark-plus')
    for (const [source, language] of [
      ['def main():\n    return 1', 'python'],
      ['FROM node:22\nRUN npm ci', 'dockerfile'],
      ['on:\n  push:\n    branches: [main]', 'yaml'],
    ] as const) {
      expect(textOf(shim.highlight(source, language))).toBe(source)
      expect(shim.highlight(source, language).some(n => n.properties?.style)).toBe(true)
    }
  })

  it('handles a review of only unmapped files without loading anything', async () => {
    const shim = await loadRefractor(['LICENSE', 'notes.xyz'], 'dark-plus')
    expect(shim.highlight('anything', plaintext)).toEqual([{ type: 'text', value: 'anything' }])
  })

  it('handles an empty source without throwing', async () => {
    const shim = await loadRefractor(['a.ts'], 'dark-plus')
    expect(textOf(shim.highlight('', 'typescript'))).toBe('')
  })
})

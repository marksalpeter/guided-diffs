import { describe, it, expect } from 'vitest'
import { createRefractorShim, languageForPath, type HastNode } from './highlight.js'

/** textOf concatenates every text node, which must reproduce the input exactly. */
function textOf(nodes: readonly HastNode[]): string {
  return nodes
    .map(node => (node.type === 'text' ? (node.value ?? '') : textOf(node.children ?? [])))
    .join('')
}

describe('languageForPath', () => {
  it('maps bundled extensions to their grammar', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('src/a.tsx')).toBe('tsx')
    expect(languageForPath('a.mjs')).toBe('javascript')
    expect(languageForPath('package.json')).toBe('json')
    expect(languageForPath('README.md')).toBe('markdown')
  })

  it('falls back to plaintext for anything not bundled', () => {
    expect(languageForPath('main.rs')).toBe('plaintext')
    expect(languageForPath('Makefile')).toBe('plaintext')
    expect(languageForPath('noextension')).toBe('plaintext')
  })
})

describe('createRefractorShim', () => {
  const shim = createRefractorShim('dark-plus')

  it('never loses or reorders source text', () => {
    const source = 'const a = 1\nfunction b(): void {}\n\nexport default b'
    expect(textOf(shim.highlight(source, 'typescript'))).toBe(source)
  })

  it('preserves a trailing newline', () => {
    const source = 'const a = 1\n'
    expect(textOf(shim.highlight(source, 'typescript'))).toBe(source)
  })

  it('preserves indentation exactly', () => {
    const source = 'function a() {\n    return {\n        b: 1,\n    }\n}'
    expect(textOf(shim.highlight(source, 'typescript'))).toBe(source)
  })

  it('emits inline styles that the token renderer can apply', () => {
    const nodes = shim.highlight('const a = 1', 'typescript')
    const styled = nodes.filter(node => node.properties?.style)
    expect(styled.length).toBeGreaterThan(0)
    expect(styled[0]?.properties?.style).toMatch(/color:/)
  })

  it('separates lines with a newline text node rather than a wrapper element', () => {
    const nodes = shim.highlight('const a = 1\nconst b = 2', 'typescript')
    expect(nodes.some(node => node.type === 'text' && node.value === '\n')).toBe(true)
    expect(nodes.some(node => node.tagName === 'span' && node.properties?.className === 'line')).toBe(false)
  })

  it('returns a single text node for a language it does not bundle', () => {
    const nodes = shim.highlight('fn main() {}', 'rust')
    expect(nodes).toEqual([{ type: 'text', value: 'fn main() {}' }])
  })

  it('tokenises tsx, which is where a regex highlighter would fall down', () => {
    const source = 'const El = <div className="x">{a as B<C>}</div>'
    const nodes = shim.highlight(source, 'tsx')
    expect(textOf(nodes)).toBe(source)
    expect(nodes.filter(node => node.properties?.style).length).toBeGreaterThan(3)
  })

  it('handles an empty source without throwing', () => {
    expect(textOf(shim.highlight('', 'typescript'))).toBe('')
  })
})

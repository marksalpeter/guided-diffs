import { describe, it, expect } from 'vitest'
import { classNameOf, markClassName, styleOf } from './tokens.js'

describe('styleOf', () => {
  it('parses the inline style Shiki emits', () => {
    expect(styleOf({ type: 'element', properties: { style: 'color:#569CD6' } })).toEqual({ color: '#569CD6' })
  })

  it('camel-cases hyphenated properties', () => {
    expect(styleOf({ type: 'element', properties: { style: 'font-style:italic;font-weight:bold' } })).toEqual({
      fontStyle: 'italic',
      fontWeight: 'bold',
    })
  })

  it('keeps colons inside a value', () => {
    const style = styleOf({ type: 'element', properties: { style: 'background:url(a:b)' } })
    expect(style).toEqual({ background: 'url(a:b)' })
  })

  it('tolerates trailing semicolons and stray whitespace', () => {
    expect(styleOf({ type: 'element', properties: { style: ' color : #fff ; ' } })).toEqual({ color: '#fff' })
  })

  it('returns undefined when there is nothing to apply', () => {
    expect(styleOf({ type: 'element' })).toBeUndefined()
    expect(styleOf({ type: 'element', properties: {} })).toBeUndefined()
    expect(styleOf({ type: 'element', properties: { style: '' } })).toBeUndefined()
    expect(styleOf({ type: 'element', properties: { style: ';;' } })).toBeUndefined()
    expect(styleOf({ type: 'element', properties: { style: 42 } })).toBeUndefined()
  })
})

describe('markClassName', () => {
  it('names the edit wrapper, which is what makes word-level marks visible', () => {
    expect(markClassName({ type: 'edit' })).toBe('diff-code-edit')
  })

  it('names a mark wrapper by its mark type', () => {
    expect(markClassName({ type: 'mark', markType: 'search' })).toBe('diff-code-mark diff-code-mark-search')
  })

  it('leaves ordinary syntax tokens to their own class', () => {
    expect(markClassName({ type: 'element' })).toBeUndefined()
    expect(markClassName({ type: 'text' })).toBeUndefined()
  })
})

describe('classNameOf', () => {
  it('reads a string class', () => {
    expect(classNameOf({ type: 'element', properties: { className: 'token' } })).toBe('token')
  })

  it('joins an array class', () => {
    expect(classNameOf({ type: 'element', properties: { className: ['a', 'b'] } })).toBe('a b')
  })

  it('returns undefined when absent', () => {
    expect(classNameOf({ type: 'element' })).toBeUndefined()
  })
})

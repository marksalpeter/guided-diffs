import { createHighlighterCoreSync, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import lightPlus from 'shiki/themes/light-plus.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langTsx from 'shiki/langs/tsx.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langJsx from 'shiki/langs/jsx.mjs'
import langJson from 'shiki/langs/json.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'

/** supportedLanguages is the deliberately small grammar set bundled into the webview. */
const supportedLanguages = new Set(['typescript', 'tsx', 'javascript', 'jsx', 'json', 'markdown'])

/** extensionLanguages maps a file extension to one of the bundled grammars. */
const extensionLanguages: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
}

/** createRefractorShim adapts Shiki to the refractor interface react-diff-view expects. */
export function createRefractorShim(theme: 'dark-plus' | 'light-plus'): RefractorLike {
  const highlighter = getHighlighter()
  return {
    highlight(value: string, language: string): HastNode[] {
      if (!supportedLanguages.has(language)) {
        return [{ type: 'text', value }]
      }
      const root = highlighter.codeToHast(value, { lang: language, theme }) as HastRoot
      return flattenLines(root)
    },
  }
}

/** languageForPath picks a bundled grammar for a path, or plaintext when none fits. */
export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return extensionLanguages[extension] ?? 'plaintext'
}

/** activeTheme reads the theme VS Code stamped on the document body. */
export function activeTheme(): 'dark-plus' | 'light-plus' {
  return document.body.classList.contains('vscode-light') ? 'light-plus' : 'dark-plus'
}

/** flattenLines unwraps Shiki's pre > code > span.line tree into refractor's flat node list. */
function flattenLines(root: HastRoot): HastNode[] {
  const code = findElement(findElement(root, 'pre'), 'code')
  if (!code?.children) {
    return []
  }
  const flat: HastNode[] = []
  const lines = code.children.filter(child => child.type === 'element')
  lines.forEach((line, index) => {
    if (index > 0) {
      flat.push({ type: 'text', value: '\n' })
    }
    flat.push(...(line.children ?? []))
  })
  return flat
}

/** findElement returns the first child element with the given tag name. */
function findElement(node: HastNode | undefined, tagName: string): HastNode | undefined {
  return node?.children?.find(child => child.type === 'element' && child.tagName === tagName)
}

/** getHighlighter builds the synchronous highlighter once per webview. */
function getHighlighter(): HighlighterCore {
  cachedHighlighter ??= createHighlighterCoreSync({
    themes: [darkPlus, lightPlus],
    langs: [langTypescript, langTsx, langJavascript, langJsx, langJson, langMarkdown],
    engine: createJavaScriptRegexEngine(),
  })
  return cachedHighlighter
}

/** cachedHighlighter holds the single synchronous highlighter instance. */
let cachedHighlighter: HighlighterCore | undefined

/** RefractorLike is the narrow surface react-diff-view calls for syntax highlighting. */
export interface RefractorLike {
  highlight(value: string, language: string): HastNode[]
}

/** HastNode is one node of the syntax tree, carrying Shiki's inline style properties. */
export interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { style?: string; className?: string | string[] }
  children?: HastNode[]
}

/** HastRoot is the document Shiki returns from codeToHast. */
interface HastRoot extends HastNode {
  type: 'root'
}

import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import darkPlus from 'shiki/themes/dark-plus.mjs'
import lightPlus from 'shiki/themes/light-plus.mjs'

/** grammarLoaders imports one grammar on demand; each entry is its own bundle chunk. */
const grammarLoaders: Record<string, GrammarLoader> = {
  bash: () => import('shiki/langs/shellscript.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  clojure: () => import('shiki/langs/clojure.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  erlang: () => import('shiki/langs/erlang.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  proto: () => import('shiki/langs/proto.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
}

/** extensionLanguages maps a file extension to the grammar that renders it. */
const extensionLanguages: Record<string, string> = {
  bash: 'shellscript', sh: 'shellscript', zsh: 'shellscript', fish: 'shellscript',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  dart: 'dart',
  diff: 'diff', patch: 'diff',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hrl: 'erlang',
  go: 'go',
  graphql: 'graphql', gql: 'graphql',
  gradle: 'groovy', groovy: 'groovy',
  hs: 'haskell',
  hcl: 'hcl', tf: 'hcl', tfvars: 'hcl',
  htm: 'html', html: 'html',
  cfg: 'ini', conf: 'ini', ini: 'ini', properties: 'ini',
  java: 'java',
  cjs: 'javascript', js: 'javascript', mjs: 'javascript',
  json: 'json', json5: 'json', jsonc: 'jsonc',
  jsx: 'jsx',
  kt: 'kotlin', kts: 'kotlin',
  lua: 'lua',
  markdown: 'markdown', md: 'markdown', mdx: 'markdown',
  m: 'objective-c', mm: 'objective-c',
  pl: 'perl', pm: 'perl',
  php: 'php',
  ps1: 'powershell', psm1: 'powershell',
  proto: 'proto',
  py: 'python', pyi: 'python',
  r: 'r',
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
  rs: 'rust',
  sc: 'scala', scala: 'scala',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  cts: 'typescript', mts: 'typescript', ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  svg: 'xml', xml: 'xml', xsd: 'xml',
  yaml: 'yaml', yml: 'yaml',
  zig: 'zig',
}

/** filenameLanguages maps whole filenames that carry no useful extension. */
const filenameLanguages: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  'nginx.conf': 'nginx',
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
}

/** plaintext is the language used when nothing else fits; it is never highlighted. */
export const plaintext = 'plaintext'

/** loadRefractor loads only the grammars these paths need, then returns a synchronous shim. */
export async function loadRefractor(paths: readonly string[], theme: ThemeName): Promise<RefractorLike> {
  const languages = [...new Set(paths.map(languageForPath))].filter(language => language !== plaintext)
  const highlighter = await ensureLanguages(languages)
  return {
    highlight(value: string, language: string): HastNode[] {
      if (!highlighter.getLoadedLanguages().includes(language)) {
        return [{ type: 'text', value }]
      }
      return flattenLines(highlighter.codeToHast(value, { lang: language, theme }) as HastNode)
    },
  }
}

/** languageForPath picks a grammar for a path, or plaintext when none fits. */
export function languageForPath(path: string): string {
  const name = (path.split('/').pop() ?? '').toLowerCase()
  const byName = filenameLanguages[name]
  if (byName) {
    return byName
  }
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : ''
  const language = extensionLanguages[extension]
  return language && grammarLoaders[language] ? language : plaintext
}

/** activeTheme reads the theme VS Code stamped on the document body. */
export function activeTheme(): ThemeName {
  return document.body.classList.contains('vscode-light') ? 'light-plus' : 'dark-plus'
}

/** ensureLanguages loads any grammars the highlighter does not already hold. */
async function ensureLanguages(languages: readonly string[]): Promise<HighlighterCore> {
  const highlighter = await getHighlighter()
  const loaded = new Set(highlighter.getLoadedLanguages())
  const missing = languages.filter(language => !loaded.has(language) && grammarLoaders[language])
  if (missing.length > 0) {
    const grammars = await Promise.all(missing.map(language => grammarLoaders[language]!()))
    await highlighter.loadLanguage(...grammars.map(grammar => grammar.default))
  }
  return highlighter
}

/** getHighlighter builds the shared highlighter once, with themes but no grammars. */
function getHighlighter(): Promise<HighlighterCore> {
  cached ??= createHighlighterCore({
    themes: [darkPlus, lightPlus],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return cached
}

/** cached holds the single highlighter instance for the life of the webview. */
let cached: Promise<HighlighterCore> | undefined

/** flattenLines unwraps Shiki's pre > code > span.line tree into refractor's flat node list. */
function flattenLines(root: HastNode): HastNode[] {
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

/** ThemeName is one of the two VS Code default themes Shiki ships. */
export type ThemeName = 'dark-plus' | 'light-plus'

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

/** GrammarLoader imports one grammar module lazily. */
type GrammarLoader = () => Promise<{ default: Parameters<HighlighterCore['loadLanguage']>[0] }>

export const __test = { grammarLoaders, extensionLanguages, filenameLanguages }

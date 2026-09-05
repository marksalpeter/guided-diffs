import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

const boundary = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
})

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tsparser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { '@typescript-eslint': tseslint },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: boundary(['vscode', 'react', 'react-dom', 'react-diff-view', '**/extension/**', '**/webview/**']),
  },
  {
    files: ['src/cli/**/*.ts'],
    rules: boundary(['vscode', 'react*', '**/extension/**', '**/webview/**']),
  },
  {
    files: ['src/webview/**/*.{ts,tsx}'],
    rules: boundary(['vscode', '**/extension/**']),
  },
]

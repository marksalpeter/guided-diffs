import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { storeDir } from '../core/git.js'
import { ReviewStore } from '../core/store.js'

/** shimRelativePath is where the agent-facing CLI launcher is written, inside the ignored store. */
export const shimRelativePath = `${storeDir}/bin/gdr`

/** skillRelativePath is the Claude Code skill the agent discovers by filesystem. */
export const skillRelativePath = '.claude/skills/guided-diffs/SKILL.md'

/** skillVersion is bumped whenever the skill's contract changes, forcing a rewrite. */
export const skillVersion = 2

/** installAgentSupport writes the shim and skill, and hides the skill from git for this clone only. */
export async function installAgentSupport(options: InstallOptions): Promise<void> {
  // the shim lives inside the store, so the store's self-ignoring .gitignore must exist first
  await new ReviewStore(options.repoRoot).ensureStoreDir()
  await writeShim(options.repoRoot, options.nodePath, options.cliPath, { GDR_URI_SCHEME: options.uriScheme })
  await writeSkill(options.repoRoot)
  await excludeFromGit(options.gitCommonDir, skillRelativePath)
}

/** writeShim drops an executable launcher that runs the bundled CLI through VS Code's own Node. */
export async function writeShim(repoRoot: string, nodePath: string, cliPath: string, env: Record<string, string> = {}): Promise<string> {
  const target = join(repoRoot, shimRelativePath)
  await mkdir(dirname(target), { recursive: true })
  const exported = Object.entries(env).map(([name, value]) => `${name}=${quote(value)} `).join('')
  // ELECTRON_RUN_AS_NODE lets the editor's bundled binary act as plain node, so PATH need not have one
  const script = ['#!/bin/sh', `${exported}ELECTRON_RUN_AS_NODE=1 exec ${quote(nodePath)} ${quote(cliPath)} "$@"`, ''].join('\n')
  await writeFile(target, script)
  await chmod(target, 0o755)
  return target
}

/** writeSkill installs the instructions that tell an agent the CLI exists and how to use it. */
export async function writeSkill(repoRoot: string): Promise<string> {
  const target = join(repoRoot, skillRelativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, skillBody())
  return target
}

/** excludeFromGit appends a path to this clone's private ignore list, idempotently. */
export async function excludeFromGit(gitCommonDir: string, path: string): Promise<void> {
  const target = join(gitCommonDir, 'info', 'exclude')
  await mkdir(dirname(target), { recursive: true })
  const existing = await readFileOr(target, '')
  if (existing.split('\n').some(line => line.trim() === path)) {
    return
  }
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  await writeFile(target, `${existing}${separator}${path}\n`)
}

/** skillBody is the skill document written into the workspace. */
function skillBody(): string {
  return `---
name: guided-diffs
version: ${skillVersion}
description: |
  Read and reply to code review comments left by the human in the Guided Diffs
  VS Code extension. Use when the user asks you to address review comments,
  check the guided review, respond to review feedback, or fix what the reviewer
  flagged.
---

# Guided Diffs review comments

The human reviews your commits in VS Code and leaves comment threads. Those
threads are **not** in git and **not** greppable — read them through the CLI.

## Reading comments

\`\`\`sh
${shimRelativePath} comments
\`\`\`

Prints every **unresolved** thread for the current branch's review: file path,
line number, the quoted code, the whole conversation, and a thread id.

- \`--unanswered\` limits it to threads you have not replied to since the human
  last spoke. Use this on a second pass.
- \`--json\` emits the same data as JSON.

Resolved threads are never shown. If the command says no review has been
opened, open one yourself:

\`\`\`sh
${shimRelativePath} review
\`\`\`

That opens the review panel on the current branch in the editor, generating the
guide if the branch has none, and is also how you show the human your work.
If the file at \`${shimRelativePath}\` does not exist, the Guided Diffs
extension is not installed — say so rather than guessing.

## Replying

\`\`\`sh
${shimRelativePath} reply <thread-id> -m "handled the null case in abc123"
\`\`\`

Reply after you have made the change, and say what you changed. The human sees
your reply appear live in the review panel.

## What you must not do

**You cannot resolve threads.** Only the human reviewer decides whether their
own comment was addressed. There is no resolve command; do not edit the files
under \`${storeDir}/\` directly to fake one.

## Working loop

1. \`${shimRelativePath} comments\`
2. Fix the code each thread asks for. Read the exact version that was reviewed
   with \`git show <blob>\` when a thread is marked outdated.
3. Commit.
4. \`${shimRelativePath} reply <thread-id> -m "..."\` for each thread you handled.
5. Tell the user what you changed and what you left alone.
`
}

/** readFileOr reads a file, returning a fallback when it does not exist. */
async function readFileOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return fallback
  }
}

/** quote wraps a path for safe interpolation into the shim's shell script. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** InstallOptions are the paths needed to wire an agent up to a workspace. */
export interface InstallOptions {
  repoRoot: string
  gitCommonDir: string
  nodePath: string
  cliPath: string
  uriScheme: string
}

export const __test = { skillBody, quote, readFileOr }

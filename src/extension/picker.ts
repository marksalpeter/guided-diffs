import * as vscode from 'vscode'
import { Git } from '../core/git.js'
import { commitPickerLimit } from '../core/review.js'

/** pickRevision offers branch tips and recent commits, and accepts any revspec typed by hand. */
export async function pickRevision(git: Git, title: string): Promise<string | undefined> {
  const items = await revisionItems(git)
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Pick a branch or commit, or type any revision (HEAD~3, a tag, a sha)',
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (picked) {
    return picked.revision
  }
  return promptForRevision(git, title)
}

/** promptForRevision asks for a raw revspec and validates it against the repository. */
async function promptForRevision(git: Git, title: string): Promise<string | undefined> {
  const typed = await vscode.window.showInputBox({
    title,
    prompt: 'Revision (branch, tag, sha, or HEAD~3)',
    validateInput: async value => (value && (await isValid(git, value)) ? null : 'not a revision in this repository'),
  })
  return typed || undefined
}

/** revisionItems lists local branch tips first, then the newest commits. */
async function revisionItems(git: Git): Promise<RevisionItem[]> {
  const [branches, commits] = await Promise.all([git.localBranches(), git.recentCommits(commitPickerLimit)])
  return [
    { label: 'Branches', kind: vscode.QuickPickItemKind.Separator, revision: '' },
    ...branches.map(branch => ({ label: `$(git-branch) ${branch}`, revision: branch })),
    { label: 'Recent commits', kind: vscode.QuickPickItemKind.Separator, revision: '' },
    ...commits.map(commit => ({
      label: `$(git-commit) ${commit.subject}`,
      description: commit.sha.slice(0, 8),
      detail: `${commit.author} · ${commit.when}`,
      revision: commit.sha,
    })),
  ]
}

/** isValid reports whether a typed revision resolves in this repository. */
async function isValid(git: Git, revision: string): Promise<boolean> {
  try {
    await git.revParse(revision)
    return true
  } catch {
    return false
  }
}

/** RevisionItem is a quick-pick entry carrying the revision it selects. */
interface RevisionItem extends vscode.QuickPickItem {
  revision: string
}

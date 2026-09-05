import { createRequire } from 'node:module'
export async function ReviewService(repo) {
  const { Git } = await import('../src/core/git.ts')
  const { ReviewService: RS } = await import('../src/core/review.ts')
  const { installAgentSupport } = await import('../src/extension/agentSupport.ts')
  const git = new Git(repo)
  const svc = new RS(git)
  return {
    openBranchReview: () => svc.openBranchReview(),
    startThread: (...a) => svc.startThread(...a),
    install: async (nodePath, cliPath) =>
      installAgentSupport({ repoRoot: repo, gitCommonDir: await git.gitCommonDir(), nodePath, cliPath }),
  }
}

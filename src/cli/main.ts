import { SystemExec } from '../core/exec.js'
import { unansweredThreads, unresolvedThreads } from '../core/fold.js'
import { Git } from '../core/git.js'
import { ReviewService } from '../core/review.js'
import { ReviewStore } from '../core/store.js'
import { noThreadsMessage, renderThreads } from './render.js'

/** usage is printed for `--help` and for any unrecognised invocation. */
const usage = `gdr — read and reply to guided review comments

  gdr comments [--unanswered] [--json]   list unresolved threads for the current review
  gdr reply <thread-id> -m <message>     reply to a thread

Only the human reviewer can resolve a thread.`

/** main parses argv, runs the requested command, and returns a process exit code. */
export async function main(argv: readonly string[], out: Writer = process.stdout, err: Writer = process.stderr): Promise<number> {
  const [command, ...rest] = argv
  try {
    switch (command) {
      case 'comments':
        return await runComments(rest, out)
      case 'reply':
        return await runReply(rest, out)
      case '--help':
      case '-h':
      case undefined:
        out.write(`${usage}\n`)
        return 0
      default:
        err.write(`unknown command: ${command}\n\n${usage}\n`)
        return 2
    }
  } catch (error) {
    err.write(`${messageOf(error)}\n`)
    return 1
  }
}

/** runComments prints the unresolved threads for the review covering the current HEAD. */
async function runComments(args: readonly string[], out: Writer): Promise<number> {
  const { service, key } = await resolveReview()
  const review = await service.load(key)
  const threads = args.includes('--unanswered') ? unansweredThreads(review.state) : unresolvedThreads(review.state)

  if (args.includes('--json')) {
    out.write(`${JSON.stringify({ key, refs: review.state.refs, threads }, null, 2)}\n`)
    return 0
  }
  out.write(`${renderThreads(review, threads)}\n`)
  return 0
}

/** runReply appends an agent reply to one thread. */
async function runReply(args: readonly string[], out: Writer): Promise<number> {
  const threadId = args[0]
  const body = readMessage(args)
  if (!threadId || !body) {
    throw new Error('usage: gdr reply <thread-id> -m <message>')
  }

  const { service, key } = await resolveReview()
  const review = await service.load(key)
  if (!review.state.threads.some(thread => thread.id === threadId)) {
    throw new Error(`no thread ${threadId} in review ${key}`)
  }

  await service.reply(key, threadId, body, 'agent')
  out.write(`replied to ${threadId}\n`)
  return 0
}

/** resolveReview finds the review for the current branch, falling back to a head-sha lookup. */
async function resolveReview(): Promise<{ service: ReviewService; key: string }> {
  const root = await repoRoot()
  const git = new Git(root)
  const service = new ReviewService(git)

  const branch = await git.currentBranch()
  const store = service.reviews
  const byBranch = branch ? ReviewStore.keyForBranch(branch) : ''
  if (byBranch && (await store.read(byBranch)).length > 0) {
    return { service, key: byBranch }
  }

  const headSha = await git.revParse('HEAD')
  const byHead = await store.findByHead(headSha)
  if (byHead) {
    return { service, key: byHead }
  }
  throw new Error(`${noThreadsMessage} No review has been opened for this branch — open one in VS Code first.`)
}

/** repoRoot locates the repository containing the working directory. */
async function repoRoot(): Promise<string> {
  const out = await new SystemExec(process.cwd()).run('git', ['rev-parse', '--show-toplevel'])
  return out.trim()
}

/** readMessage pulls the -m/--message value out of argv. */
function readMessage(args: readonly string[]): string {
  const index = args.findIndex(arg => arg === '-m' || arg === '--message')
  return index === -1 ? '' : (args[index + 1] ?? '')
}

/** messageOf renders any thrown value as a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Writer is the output seam so tests can capture what the CLI prints. */
export interface Writer {
  write(chunk: string): void
}

if (require.main === module) {
  void main(process.argv.slice(2)).then(code => {
    process.exitCode = code
  })
}

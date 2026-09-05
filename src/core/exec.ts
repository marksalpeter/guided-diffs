import { execFile } from 'node:child_process'

/** maxBuffer is the output ceiling for one child process, sized for large diffs. */
const maxBuffer = 256 * 1024 * 1024

/** SystemExec runs a child process and returns its stdout, rejecting on a non-zero exit. */
export class SystemExec implements Exec {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  run(command: string, args: readonly string[], stdin?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        [...args],
        { cwd: this.cwd, maxBuffer, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            reject(new ExecError(command, args, stderr || error.message))
            return
          }
          resolve(stdout)
        },
      )
      if (stdin !== undefined) {
        child.stdin?.end(stdin)
      }
    })
  }
}

/** ExecError carries the failing command and its stderr. */
export class ExecError extends Error {
  readonly command: string
  readonly args: readonly string[]
  readonly stderr: string

  constructor(command: string, args: readonly string[], stderr: string) {
    super(`${command} ${args.join(' ')} failed: ${stderr.trim()}`)
    this.name = 'ExecError'
    this.command = command
    this.args = args
    this.stderr = stderr
  }
}

/** Exec is the process seam every git and CLI call goes through. */
export interface Exec {
  run(command: string, args: readonly string[], stdin?: string): Promise<string>
}

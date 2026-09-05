import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import type { HostMessage, ViewMessage } from '../core/protocol.js'
import { ClaudeCli } from '../core/guide.js'
import { ReviewService } from '../core/review.js'

/** viewType identifies the panel for VS Code's tab restore. */
export const viewType = 'guidedDiffs.review'

/** ReviewPanel hosts one review's webview and keeps it in step with the event log. */
export class ReviewPanel {
  private static open = new Map<string, ReviewPanel>()

  private panel: vscode.WebviewPanel
  private service: ReviewService
  private key: string
  private assets: vscode.Uri
  private disposables: vscode.Disposable[] = []
  private guideBusy = false

  private constructor(panel: vscode.WebviewPanel, service: ReviewService, key: string, assets: vscode.Uri) {
    this.panel = panel
    this.service = service
    this.key = key
    this.assets = assets

    this.panel.webview.options = { enableScripts: true, localResourceRoots: [assets] }
    this.panel.webview.html = this.html()
    this.disposables.push(this.panel.webview.onDidReceiveMessage((m: ViewMessage) => void this.onMessage(m)))
    this.disposables.push(this.watchStore())
    this.panel.onDidDispose(() => this.dispose())
  }

  /** show opens or focuses the panel for one review key. */
  static show(service: ReviewService, key: string, assets: vscode.Uri): ReviewPanel {
    const existing = ReviewPanel.open.get(key)
    if (existing) {
      existing.panel.reveal()
      return existing
    }
    const panel = vscode.window.createWebviewPanel(viewType, `Review ${key}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    })
    return ReviewPanel.adopt(panel, service, key, assets)
  }

  /** adopt attaches a panel VS Code restored on startup to a live review. */
  static adopt(panel: vscode.WebviewPanel, service: ReviewService, key: string, assets: vscode.Uri): ReviewPanel {
    const created = new ReviewPanel(panel, service, key, assets)
    ReviewPanel.open.set(key, created)
    void created.push()
    return created
  }

  /** push sends the current review state to the webview. */
  async push(): Promise<void> {
    try {
      const { state, files } = await this.service.load(this.key)
      const diff = await this.service.repo.unifiedDiff(state.refs.baseSha, state.refs.headSha)
      this.send({ type: 'review', payload: { state, files, diff, guideBusy: this.guideBusy } })
    } catch (error) {
      this.send({ type: 'error', message: messageOf(error) })
    }
  }

  /** onMessage applies one webview action and pushes the resulting state back. */
  private async onMessage(message: ViewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          return await this.push()
        case 'startThread':
          await this.service.startThread(this.key, message.path, message.side, message.line, message.body, message.endLine)
          break
        case 'startGroupThread':
          await this.service.startGroupThread(this.key, message.groupId, message.body)
          break
        case 'reply':
          await this.service.reply(this.key, message.threadId, message.body, 'human')
          break
        case 'resolve':
          await this.service.resolveThread(this.key, message.threadId)
          break
        case 'reopen':
          await this.service.reopenThread(this.key, message.threadId)
          break
        case 'markReviewed':
          await this.service.markReviewed(this.key, message.path, message.blob)
          break
        case 'unmarkReviewed':
          await this.service.unmarkReviewed(this.key, message.path)
          break
        case 'generateGuide':
          return await this.generateGuide()
        case 'openFile':
          return await this.openFile(message.path, message.line)
      }
      await this.push()
    } catch (error) {
      void vscode.window.showErrorMessage(`Guided Diffs: ${messageOf(error)}`)
    }
  }

  /** generateGuide runs inference without blocking the diff, which is already on screen. */
  private async generateGuide(): Promise<void> {
    if (this.guideBusy) {
      return
    }
    this.guideBusy = true
    await this.push()

    const settings = vscode.workspace.getConfiguration('guidedDiffs')
    const runner = new ClaudeCli(settings.get('claudePath', 'claude'), settings.get('model', 'claude-opus-5'))
    try {
      await this.service.generateGuide(this.key, runner)
    } catch {
      // the failure is already recorded in the log, and the toolbar renders it with a Retry button
    } finally {
      this.guideBusy = false
      await this.push()
    }
  }

  /** openFile reveals a path in a normal editor at the given line. */
  private async openFile(path: string, line: number): Promise<void> {
    const uri = vscode.Uri.joinPath(vscode.Uri.file(this.service.repo.repoRoot), path)
    const editor = await vscode.window.showTextDocument(uri, { preview: true })
    const position = new vscode.Position(Math.max(0, line - 1), 0)
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
  }

  /** watchStore reloads the panel whenever the agent or another window appends to the log. */
  private watchStore(): vscode.Disposable {
    const pattern = new vscode.RelativePattern(this.service.repo.repoRoot, `.guided-review/${this.key}.jsonl`)
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    const reload = debounce(() => void this.push(), 120)
    watcher.onDidChange(reload)
    watcher.onDidCreate(reload)
    return watcher
  }

  /** send posts one message to the webview. */
  private send(message: HostMessage): void {
    void this.panel.webview.postMessage(message)
  }

  /** html builds the webview document, locking scripts down to the bundled assets. */
  private html(): string {
    const nonce = randomBytes(16).toString('hex')
    const webview = this.panel.webview
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.assets, 'main.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.assets, 'main.css'))
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ')

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style.toString()}" />
    <title>Guided Diffs</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${script.toString()}"></script>
  </body>
</html>`
  }

  /** dispose tears the panel down and forgets it. */
  private dispose(): void {
    ReviewPanel.open.delete(this.key)
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables = []
  }
}

/** debounce collapses a burst of file-watcher events into one reload. */
function debounce(action: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | undefined
  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(action, ms)
  }
}

/** messageOf renders any thrown value as a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

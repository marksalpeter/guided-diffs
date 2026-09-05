import type { ViewMessage } from '../core/protocol.js'

/** vscode is the host bridge, acquired once because the API may only be taken a single time. */
const vscode = acquire()

/** post sends one message to the extension host. */
export function post(message: ViewMessage): void {
  vscode?.postMessage(message)
}

/** saveViewState persists ephemeral view state so a restored tab looks the way it was left. */
export function saveViewState(state: ViewState): void {
  vscode?.setState(state)
}

/** loadViewState restores the view state a previous session saved. */
export function loadViewState(): ViewState {
  return (vscode?.getState() as ViewState | undefined) ?? {}
}

/** acquire takes the VS Code webview API, returning undefined outside the host. */
function acquire(): VsCodeApi | undefined {
  const globalWithApi = globalThis as { acquireVsCodeApi?: () => VsCodeApi }
  return globalWithApi.acquireVsCodeApi?.()
}

/** ViewState is per-viewer scroll and layout state, never domain data. */
export interface ViewState {
  mode?: 'guided' | 'diff'
  scrollTop?: number
  collapsed?: string[]
}

/** VsCodeApi is the subset of the webview bridge this view uses. */
interface VsCodeApi {
  postMessage(message: unknown): void
  setState(state: unknown): void
  getState(): unknown
}

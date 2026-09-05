import type { ChangedFile, ReviewState } from './types.js'

/** ReviewPayload is everything the webview needs to render one review. */
export interface ReviewPayload {
  state: ReviewState
  files: ChangedFile[]
  diff: string
  guideBusy: boolean
}

/** HostMessage is sent from the extension host to the webview. */
export type HostMessage =
  | { type: 'review'; payload: ReviewPayload }
  | { type: 'error'; message: string }

/** ViewMessage is sent from the webview to the extension host. */
export type ViewMessage =
  | { type: 'ready' }
  | { type: 'startThread'; path: string; side: 'old' | 'new'; line: number; endLine?: number; body: string }
  | { type: 'startGroupThread'; groupId: string; body: string }
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'resolve'; threadId: string }
  | { type: 'reopen'; threadId: string }
  | { type: 'markReviewed'; path: string; blob: string }
  | { type: 'unmarkReviewed'; path: string }
  | { type: 'reviewFiles'; files: { path: string; blob: string }[]; reviewed: boolean }
  | { type: 'generateGuide' }
  | { type: 'openFile'; path: string; line: number }

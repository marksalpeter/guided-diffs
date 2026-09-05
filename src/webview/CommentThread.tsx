import { useState } from 'react'
import type { Thread } from '../core/types.js'
import { post } from './vscodeApi.js'

/** CommentThread renders one conversation with its reply, resolve and reopen actions. */
export const CommentThread = ({ thread }: { thread: Thread }) => {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')

  const sendReply = () => {
    if (!draft.trim()) {
      return
    }
    post({ type: 'reply', threadId: thread.id, body: draft.trim() })
    setDraft('')
    setReplying(false)
  }

  return (
    <div className={`gdr-thread${thread.state === 'resolved' ? ' resolved' : ''}`}>
      {thread.status === 'outdated' && <OutdatedNotice thread={thread} />}
      {thread.comments.map(comment => (
        <div key={comment.id} className="gdr-comment">
          <span className={`gdr-author ${comment.author}`}>{comment.author}</span>
          {comment.body}
        </div>
      ))}

      {replying ? (
        <ReplyBox
          draft={draft}
          onChange={setDraft}
          onSubmit={sendReply}
          onCancel={() => {
            setDraft('')
            setReplying(false)
          }}
        />
      ) : (
        <div className="gdr-thread-actions">
          <button className="secondary" onClick={() => setReplying(true)}>
            Reply
          </button>
          {thread.state === 'open' ? (
            <button onClick={() => post({ type: 'resolve', threadId: thread.id })}>Resolve</button>
          ) : (
            <button className="secondary" onClick={() => post({ type: 'reopen', threadId: thread.id })}>
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** OutdatedNotice shows the code a thread was written against once that code has moved on. */
const OutdatedNotice = ({ thread }: { thread: Thread }) => (
  <>
    <div className="gdr-thread-actions" style={{ marginTop: 0, marginBottom: 6 }}>
      <span className="gdr-badge">outdated</span>
    </div>
    {thread.anchor.kind === 'line' && thread.anchor.text && <div className="gdr-quote">{thread.anchor.text}</div>}
  </>
)

/** ReplyBox is the inline composer for replying to an existing thread. */
const ReplyBox = ({
  draft,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) => (
  <div>
    <textarea
      autoFocus
      rows={3}
      value={draft}
      placeholder="Reply…  (Cmd/Ctrl+Enter to send)"
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          onSubmit()
        }
        if (event.key === 'Escape') {
          onCancel()
        }
      }}
    />
    <div className="gdr-thread-actions">
      <button onClick={onSubmit}>Reply</button>
      <button className="secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  </div>
)

/** NewCommentBox is the composer shown when a line is first clicked. */
export const NewCommentBox = ({ onSubmit, onCancel }: { onSubmit: (body: string) => void; onCancel: () => void }) => {
  const [draft, setDraft] = useState('')
  const submit = () => {
    if (draft.trim()) {
      onSubmit(draft.trim())
    }
  }

  return (
    <div className="gdr-thread">
      <textarea
        autoFocus
        rows={3}
        value={draft}
        placeholder="Leave a comment…  (Cmd/Ctrl+Enter to save)"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            submit()
          }
          if (event.key === 'Escape') {
            onCancel()
          }
        }}
      />
      <div className="gdr-thread-actions">
        <button onClick={submit}>Comment</button>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseDiff, type FileData } from 'react-diff-view'
import { orderPaths } from '../core/ordering.js'
import type { HostMessage, ReviewPayload } from '../core/protocol.js'
import type { Thread } from '../core/types.js'
import { CommentThread } from './CommentThread.js'
import { FileDiff, fileAnchorId, pathOf } from './FileDiff.js'
import { GuideRail } from './GuideRail.js'
import { activeTheme, createRefractorShim } from './highlight.js'
import { loadViewState, post, saveViewState } from './vscodeApi.js'

/** App is the review shell: a mode toolbar, the guide rail, and the diff pane. */
export const App = () => {
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [fatal, setFatal] = useState('')
  const [mode, setMode] = useState<Mode>(loadViewState().mode ?? 'guided')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(loadViewState().collapsed ?? []))

  useHostMessages(setPayload, setFatal)
  useEffect(() => saveViewState({ mode, collapsed: [...collapsed] }), [mode, collapsed])

  const refractor = useMemo(() => createRefractorShim(activeTheme()), [])
  const files = useMemo(() => (payload ? parseDiff(payload.diff) : []), [payload])
  const ordered = useOrderedFiles(files, payload, mode)
  const scroller = useRef<HTMLDivElement>(null)
  useScrollAnchor(scroller, ordered)

  const jumpToFile = useCallback((path: string) => {
    document.getElementById(fileAnchorId(path))?.scrollIntoView({ block: 'start' })
  }, [])

  const toggle = useCallback((path: string) => {
    setCollapsed(previous => {
      const next = new Set(previous)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  if (fatal) {
    return <div className="gdr-empty">{fatal}</div>
  }
  if (!payload) {
    return <div className="gdr-empty">Loading review…</div>
  }

  const { state } = payload
  const outdated = state.threads.filter(thread => thread.status === 'outdated' && thread.state === 'open')

  return (
    <div className="gdr-shell">
      <div className="gdr-toolbar">
        <span className="gdr-refs">
          <code>{state.refs.baseLabel}</code> → <code>{state.refs.headLabel}</code>
        </span>
        <span className="gdr-spacer" />
        <div className="gdr-modes">
          <button aria-pressed={mode === 'guided'} onClick={() => setMode('guided')}>
            Guided
          </button>
          <button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>
            Diff
          </button>
        </div>
      </div>

      <div className="gdr-body">
        {mode === 'guided' && <GuideRail state={state} busy={payload.guideBusy} onJumpToFile={jumpToFile} />}
        <div className="gdr-main" ref={scroller}>
          {ordered.length === 0 && <div className="gdr-empty">No changes between these commits.</div>}
          {ordered.map(file => {
            const path = pathOf(file)
            return (
              <FileDiff
                key={path}
                file={file}
                meta={payload.files.find(f => f.path === path)}
                threads={threadsForPath(state.threads, path)}
                refractor={refractor}
                collapsed={collapsed.has(path)}
                onToggle={() => toggle(path)}
              />
            )
          })}
          {outdated.length > 0 && <OutdatedThreads threads={outdated} />}
        </div>
      </div>
    </div>
  )
}

/** OutdatedThreads lists threads whose code has moved on, so they are never silently lost. */
const OutdatedThreads = ({ threads }: { threads: Thread[] }) => (
  <div className="gdr-outdated-list">
    <h3>Outdated comments ({threads.length})</h3>
    {threads.map(thread => (
      <CommentThread key={thread.id} thread={thread} />
    ))}
  </div>
)

/** useHostMessages subscribes to the extension host and announces readiness once. */
function useHostMessages(onReview: (payload: ReviewPayload) => void, onError: (message: string) => void): void {
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      if (event.data.type === 'review') {
        onReview(event.data.payload)
      } else if (event.data.type === 'error') {
        onError(event.data.message)
      }
    }
    window.addEventListener('message', listener)
    post({ type: 'ready' })
    return () => window.removeEventListener('message', listener)
  }, [onReview, onError])
}

/** useOrderedFiles applies the guide's reading order in guided mode, and git order otherwise. */
function useOrderedFiles(files: FileData[], payload: ReviewPayload | null, mode: Mode): FileData[] {
  return useMemo(() => {
    const guide = mode === 'guided' ? payload?.state.guide : undefined
    const order = orderPaths(files.map(pathOf), guide)
    return order
      .map(path => files.find(file => pathOf(file) === path))
      .filter((file): file is FileData => file !== undefined)
  }, [files, payload, mode])
}

/** useScrollAnchor keeps the file under the reader pinned when the guide reorders the pane. */
function useScrollAnchor(scroller: React.RefObject<HTMLDivElement | null>, ordered: FileData[]): void {
  const signature = ordered.map(pathOf).join('|')
  const previous = useRef(signature)
  const anchor = useRef<{ id: string; offset: number } | null>(null)

  if (previous.current !== signature && scroller.current && anchor.current === null) {
    anchor.current = topVisibleFile(scroller.current)
  }

  useLayoutEffect(() => {
    if (previous.current === signature) {
      return
    }
    previous.current = signature
    const held = anchor.current
    anchor.current = null
    if (!held || !scroller.current) {
      return
    }
    const element = document.getElementById(held.id)
    if (element) {
      scroller.current.scrollTop = element.offsetTop - held.offset
    }
  }, [signature, scroller])
}

/** topVisibleFile records which file section is at the top of the viewport, and its offset. */
function topVisibleFile(scroller: HTMLDivElement): { id: string; offset: number } | null {
  for (const section of Array.from(scroller.querySelectorAll<HTMLElement>('.gdr-file'))) {
    const offset = section.offsetTop - scroller.scrollTop
    if (offset + section.offsetHeight > 0) {
      return { id: section.id, offset }
    }
  }
  return null
}

/** threadsForPath selects the threads anchored to one file. */
function threadsForPath(threads: readonly Thread[], path: string): Thread[] {
  return threads.filter(thread => thread.anchor.kind === 'line' && thread.anchor.path === path)
}

/** Mode is which of the two panes the reviewer has selected. */
type Mode = 'guided' | 'diff'

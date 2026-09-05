import type { ReviewState } from '../core/types.js'
import { post } from './vscodeApi.js'

/** kindLabels name each chapter's role in the reading order. */
const kindLabels: Record<string, string> = {
  core: 'core change',
  consequence: 'consequence',
  auxiliary: 'supporting',
}

/** GuideRail is the left pane: chapter titles, summaries, and links into the diff. */
export const GuideRail = ({
  state,
  busy,
  onJumpToFile,
}: {
  state: ReviewState
  busy: boolean
  onJumpToFile: (path: string) => void
}) => {
  if (state.guideError) {
    return (
      <aside className="gdr-rail">
        <div className="gdr-rail-error">{state.guideError}</div>
        <button onClick={() => post({ type: 'generateGuide' })}>Retry</button>
      </aside>
    )
  }

  if (busy) {
    return (
      <aside className="gdr-rail">
        <div className="gdr-rail-empty">Reading the diff…</div>
      </aside>
    )
  }

  if (!state.guide) {
    return (
      <aside className="gdr-rail">
        <div className="gdr-rail-empty">No guide yet. The diff is on the right.</div>
        <button onClick={() => post({ type: 'generateGuide' })}>Generate guide</button>
      </aside>
    )
  }

  return (
    <aside className="gdr-rail">
      {state.guideStale && (
        <div className="gdr-rail-error">
          This guide describes an earlier commit.
          <div style={{ marginTop: 8 }}>
            <button onClick={() => post({ type: 'generateGuide' })}>Regenerate</button>
          </div>
        </div>
      )}
      {state.guide.groups.map(group => (
        <div key={group.id} className="gdr-group">
          <div className="gdr-kind">{kindLabels[group.kind] ?? group.kind}</div>
          <div className="gdr-group-title">{group.title}</div>
          <div className="gdr-group-summary">{group.summary}</div>
          <div className="gdr-group-files">
            {group.files.map(path => (
              <span key={path} className="gdr-group-file" title={path} onClick={() => onJumpToFile(path)}>
                {path}
              </span>
            ))}
          </div>
        </div>
      ))}
    </aside>
  )
}

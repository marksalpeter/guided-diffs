import type { ChangedFile, ReviewState } from '../core/types.js'
import { post } from './vscodeApi.js'

/** GuideStatus floats over the bottom of the left column while the guide is absent or stale. */
export const GuideStatus = ({
  state,
  busy,
  files,
}: {
  state: ReviewState
  busy: boolean
  files: readonly ChangedFile[]
}) => {
  if (busy) {
    return (
      <Pill>
        <span className="gdr-pill-label">Generating guide…</span>
        <DiffStat files={files} />
      </Pill>
    )
  }
  if (state.guideError) {
    return (
      <Pill>
        <span className="gdr-pill-label error">{state.guideError}</span>
        <button className="secondary" onClick={() => post({ type: 'generateGuide' })}>
          Retry
        </button>
      </Pill>
    )
  }
  if (!state.guide) {
    return (
      <Pill>
        <DiffStat files={files} />
        <button onClick={() => post({ type: 'generateGuide' })}>Generate guide</button>
      </Pill>
    )
  }
  if (state.guideStale) {
    return (
      <Pill>
        <span className="gdr-pill-label">Guide describes an earlier commit</span>
        <button className="secondary" onClick={() => post({ type: 'generateGuide' })}>
          Regenerate
        </button>
      </Pill>
    )
  }
  return null
}

/** Pill is the floating container anchored to the bottom of the left column. */
const Pill = ({ children }: { children: React.ReactNode }) => <div className="gdr-pill">{children}</div>

/** DiffStat summarises the whole review the way the file cards summarise one file. */
const DiffStat = ({ files }: { files: readonly ChangedFile[] }) => {
  const additions = files.reduce((total, file) => total + file.additions, 0)
  const deletions = files.reduce((total, file) => total + file.deletions, 0)
  return (
    <span className="gdr-pill-stat">
      {files.length} {files.length === 1 ? 'file' : 'files'} changed
      <span className="gdr-stat-add">+{additions}</span>
      <span className="gdr-stat-del">−{deletions}</span>
    </span>
  )
}

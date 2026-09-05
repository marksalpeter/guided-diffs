import type { ReviewState } from '../core/types.js'
import { post } from './vscodeApi.js'

/** GuideStatus is the toolbar control for generating, retrying and refreshing the guide. */
export const GuideStatus = ({ state, busy }: { state: ReviewState; busy: boolean }) => {
  if (busy) {
    return <span className="gdr-guide-status">Reading the diff…</span>
  }
  if (state.guideError) {
    return (
      <span className="gdr-guide-status error">
        {state.guideError}
        <button className="secondary" onClick={() => post({ type: 'generateGuide' })}>
          Retry
        </button>
      </span>
    )
  }
  if (!state.guide) {
    return (
      <span className="gdr-guide-status">
        <button className="secondary" onClick={() => post({ type: 'generateGuide' })}>
          Generate guide
        </button>
      </span>
    )
  }
  if (state.guideStale) {
    return (
      <span className="gdr-guide-status">
        Guide describes an earlier commit
        <button className="secondary" onClick={() => post({ type: 'generateGuide' })}>
          Regenerate
        </button>
      </span>
    )
  }
  return null
}

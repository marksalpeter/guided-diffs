import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { BranchSummary, TimelineCommit } from '../core/types.js'
import type { SelectorState } from '../core/protocol.js'
import { post } from './vscodeApi.js'

/** BranchBar is the toolbar's ref selector: a derived base chip, an arrow, then the target branch and its commit. */
export const BranchBar = ({ selector, hasReview }: { selector: SelectorState; hasReview: boolean }) => {
  const commits = selector.timeline?.commits ?? []
  const headSha = timelineHeadSha(selector)
  const forkedFrom = selector.timeline?.forkedFrom ?? ''

  return (
    <div className="gr-branchbar">
      <span className={`gr-chip${hasReview ? '' : ' gr-chip-inert'}`}>
        <span className="gr-chip-branch" title={selector.baseBranch}>
          {selector.baseBranch}
        </span>
        <span className="gr-chip-sep" aria-hidden="true">
          ▸
        </span>
        {hasReview ? (
          <CommitDropdown
            commits={commits}
            selectedSha={selector.baseSha}
            headSha={headSha}
            forkedFrom={forkedFrom}
            onSelect={sha => post({ type: 'selectBase', sha })}
          />
        ) : (
          <span className="gr-chip-value">head</span>
        )}
      </span>

      <span className="gr-branchbar-arrow" aria-hidden="true">
        ──→
      </span>

      <span className="gr-chip">
        <BranchDropdown branches={selector.branches} selected={selector.timeline?.branch} />
        {hasReview && (
          <>
            <span className="gr-chip-sep" aria-hidden="true">
              ▸
            </span>
            <CommitDropdown
              commits={commits}
              selectedSha={selector.headSha}
              headSha={headSha}
              forkedFrom={forkedFrom}
              onSelect={sha => post({ type: 'selectTarget', sha })}
            />
          </>
        )}
      </span>
    </div>
  )
}

/** BranchPicker fills the main pane while no target branch is chosen. */
export const BranchPicker = ({ branches }: { branches: readonly BranchSummary[] }) => (
  <div className="gr-branchpicker">
    <h2 className="gr-branchpicker-title">Select a target branch</h2>
    {branches
      .filter(branch => !branch.isDefault)
      .map(branch => (
        <button
          key={branch.name}
          className="gr-branchpicker-row"
          onClick={() => post({ type: 'selectBranch', branch: branch.name })}
        >
          <span className="gr-branchpicker-name">{branch.name}</span>
          <span className="gr-spacer" />
          <span className="gr-branchpicker-meta">{branch.ahead} commits</span>
          <span className="gr-branchpicker-meta">{branch.when}</span>
        </button>
      ))}
  </div>
)

/** BranchDropdown picks the branch under review, and with it the whole timeline. */
const BranchDropdown = ({ branches, selected }: { branches: readonly BranchSummary[]; selected?: string }) => (
  <Dropdown label={selected ?? 'Select a target branch'} title={selected}>
    {close =>
      branches.map(branch => (
        <button
          key={branch.name}
          role="option"
          aria-selected={branch.name === selected}
          className={`gr-branch-row${branch.name === selected ? ' selected' : ''}`}
          onClick={() => {
            post({ type: 'selectBranch', branch: branch.name })
            close()
          }}
        >
          <span className="gr-branch-name">{branch.name}</span>
          <span className="gr-spacer" />
          <span className="gr-branch-meta">{branch.when}</span>
        </button>
      ))
    }
  </Dropdown>
)

/** CommitDropdown picks one commit out of the timeline both chips share. */
const CommitDropdown = ({
  commits,
  selectedSha,
  headSha,
  forkedFrom,
  onSelect,
}: {
  commits: readonly TimelineCommit[]
  selectedSha: string
  headSha: string
  forkedFrom: string
  onSelect: (sha: string) => void
}) => {
  const selected = commits.find(commit => commit.sha === selectedSha)
  const marker = forkMarkerIndex(commits)
  return (
    <Dropdown
      label={selected ? commitRowLabel(selected, headSha).ref : shortSha(selectedSha)}
      title={selected?.subject}
    >
      {close =>
        commits.map((commit, index) => (
          <Fragment key={commit.sha}>
            {index === marker && <ForkMarker forkedFrom={forkedFrom} />}
            <CommitRow
              commit={commit}
              headSha={headSha}
              selected={commit.sha === selectedSha}
              onSelect={() => {
                onSelect(commit.sha)
                close()
              }}
            />
          </Fragment>
        ))
      }
    </Dropdown>
  )
}

/** CommitRow is one commit in a dropdown, coloured by which side of the fork it sits on. */
const CommitRow = ({
  commit,
  headSha,
  selected,
  onSelect,
}: {
  commit: TimelineCommit
  headSha: string
  selected: boolean
  onSelect: () => void
}) => {
  const { ref, subject } = commitRowLabel(commit, headSha)
  return (
    <button
      role="option"
      aria-selected={selected}
      className={`gr-commit-row ${commit.afterFork ? 'gr-commit-after' : 'gr-commit-before'}${selected ? ' selected' : ''}`}
      title={commit.subject}
      onClick={onSelect}
    >
      <span className="gr-commit-dot" aria-hidden="true">
        ●
      </span>
      <span className="gr-commit-ref">{ref}</span>
      <span className="gr-commit-subject">{subject}</span>
    </button>
  )
}

/** ForkMarker rules off the commits shared with the branch this one grew out of. */
const ForkMarker = ({ forkedFrom }: { forkedFrom: string }) => (
  <div className="gr-fork-marker" aria-hidden="true">
    <span className="gr-fork-label">forked from {forkedFrom}</span>
    <span className="gr-fork-rule" />
  </div>
)

/** Dropdown is the button-and-popup listbox both chips use, since a native select cannot colour its rows. */
const Dropdown = ({
  label,
  title,
  children,
}: {
  label: string
  title?: string
  children: (close: () => void) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useDismiss(root, open, () => setOpen(false))

  return (
    <span className="gr-dropdown" ref={root}>
      <button
        className="gr-chip-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(previous => !previous)}
      >
        <span className="gr-chip-value">{label}</span>
        <span className="gr-chip-caret" aria-hidden="true">
          ˅
        </span>
      </button>
      {open && (
        <div className="gr-popup" role="listbox">
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  )
}

/** useDismiss closes an open popup on Escape or on a click landing outside it. */
function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) {
      return
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        onDismiss()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [root, open, onDismiss])
}

/** commitRowLabel names a commit in a dropdown: `head` at the branch tip, otherwise short sha plus subject. */
export function commitRowLabel(commit: TimelineCommit, headSha: string): CommitLabel {
  return commit.sha === headSha ? { ref: 'head', subject: '' } : { ref: shortSha(commit.sha), subject: commit.subject }
}

/** forkMarkerIndex is the row the fork marker precedes, or -1 when every commit is on one side of the fork. */
export function forkMarkerIndex(commits: readonly TimelineCommit[]): number {
  const lastAfterFork = commits.findLastIndex(commit => commit.afterFork)
  return lastAfterFork === -1 || lastAfterFork === commits.length - 1 ? -1 : lastAfterFork + 1
}

/** timelineHeadSha is the sha sitting at the tip of the selected branch. */
export function timelineHeadSha(selector: SelectorState): string {
  const branch = selector.timeline?.branch
  return selector.branches.find(summary => summary.name === branch)?.headSha ?? selector.timeline?.commits[0]?.sha ?? ''
}

/** shortSha is the 7-character form git abbreviates a commit to. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** CommitLabel is how one commit reads in a chip or a dropdown row. */
export interface CommitLabel {
  ref: string
  subject: string
}

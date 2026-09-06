import { describe, it, expect } from 'vitest'
import { commitRowLabel, forkMarkerIndex, shortSha, timelineHeadSha } from './BranchBar.js'
import type { TimelineCommit } from '../core/types.js'
import type { SelectorState } from '../core/protocol.js'

const commit = (sha: string, subject: string, afterFork: boolean): TimelineCommit => ({
  sha,
  subject,
  author: 'ada',
  when: '2 hours ago',
  afterFork,
})

describe('commitRowLabel', () => {
  it('reads as head at the tip of the branch', () => {
    expect(commitRowLabel(commit('f00ba12aaaa', 'add the picker', true), 'f00ba12aaaa')).toEqual({
      ref: 'head',
      subject: '',
    })
  })

  it('reads as a short sha and subject below the tip', () => {
    expect(commitRowLabel(commit('9c31de0bbbb', 'wire the protocol', true), 'f00ba12aaaa')).toEqual({
      ref: '9c31de0',
      subject: 'wire the protocol',
    })
  })
})

describe('forkMarkerIndex', () => {
  it('marks the first commit below the fork', () => {
    const commits = [
      commit('a', 'add the picker', true),
      commit('b', 'wire the protocol', true),
      commit('c', 'describe files', false),
      commit('d', 'refresh screenshots', false),
    ]
    expect(forkMarkerIndex(commits)).toBe(2)
  })

  it('has no marker when every commit is after the fork', () => {
    expect(forkMarkerIndex([commit('a', 'one', true), commit('b', 'two', true)])).toBe(-1)
  })

  it('has no marker when every commit is before the fork', () => {
    expect(forkMarkerIndex([commit('a', 'one', false), commit('b', 'two', false)])).toBe(-1)
  })

  it('has no marker in an empty timeline', () => {
    expect(forkMarkerIndex([])).toBe(-1)
  })

  it('splits after the last commit above the fork', () => {
    const commits = [commit('a', 'one', true), commit('b', 'two', false), commit('c', 'three', false)]
    expect(forkMarkerIndex(commits)).toBe(1)
  })
})

describe('timelineHeadSha', () => {
  const selector = (timelineBranch: string | undefined): SelectorState => ({
    branches: [
      { name: 'main', headSha: 'mainhead', when: 'yesterday', ahead: 0, isDefault: true },
      { name: 'feat/x', headSha: 'feathead', when: '2 hours ago', ahead: 3, isDefault: false },
    ],
    timeline: timelineBranch
      ? { branch: timelineBranch, forkedFrom: 'main', forkSha: 'fork', commits: [commit('tip', 'newest', true)] }
      : undefined,
    baseSha: 'fork',
    headSha: 'feathead',
    baseBranch: 'main',
  })

  it('takes the head of the branch the timeline describes', () => {
    expect(timelineHeadSha(selector('feat/x'))).toBe('feathead')
  })

  it('falls back to the newest commit for a branch with no summary', () => {
    expect(timelineHeadSha(selector('feat/gone'))).toBe('tip')
  })

  it('is empty without a timeline', () => {
    expect(timelineHeadSha(selector(undefined))).toBe('')
  })
})

describe('shortSha', () => {
  it('abbreviates to seven characters', () => {
    expect(shortSha('3be4e1a9c31de0f00ba12')).toBe('3be4e1a')
  })
})

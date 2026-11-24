import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '../api/types'
import { sections } from './Timeline'

let seq = 0
const e = (type: string, label: string, group: number, round_no: number | null = null): TimelineEntry => ({
  seq: ++seq, group, type, at: seq * 1000, label, round_no,
})

describe('sections', () => {
  const tl = [
    e('TournamentCreated', 'Tournament created', 1),
    e('PlayerAdded', 'Ann added', 1),
    e('StageCreated', 'Stage 1 · 2 divisions drawn', 2),
    e('DivisionStarted', 'Division A started', 2),
    e('RoundStarted', 'Round 1 · 11 players', 2, 1),
    e('PlayerEliminated', 'Ann out', 3, 1),
    e('RoundEnded', 'Round 1 ended', 3, 1),
    e('DivisionCutoffConfirmed', 'Division A: 5 advance', 4, 1),
    e('DivisionStarted', 'Division B started', 4, 1),
    e('RoundStarted', 'Round 2 · 10 players', 4, 2),
  ]
  const s = sections(tl)

  it('keeps setup separate and gives milestones their own sections', () => {
    expect(s.map((x) => x.kind)).toEqual(['setup', 'milestone', 'milestone', 'round', 'milestone', 'milestone', 'round'])
    expect(s[0].entries.map((x) => x.type)).toEqual(['TournamentCreated', 'PlayerAdded'])
  })

  it('names the division on each round and records when it ended', () => {
    const rounds = s.filter((x) => x.kind === 'round')
    expect(rounds.map((x) => x.division)).toEqual(['Division A', 'Division B'])
    expect(rounds[0].end).toBe(tl[6].at)
    expect(rounds[0].entries.map((x) => x.label)).toEqual(['Ann out', 'Round 1 ended'])
  })
})

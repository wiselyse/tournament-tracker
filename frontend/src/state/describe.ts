import type { Division, TournamentState } from '../api/types'

export function activeDivision(s: TournamentState): Division | null {
  for (const st of s.stages) for (const d of st.divisions) if (d.id === s.active_division_id) return d
  return null
}

export function currentStage(s: TournamentState) {
  return s.stages.length ? s.stages[s.stages.length - 1] : null
}

export function divisionLabel(s: TournamentState, id: string | null): string {
  for (const st of s.stages) for (const d of st.divisions) if (d.id === id) return d.label
  return id ?? ''
}

/** Players still in the active division/table. */
export function remaining(s: TournamentState): number {
  return s.players.filter((p) => p.status === 'in').length
}

/** Top-bar chip: "Final table · 12 players", "Stage 1 · Division C". */
export function statusChip(s: TournamentState): { text: string; next?: string } {
  const live = s.players.filter((p) => !['withdrawn'].includes(p.status)).length
  if (!s.tournament.started) return { text: `Setup · ${live} players` }
  if (s.tournament.completed) return { text: 'Complete' }
  const stage = currentStage(s)
  const div = activeDivision(s)
  const next = s.next_division_id ? `Up next: Division ${divisionLabel(s, s.next_division_id)}` : undefined
  if (stage?.is_final) {
    const n = stage.divisions[0].player_ids.length
    return { text: s.stages.length === 1 ? `Single table · ${n} players` : `Final table · ${n} players` }
  }
  return { text: `Stage ${stage?.no} · Division ${div?.label ?? '—'}`, next }
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function ordinal(n: number): string {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

export function placeLabel(p: { finish_place: number | null; finish_tied: boolean; status: string; out_round: number | null }) {
  if (p.status === 'withdrawn') return 'WD'
  if (p.finish_place == null) return ''
  if (p.status === 'dq') return p.out_round != null ? `DQ (R${p.out_round})` : 'DQ'
  return p.finish_tied ? `T-${p.finish_place}` : ordinal(p.finish_place)
}

export const PENALTIES: { kind: string; label: string; rule: string }[] = [
  { kind: 'false_grab', label: 'False spoon grab', rule: '3.2' },
  { kind: 'premature_grab', label: 'Premature spoon grab', rule: '3.3' },
  { kind: 'delayed_pass', label: 'Delayed passing', rule: '3.1' },
  { kind: 'card_pass', label: 'Improper card passing', rule: '3.5' },
  { kind: 'spoon_tamper', label: 'Spoon tampering', rule: '3.4' },
  { kind: 'hand_manipulation', label: "Manipulating a hand", rule: '3.5' },
  { kind: 'physical_harm', label: 'Physical harm', rule: '3.6' },
]

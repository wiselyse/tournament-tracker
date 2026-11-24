import { useMemo, useState } from 'react'
import type { TimelineEntry, TournamentState } from '../api/types'
import { Icon } from '../components/Icon'
import { fmtDuration, placeLabel } from '../state/describe'
import { useT } from '../state/tournament'
import { StalemateButtons } from './live/Cards'
import { useNow, useServerOffset } from './live/Timer'

type Filter = 'all' | 'outs' | 'stalemates' | 'penalties' | 'stoppages'
const FILTERS: { id: Filter; label: string; types: string[] }[] = [
  { id: 'all', label: 'All', types: [] },
  { id: 'outs', label: 'Outs', types: ['PlayerEliminated'] },
  { id: 'stalemates', label: 'Stalemates', types: ['StalemateOpened', 'StalemateResolved', 'StalemateCancelled'] },
  { id: 'penalties', label: 'Penalties', types: ['PenaltyLogged'] },
  { id: 'stoppages', label: 'Stoppages', types: ['StoppageStarted'] },
]
// Bookkeeping that the round header or a merged row already says.
const HIDDEN = new Set(['RoundStarted', 'RoundEnded', 'StoppageEnded'])

interface Section {
  key: string
  kind: 'setup' | 'round' | 'milestone'
  round: number | null
  division: string | null // "Division A" / "Final table" for round headers
  start: TimelineEntry | null
  end: number | null // ms when the round ended
  entries: TimelineEntry[]
}

const MILESTONES = new Set(['StageCreated', 'DivisionStarted', 'DivisionCutoffConfirmed', 'TournamentCompleted'])

export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Split the flat timeline into Setup, one section per round, and stand-alone milestone
 *  sections (stages, divisions, cutoffs, the result) that never fold away. */
export function sections(timeline: TimelineEntry[]): Section[] {
  const out: Section[] = [{ key: 'setup', kind: 'setup', round: null, division: null, start: null, end: null, entries: [] }]
  let division: string | null = null
  for (const e of timeline) {
    if (e.type === 'DivisionStarted' && e.label.startsWith('Division ')) division = e.label.replace(' started', '')
    else if (e.type === 'DivisionStarted') division = e.label.startsWith('Final') ? 'Final table' : null
    if (e.type === 'RoundStarted') {
      out.push({ key: `r${e.round_no}`, kind: 'round', round: e.round_no, division, start: e, end: null, entries: [] })
      continue
    }
    if (e.type === 'RoundEnded') out[out.length - 1].end = e.at
    if (MILESTONES.has(e.group > 1 ? e.type : '')) {
      out.push({ key: `m${e.seq}`, kind: 'milestone', round: null, division: null, start: e, end: null, entries: [e] })
      continue
    }
    const cur = out[out.length - 1]
    // Anything after a milestone but before the next round (rare) joins the milestone.
    cur.entries.push(e)
  }
  return out
}

function roundSummary(s: Section, name: (id: string) => string): string {
  const outs = s.entries.filter((e) => e.type === 'PlayerEliminated').map((e) => name(e.player_ids?.[0] ?? ''))
  const st = s.entries.filter((e) => e.type === 'StalemateOpened').length
  const pen = s.entries.filter((e) => e.type === 'PenaltyLogged').length
  return [
    outs.length ? `${outs.join(', ')} out` : null,
    st ? `${st} stalemate${st > 1 ? 's' : ''}` : null,
    pen ? `${pen} penalt${pen > 1 ? 'ies' : 'y'}` : null,
  ].filter(Boolean).join(' · ') || 'no outs'
}

function dotClass(e: TimelineEntry): string {
  if (e.type === 'PlayerEliminated') return 'brick'
  if (e.type.startsWith('Stalemate')) return 'sea'
  if (e.type === 'PenaltyLogged') return 'gold'
  if (e.type.startsWith('Stoppage')) return 'square'
  if (['StageCreated', 'DivisionStarted', 'DivisionCutoffConfirmed', 'TournamentCompleted'].includes(e.type)) return 'milestone'
  return 'plain'
}

export function Timeline() {
  const { state, rewind, pending, name } = useT()
  const now = useNow(useServerOffset(state.server_now))
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<number | null>(null)
  const secs = useMemo(() => sections(state.timeline), [state.timeline])
  const rounds = secs.filter((s) => s.kind === 'round')
  // Expanded by default: the last two rounds. Others fold to one summary line.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const roundIdx = new Map(rounds.map((s, i) => [s.key, i]))
  const isOpen = (s: Section) =>
    s.kind === 'milestone' || (open[s.key] ?? (s.kind === 'round' && roundIdx.get(s.key)! >= rounds.length - 2))
  const types = FILTERS.find((f) => f.id === filter)!.types
  const byId = new Map(state.players.map((p) => [p.id, p]))

  const stoppageLength = (e: TimelineEntry) => {
    const end = state.timeline.find((x) => x.seq > e.seq && (x.type === 'StoppageEnded' || x.type === 'RoundEnded'))
    return end ? fmtDuration(end.at - e.at) : 'ongoing'
  }

  const describe = (e: TimelineEntry): string => {
    if (e.type === 'StoppageStarted') return `Stoppage — ${stoppageLength(e)}`
    if (e.type === 'PlayerEliminated' && e.player_ids?.[0]) {
      const p = byId.get(e.player_ids[0])
      const place = p ? placeLabel(p) : ''
      return place && p?.status === 'out' ? `${e.label} · finishes ${place}` : e.label
    }
    if (e.type === 'StalemateResolved') return `${e.label}. Branch merged, play continued`
    if (e.type === 'StalemateCancelled') return `${e.label}. Branch closed`
    return e.label
  }

  const jump = (key: string) => {
    setOpen((o) => ({ ...o, [key]: true }))
    requestAnimationFrame(() => document.getElementById(`tl-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const atHead = state.cursor === state.head

  return (
    <div className="timeline-page">
      <section className="timeline-main" aria-label="Events">
        <div className="filters" role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button key={f.id} className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="tl">
          <div className="tl-line" aria-hidden="true" />
          {secs.map((s) => {
            const shown = s.entries.filter((e) => !HIDDEN.has(e.type) && (types.length === 0 || types.includes(e.type)))
            if (s.kind !== 'round' && shown.length === 0) return null
            const expanded = isOpen(s)
            return (
              <div key={s.key} id={`tl-${s.key}`} className="tl-section">
                {s.kind === 'milestone' ? null : s.kind === 'setup' ? (
                  <button className="tl-fold" onClick={() => setOpen((o) => ({ ...o, [s.key]: !expanded }))} aria-expanded={expanded}>
                    <span className="tl-fold-title">SETUP</span>
                    <span className="muted">{shown.length} event{shown.length === 1 ? '' : 's'}</span>
                    <span className="grow" />
                    <span className="muted" aria-hidden="true">{expanded ? 'Hide ▴' : 'Show ▾'}</span>
                  </button>
                ) : expanded ? (
                  <div className="tl-row tl-round">
                    <span className="tl-time">{clock(s.start!.at)}</span>
                    <span className="tl-dot-col"><span className="tl-dot round" /></span>
                    <button className="tl-round-title" onClick={() => setOpen((o) => ({ ...o, [s.key]: false }))} aria-expanded>
                      ROUND {s.round}
                    </button>
                    {s.division && <span className="chip">{s.division}</span>}
                    <span className="muted">
                      {s.start!.label.split('·')[1]?.trim()} · {s.end ? fmtDuration(s.end - s.start!.at) : `live ${fmtDuration(now - s.start!.at)}`}
                    </span>
                  </div>
                ) : (
                  <div className="tl-row">
                    <span className="tl-time">{clock(s.start!.at)}</span>
                    <span className="tl-dot-col"><span className="tl-dot hollow" /></span>
                    <button className="tl-fold" onClick={() => setOpen((o) => ({ ...o, [s.key]: true }))} aria-expanded={false}>
                      <span className="tl-fold-title">ROUND {s.round}</span>
                      {s.division && <span className="chip hide-narrow">{s.division}</span>}
                      <span className="muted">
                        {s.end ? fmtDuration(s.end - s.start!.at) : 'live'} · {roundSummary(s, name)} · {shown.length} event{shown.length === 1 ? '' : 's'}
                      </span>
                      <span className="grow" />
                      <span className="muted hide-narrow" aria-hidden="true">Show ▾</span>
                    </button>
                  </div>
                )}
                {expanded &&
                  shown.map((e) => {
                    const branch = e.type === 'StalemateResolved' || e.type === 'StalemateCancelled'
                    const sel = selected === e.seq
                    const milestone = s.kind === 'milestone' && MILESTONES.has(e.type)
                    return (
                      <div key={e.seq} className={`tl-row${branch ? ' tl-branch' : ''}${milestone ? ' tl-milestone' : ''}${sel ? ' selected' : ''}`}>
                        <span className="tl-time">{clock(e.at)}</span>
                        <span className="tl-dot-col"><span className={`tl-dot ${dotClass(e)}`} /></span>
                        <button className="tl-event" onClick={() => setSelected(sel ? null : e.seq)} aria-expanded={sel}>
                          {describe(e)}
                        </button>
                        {sel && (
                          <button className="btn btn-rewind" disabled={pending} onClick={() => { setSelected(null); rewind(e.seq) }}>
                            <Icon name="rewind" size={16} /> Rewind to here
                          </button>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })}
          {atHead && state.open_stalemates.map((sm) => (
            <div key={sm.id} className="tl-row tl-branch tl-now">
              <span className="tl-time sea-text strong">NOW</span>
              <span className="tl-dot-col"><span className="tl-dot sea pulse" /></span>
              <div className="tl-now-card">
                <span>Stalemate round in progress · {fmtDuration(now - sm.opened_at)}</span>
                <StalemateButtons id={sm.id} players={sm.player_ids} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="timeline-side" aria-label="Jump to round">
        <h2 className="section-label">JUMP TO ROUND</h2>
        <div className="jump-list">
          {[...rounds].reverse().map((s) => {
            const live = !s.end && !state.tournament.completed && atHead
            return (
              <button key={s.key} className={`jump${live ? ' live' : ''}`} onClick={() => jump(s.key)}>
                <span className="row">
                  <span className="jump-title grow">Round {s.round}</span>
                  <span className="muted small">{s.end ? fmtDuration(s.end - s.start!.at) : 'live'}</span>
                </span>
                <span className="small">{roundSummary(s, name)}</span>
              </button>
            )
          })}
        </div>
        <p className="note small">
          Rewinding shows the tournament as it was at that moment. Your next action replaces everything after it, so
          you're asked first.
        </p>
      </aside>
    </div>
  )
}

/** Shown on every tournament screen while the cursor is behind the head. */
export function RewoundBanner({ state }: { state: TournamentState }) {
  const { rewind, pending } = useT()
  if (state.cursor >= state.head) return null
  const last = state.timeline[state.timeline.length - 1]
  return (
    <div className="rewound" role="status">
      <Icon name="rewind" size={18} />
      <span className="grow">
        Viewing the tournament as of <b>{last ? clock(last.at) : 'the start'}</b>
        {last ? ` (${last.label})` : ''}. {state.head - state.cursor} later event{state.head - state.cursor === 1 ? '' : 's'} hidden;
        your next action replaces them.
      </span>
      <button className="btn btn-primary" disabled={pending} onClick={() => rewind(state.head)}>Return to latest</button>
    </div>
  )
}

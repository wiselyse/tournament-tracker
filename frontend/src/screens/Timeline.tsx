import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { TimelineEntry } from '../api/types'
import { useConfirm } from '../components/Confirm'
import { Icon } from '../components/Icon'
import { fmtDuration, placeLabel, roundName, roundShort } from '../state/describe'
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
const HIDDEN = new Set(['RoundStarted', 'RoundEnded', 'StoppageEnded', 'PlayStarted'])

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
      // Divisions take turns, so each round names its own (older logs: the last one started).
      const own = e.division_id === 'final' ? (division ? 'Final table' : null) : e.division_id ? `Division ${e.division_id}` : division
      out.push({ key: `r${e.round_no}`, kind: 'round', round: e.round_no, division: own, start: e, end: null, entries: [] })
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

/** When the round's clock started ("Start round"); older rounds: when seats were drawn. */
function began(s: Section): number | null {
  const start = s.entries.find((e) => e.type === 'PlayStarted' && !e.stalemate_id)
  return start ? start.at : s.entries.some((e) => e.type === 'PlayStarted') ? null : s.start!.at
}

function roundTime(s: Section, now: number, live: boolean): string {
  const b = began(s)
  if (b == null) return s.end ? '—' : 'not started'
  return s.end ? fmtDuration(s.end - b) : live ? `live ${fmtDuration(now - b)}` : 'live'
}

/** Every "1st", "10th"… in the text with its suffix raised and smaller. */
function ordinals(text: string): ReactNode {
  const parts = text.split(/(\d+)(st|nd|rd|th)\b/)
  if (parts.length === 1) return text
  // split() with two groups yields [text, number, suffix, text, number, suffix, …, text]
  return parts.map((x, i) => (i % 3 === 2 ? <sup key={i} className="ord">{x}</sup> : x))
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
  const confirm = useConfirm()
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
  // A penalty that ejected the player is told on the "X disqualified (penalty)" line instead.
  const ejectedBy = new Set(state.timeline.filter((e) => e.penalty_kind).map((e) => e.group))

  const stoppageLength = (e: TimelineEntry) => {
    const end = state.timeline.find((x) => x.seq > e.seq && (x.type === 'StoppageEnded' || x.type === 'RoundEnded'))
    return end ? fmtDuration(end.at - e.at) : 'ongoing'
  }

  const describe = (e: TimelineEntry): ReactNode => {
    if (e.type === 'StoppageStarted') return `Stoppage — ${stoppageLength(e)}`
    if (e.type === 'PlayerEliminated' && e.player_ids?.[0]) {
      const p = byId.get(e.player_ids[0])
      const place = p?.status === 'out' ? placeLabel(p, state.round_names) : '' // DQ and withdrawals have no place
      return ordinals(place ? `${e.label} (${place})` : e.label)
    }
    if (e.type === 'StalemateCancelled') return `${e.label}. Branch closed`
    return ordinals(e.label)
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
            const shown = s.entries.filter((e) =>
              !HIDDEN.has(e.type) && !(e.type === 'PenaltyLogged' && ejectedBy.has(e.group)) &&
              (types.length === 0 || types.includes(e.type) || (e.penalty_kind && filter === 'penalties')))
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
                      ROUND {state.round_names[s.round!]?.n ?? s.round}
                    </button>
                    {s.division && <span className="chip">{s.division}</span>}
                    <span className="muted">
                      {s.start!.label.split('·')[1]?.trim()} · {roundTime(s, now, true)}
                    </span>
                  </div>
                ) : (
                  <div className="tl-row">
                    <span className="tl-time">{clock(s.start!.at)}</span>
                    <span className="tl-dot-col"><span className="tl-dot hollow" /></span>
                    <button className="tl-fold" onClick={() => setOpen((o) => ({ ...o, [s.key]: true }))} aria-expanded={false}>
                      {/* The title carries the division ("B·R1"): there's no room for the chip on phones. */}
                      <span className="tl-fold-title">{s.division ? roundShort(state.round_names, s.round!) : `ROUND ${s.round}`}</span>
                      <span className="muted">
                        {roundTime(s, now, false)} · {roundSummary(s, name)} · {shown.length} event{shown.length === 1 ? '' : 's'}
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
                          <button className="btn btn-rewind" disabled={pending} aria-label="Rewind to here"
                            onClick={async () => {
                              setSelected(null)
                              const ok = await confirm({
                                title: `Rewind to ${clock(e.at)}?`,
                                body: 'The tournament goes back to this moment. Redo brings the later events back; your next action replaces them.',
                                confirmLabel: 'Rewind',
                              })
                              if (ok) rewind(e.seq)
                            }}>
                            <Icon name="rewind" size={18} />
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
                <span>{sm.started_at == null ? 'Stalemate waiting to start' : `Stalemate round in progress · ${fmtDuration(now - sm.started_at)}`}</span>
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
                  <span className="jump-title grow">{roundName(state.round_names, s.round!)}</span>
                  <span className="muted small">{roundTime(s, now, false)}</span>
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

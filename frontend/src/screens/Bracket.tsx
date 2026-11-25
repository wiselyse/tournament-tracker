import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Division, ReportMark, ReportPlayer, RoundNames, Stage } from '../api/types'
import { APP_SIZE, finishLabel, SurvivalChart } from '../components/SurvivalChart'
import { useT, useReport } from '../state/tournament'
import { roundName, roundShort } from '../state/describe'

const STATUS: Record<Division['status'], string> = {
  complete: 'Complete', playing: 'In progress', cutoff: 'Cutoff reached', waiting: 'Waiting',
}

export function Bracket() {
  const { state } = useT()
  const divisions = state.tournament.uses_divisions
  const [tab, setTab] = useState<'stages' | 'survival'>(divisions ? 'stages' : 'survival')
  return (
    <div className="bracket-page">
      <div className="bracket-head">
        <span className="chip">
          {state.tournament.completed ? 'Complete' : 'In progress'} · {state.players.filter((p) => p.status !== 'withdrawn').length} players · {state.rounds_played} rounds
        </span>
        <div className="grow" />
        {divisions && (
          <div role="tablist" aria-label="Bracket view" className="segmented tabs">
            <button role="tab" aria-selected={tab === 'stages'} aria-pressed={tab === 'stages'} onClick={() => setTab('stages')}>Stages</button>
            <button role="tab" aria-selected={tab === 'survival'} aria-pressed={tab === 'survival'} onClick={() => setTab('survival')}>Survival</button>
          </div>
        )}
      </div>
      {tab === 'stages' && divisions ? <Stages /> : <Survival />}
    </div>
  )
}

function Survival() {
  const report = useReport()
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [report.data])
  if (!report.data) return <p className="muted pad">{report.isError ? report.error.message : 'Loading…'}</p>
  if (!report.data.rounds.length) return <p className="muted pad">The chart fills in once the first round starts.</p>
  return (
    <div className="survival-wrap">
      <div className="legend">
        <span><i className="lg-bar" />In the game</span>
        <span><i className="lg-bar gold" />Champion</span>
        <span><i className="lg-dot" />Won stalemate</span>
        <span><i className="lg-ring" />Lost stalemate</span>
        <span><i className="lg-diamond" />Penalty</span>
        <span><b className="lg-x">×</b>Out</span>
        <span className="grow" />
        <span className="hide-narrow">Tap a player for their full history</span>
      </div>
      <ul className="survival-list" aria-label="Rounds by player">
        {report.data.players.map((p) => <CompactRow key={p.id} p={p} names={report.data.round_names} onName={() => nav(`../players?open=${p.id}`, { relative: 'path' })} />)}
      </ul>
      <div className="survival-scroll" ref={box}>
        <SurvivalChart
          report={report.data}
          // Fit the rounds to the screen so the placings on the right stay in view (a tablet held
          // upright included); only very long nights scroll sideways.
          size={{ ...APP_SIZE, colW: Math.max(28, Math.min(APP_SIZE.colW, Math.floor((width - APP_SIZE.nameW - 90) / report.data.rounds.length))) }}
          accent="#d9b877"
          ground="var(--bg)"
          text="var(--text)"
          onName={(id) => nav(`../players?open=${id}`, { relative: 'path' })}
        />
      </div>
    </div>
  )
}

const MARK: Record<ReportMark['type'], [string, string]> = {
  won: ['lg-dot', 'won a stalemate'], lost: ['lg-ring', 'lost a stalemate'], penalty: ['lg-diamond', 'penalty'],
  out: ['lg-x', 'out'], dq: ['lg-x', 'disqualified'], withdrawn: ['lg-x', 'withdrew'],
}

/** Phones: one line per player, each event as its symbol + round number, no sideways scroll. */
function CompactRow({ p, names, onName }: { p: ReportPlayer; names: RoundNames; onName: () => void }) {
  const champ = p.status === 'champion'
  return (
    <li className={`sl-row${champ ? ' champ' : ''}`}>
      <button className="sl-name" onClick={onName}>{p.name}</button>
      <span className="sl-marks">
        {p.marks.map((m, i) => {
          const [cls, what] = MARK[m.type]
          return (
            <span key={i} className="sl-mark" title={`${roundName(names, m.round)}: ${what}`} aria-label={`${roundName(names, m.round)}: ${what}`}>
              {cls === 'lg-x' ? <b className="lg-x" aria-hidden="true">×</b> : <i className={cls} aria-hidden="true" />}{roundShort(names, m.round)}
            </span>
          )
        })}
        {!p.marks.length && <span className="muted">{champ ? 'Won' : p.rounds.length ? 'Still in' : ''}</span>}
      </span>
      <span className="sl-finish">{finishLabel(p)}</span>
    </li>
  )
}

function Stages() {
  const { state, act, undo, pending, name } = useT()
  const byId = new Map(state.players.map((p) => [p.id, p]))
  const lastGroup = state.timeline.length ? state.timeline[state.timeline.length - 1].group : 0
  const lastIsOut = state.timeline.find((e) => e.group === lastGroup)?.type === 'PlayerEliminated'

  const card = (d: Division) => {
    const alive = d.player_ids.filter((id) => ['in', 'waiting', 'advanced'].includes(byId.get(id)?.status ?? ''))
    const meta =
      d.status === 'complete' ? `${d.advancing_ids?.length ?? 0} advanced`
        : d.status === 'cutoff' ? `${alive.length} left · confirm to send them on`
          : d.status === 'playing' ? `${alive.length} of ${d.player_ids.length} left · top ${d.advance_target ?? '—'} advance`
            : `${alive.length} players · seats drawn when it starts`
    return (
      <article key={d.id} className={`div-card s-${d.status}`}>
        <div className="row small-gap">
          <span className="div-name grow">{d.id === 'final' ? 'Final table' : `Division ${d.label}`}</span>
          <span className={`div-status s-${d.status}`}>
            {d.id === state.active_division_id && d.status === 'playing' ? 'Playing now' : d.id === state.next_division_id ? 'Up next' : STATUS[d.status]}
          </span>
        </div>
        <span className="muted small">{meta}</span>
        <ul className="div-chips">
          {d.player_ids.map((id) => {
            const p = byId.get(id)
            const kind = d.advancing_ids?.includes(id) || id === state.tournament.champion_id ? 'adv'
              : ['in', 'waiting'].includes(p?.status ?? '') ? 'in' : 'out'
            return <li key={id} className={`dchip ${kind}`}>{name(id)}</li>
          })}
        </ul>
        {d.status === 'cutoff' && (
          <div className="row small-gap">
            <button className="btn btn-primary grow" disabled={pending}
              onClick={() => act({ type: 'confirm_cutoff', division_id: d.id })}>
              Confirm {alive.length} advance
            </button>
            {lastIsOut && <button className="btn btn-ghost" disabled={pending} onClick={undo}>Undo last out</button>}
          </div>
        )}
      </article>
    )
  }

  const pool = (from: Stage) => {
    const n = from.divisions.reduce((a, d) => a + (d.advancing_ids?.length ?? 0), 0)
    const done = from.divisions.every((d) => d.status === 'complete')
    return (
      <div className="pool" aria-hidden="true">
        <div className={`pool-box${done ? ' done' : ''}`}>
          <b>{n}</b>
          <span className="pool-label">ADVANCE</span>
          <span className="small">{done ? 'reshuffled at random' : 'so far'}</span>
        </div>
      </div>
    )
  }

  const last = state.stages[state.stages.length - 1]
  return (
    <div className="stages"><div className="stages-row">
      {state.stages.map((st, i) => (
        <div key={st.no} className="stage-col-wrap">
          {i > 0 && pool(state.stages[i - 1])}
          <section className="stage-col" aria-label={st.is_final ? 'Final table' : `Stage ${st.no}`}>
            <h2 className="section-label">
              {st.is_final ? 'FINAL TABLE' : `STAGE ${st.no} · ${st.divisions.length} DIVISIONS`}
            </h2>
            {st.divisions.map(card)}
          </section>
        </div>
      ))}
      {last && !last.is_final && (
        <div className="stage-col-wrap">
          {pool(last)}
          <section className="stage-col future" aria-label="Next stage">
            <h2 className="section-label">NEXT</h2>
            <article className="div-card future">
              <span className="div-name">Next stage</span>
              <span className="muted small">Drawn at random from the advancers when this stage ends. 12 or fewer → final table.</span>
            </article>
          </section>
        </div>
      )}
    </div></div>
  )
}

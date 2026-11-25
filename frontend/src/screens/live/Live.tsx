import { useState } from 'react'
import { Link } from 'react-router'
import type { Player } from '../../api/types'
import { Icon } from '../../components/Icon'
import { TableDiagram, type SeatView } from '../../components/TableDiagram'
import { TablePreview, usePreview } from '../../components/TableStep'
import { activeDivision, currentStage, divisionLabel, fmtDuration, remaining, roundShort } from '../../state/describe'
import { useT } from '../../state/tournament'
import { AddPlayerSheet } from '../Players'
import { StageCards } from './Cards'
import { ChangeTable, tableSummary } from './ChangeTable'
import { usePlayerActions } from './PlayerActions'
import { agoText, roundElapsed, useNow, useServerOffset } from './Timer'

export function Live() {
  const { state } = useT()
  const offset = useServerOffset(state.server_now)
  const now = useNow(offset)
  const [sheet, setSheet] = useState<'table' | 'add' | null>(null)
  const actions = usePlayerActions()

  const r = state.round
  const byId = new Map(state.players.map((p) => [p.id, p]))
  const seatPlayer = (seatNo: number): Player | undefined => {
    const pid = r?.seats[seatNo - 1]?.player_id
    return pid ? byId.get(pid) : undefined
  }
  const inStalemate = new Set(state.open_stalemates.flatMap((s) => s.player_ids))

  if (!state.tournament.started) return <NotStarted onAdd={() => setSheet('add')} sheet={sheet} closeSheet={() => setSheet(null)} />

  // The table only shows the round; every action goes through the controls (and the Players tab).
  const seatView = (seatNo: number): SeatView => {
    const p = seatPlayer(seatNo)
    if (!p) return {}
    const penalties = Object.values(p.penalties).reduce((a, b) => a + b, 0)
    const dealer = r?.dealers[0] === seatNo ? 'D' : r?.dealers[1] === seatNo ? 'D2' : undefined
    return {
      name: p.name,
      tag: dealer,
      dim: p.status !== 'in',
      ring: p.status === 'dq' ? 'brick' : inStalemate.has(p.id) ? 'sea' : undefined,
      badge: penalties,
      label: `Seat ${seatNo}, ${p.name}${dealer ? (dealer === 'D' ? ', dealer' : ', second dealer') : ''}${p.status !== 'in' ? ` (${p.status})` : ''}${penalties ? `, ${penalties} penalties` : ''}`,
    }
  }

  const seatName = (n: number) => seatPlayer(n)?.name ?? `seat ${n}`
  const spoons = r?.spoons.length ?? 0
  const between = r?.table.spoon_layout === 'between'
  // Which division is at the table (not shown at a single or final table).
  const division = currentStage(state)?.is_final ? null : activeDivision(state)
  const paused = r?.paused_since != null && !r.ended

  return (
    <div className="live">
      <div className="stage">
        {(paused || division) && (
          <div className="stage-top">
            {paused ? (
              <div className="stoppage-banner" role="status">STOPPAGE — play is paused</div>
            ) : (
              division && <span className="division-now">Division {division.label}</span>
            )}
          </div>
        )}
        <div className="stage-table">
          {r && (
            <TableDiagram
              geo={r}
              seatView={seatView}
              center={!between && <div className="felt-labels"><span className="felt-caption">{spoons} SPOONS · CENTER PILE</span></div>}
            />
          )}
        </div>
        {r && (
          <p className="stage-caption always">
            {spoons} spoon{spoons === 1 ? '' : 's'}
            {between ? '' : ' in a center pile'}
            {between && r.empty_gap && <> · <b>empty gap: {seatName(r.empty_gap.seats[0])} &amp; {seatName(r.empty_gap.seats[1])}</b></>}
            {' · '}
            <b>{r.dealers.length > 1 ? `dealers: ${seatName(r.dealers[0])} & ${seatName(r.dealers[1])}` : `dealer: ${seatName(r.dealers[0])}`}</b>
          </p>
        )}
        <StageCards now={now} />
      </div>

      <Panel now={now} spoons={spoons} actions={actions} onAdd={() => setSheet('add')} onTable={() => setSheet('table')} />

      {actions.sheet}
      {sheet === 'table' && <ChangeTable onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddPlayerSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

function Panel({ now, spoons, actions, onAdd, onTable }: {
  now: number; spoons: number; actions: ReturnType<typeof usePlayerActions>; onAdd: () => void; onTable: () => void
}) {
  const { state, act, pending, name } = useT()
  const live = actions.live
  const waitingStalemate = state.open_stalemates.find((sm) => sm.started_at == null)
  const r = state.round
  const paused = r?.paused_since != null && !r?.ended
  const recent = [...state.timeline]
    .reverse()
    .filter((e) => e.group > 1 && !['RoundStarted', 'RoundEnded', 'DivisionStarted', 'StageCreated'].includes(e.type))
    .slice(0, 4)
  const outs = state.players
    .filter((p) => (p.status === 'out' || p.status === 'dq') && p.division_id === state.active_division_id)
    .sort((a, b) => (b.out_round ?? 0) - (a.out_round ?? 0))
  const dot = (t: string) =>
    t === 'PlayerEliminated' ? 'var(--brick)' : t.startsWith('Stalemate') ? 'var(--sea)' : t === 'PenaltyLogged' ? 'var(--accent-text)' : 'var(--muted)'

  return (
    <aside className="panel" aria-label="Round controls">
      {/* One button for the clock: start the round, then start any stalemate, else stoppages. */}
      {live && r && r.play_started_at == null ? (
        <button className="btn btn-primary" disabled={pending} onClick={() => act({ type: 'start_play' })}>
          <Icon name="play" size={18} strokeWidth={2} /> Start round
        </button>
      ) : live && waitingStalemate ? (
        <button className="btn btn-sea" disabled={pending}
          onClick={() => act({ type: 'start_play', stalemate_id: waitingStalemate.id })}>
          <Icon name="play" size={18} strokeWidth={2} /> Start stalemate
        </button>
      ) : (
        <button className={`btn ${paused ? 'btn-primary' : 'btn-ghost'}`} disabled={!live || pending}
          onClick={() => act({ type: paused ? 'end_stoppage' : 'start_stoppage' })}>
          <Icon name={paused ? 'play' : 'pause'} size={18} strokeWidth={2} />
          {paused ? 'Resume play' : 'Call stoppage'}
        </button>
      )}
      <div className="stack-tight">
        <h2 className="round-title">{r ? r.name.toUpperCase() : 'NO ROUND'}</h2>
        {r && <span className="muted">{r.ended ? 'Round over' : r.play_started_at == null ? `Seats drawn ${agoText(now - r.started_at)} · press Start round` : `Started ${agoText(now - r.play_started_at)}`}</span>}
      </div>
      <div className="stats">
        <div><b>{remaining(state)}</b><span>Remaining</span></div>
        <div><b>{r && !r.ended ? spoons : '—'}</b><span>Spoons</span></div>
        <div><b>{r ? fmtDuration(roundElapsed(r, now)) : '—'}</b><span>Round time</span></div>
      </div>
      <button className="btn btn-primary btn-xl" disabled={!live || pending || state.open_stalemates.length > 0}
        onClick={() => actions.setAction({ kind: 'out' })}>
        <Icon name="out" strokeWidth={2} /> Mark player out
      </button>
      {state.open_stalemates.length > 0 && live && <p className="muted small">Resolve the open stalemate before marking anyone out.</p>}
      <div className="grid-2">
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => actions.setAction({ kind: 'stalemate', ids: [] })}>Stalemate</button>
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => actions.setAction({ kind: 'penalty' })}>Penalty</button>
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => act({ type: 'reroll' })}>Re-roll seats</button>
        <button className="btn btn-surface" disabled={state.tournament.completed || pending} onClick={onAdd}>Add player</button>
        <button className="btn btn-surface span-2" disabled={state.tournament.completed || pending} onClick={onTable}>Change table</button>
      </div>
      {live && r && <p className="muted small">Marking someone out ends the round and seats {state.next_division_id ? `Division ${divisionLabel(state, state.next_division_id)} next` : `the rest for Round ${r.n + 1}`}.</p>}
      <div className="sep" />
      <div className="row baseline">
        <h3 className="section-label grow">RECENT</h3>
        <Link to="../timeline" relative="path" className="link small">Timeline →</Link>
      </div>
      <ul className="recent">
        {recent.map((e) => (
          <li key={e.seq}>
            <span className="dot" style={{ background: dot(e.type) }} />
            <span className="grow">{e.label}</span>
            {e.round_no != null && <span className="muted small">{roundShort(state.round_names, e.round_no)}</span>}
          </li>
        ))}
      </ul>
      <div className="grow" />
      {outs.length > 0 && (
        <div className="out-box">
          <b>Out:</b>{' '}
          {outs.map((p) => {
            const tag = [p.status === 'dq' ? 'DQ' : null, p.out_round != null ? roundShort(state.round_names, p.out_round) : null].filter(Boolean).join(' ')
            return tag ? `${name(p.id)} (${tag})` : name(p.id)
          }).join(' · ')}
        </div>
      )}
    </aside>
  )
}

function NotStarted({ onAdd, sheet, closeSheet }: { onAdd: () => void; sheet: string | null; closeSheet: () => void }) {
  const { state, act, pending } = useT()
  const [changing, setChanging] = useState(false)
  const alive = state.players.filter((p) => p.status !== 'withdrawn')
  const pv = usePreview(alive.length, state.table_config)
  return (
    <div className="live">
      <div className="stage stage-setup">
        <TablePreview preview={alive.length >= 2 ? pv.data : undefined} />
      </div>
      <aside className="panel">
        <h2 className="round-title">READY TO START</h2>
        <p className="muted">{alive.length} players · {tableSummary(state.table_config)}</p>
        {pv.data?.uses_divisions && 'sizes' in pv.data.stage_plan[0] && (
          <p>
            <b>{pv.data.stage_plan[0].sizes.length} divisions</b> of {pv.data.stage_plan[0].sizes.join(' / ')} players,
            drawn at random when you press Start.
          </p>
        )}
        {pv.data && !pv.data.fits && <p className="bad-text">This table is too small. Change it before starting.</p>}
        <button className="btn btn-primary btn-xl" disabled={pending || alive.length < 2 || pv.data?.fits === false}
          onClick={() => act({ type: 'start' })}>
          Start tournament
        </button>
        <div className="grid-2">
          <button className="btn btn-surface" onClick={() => setChanging(true)}>Change table</button>
          <button className="btn btn-surface" onClick={onAdd}>Add player</button>
        </div>
        <ul className="roster">
          {alive.map((p) => <li key={p.id}>{p.name}</li>)}
        </ul>
      </aside>
      {changing && <ChangeTable onClose={() => setChanging(false)} />}
      {sheet === 'add' && <AddPlayerSheet onClose={closeSheet} />}
    </div>
  )
}

import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Player, RoundNames } from '../api/types'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { divisionLabel, PENALTIES, placeLabel, roundShort } from '../state/describe'
import { StageCards } from './live/Cards'
import { usePlayerActions } from './live/PlayerActions'
import { useNow, useServerOffset } from './live/Timer'
import { useT } from '../state/tournament'
import { clock } from './Timeline'

const ALIVE = new Set(['in', 'waiting', 'advanced'])
const STATUS: Record<string, string> = {
  in: 'Playing', waiting: 'Waiting', advanced: 'Advanced', out: 'Out', dq: 'DQ', withdrawn: 'Withdrew',
}

function statusText(p: Player, names: RoundNames) {
  if ((p.status === 'out' || p.status === 'dq') && p.out_round != null) return `${STATUS[p.status]} · ${roundShort(names, p.out_round)}`
  return STATUS[p.status]
}

function penaltySummary(p: Player) {
  return PENALTIES.filter((k) => p.penalties[k.kind]).map((k) => `${k.label} ×${p.penalties[k.kind]}`).join(', ')
}

/** Alive players first (by name), then everyone else by finishing place. */
function order(a: Player, b: Player) {
  const aa = ALIVE.has(a.status), ba = ALIVE.has(b.status)
  if (aa !== ba) return aa ? -1 : 1
  if (aa) return a.name.localeCompare(b.name)
  return (a.finish_place ?? 999) - (b.finish_place ?? 999) || a.name.localeCompare(b.name)
}

export function Players() {
  const { state, pending } = useT()
  const now = useNow(useServerOffset(state.server_now))
  const actions = usePlayerActions()
  const [search, setSearch] = useState('')
  const [params] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(params.get('open')) // from Bracket/Report links
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const done = state.tournament.completed
  const needle = search.trim().toLowerCase()
  const players = [...state.players].filter((p) => !needle || p.name.toLowerCase().includes(needle)).sort(order)
  const alive = state.players.filter((p) => ALIVE.has(p.status)).length

  return (
    <div className="page page-wide players-page">
      <header className="page-head">
        <h1 className="page-title grow">Players</h1>
        <span className="muted">{alive} still in · {state.players.length} total</span>
        <label className="sr-only" htmlFor="psearch">Search players</label>
        <input id="psearch" className="input search" type="search" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-primary" disabled={done || pending} onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add player
        </button>
      </header>

      {state.tournament.started && <StageCards now={now} />}

      <ul className="player-list">
        {players.map((p) => {
          const isOpen = openId === p.id
          const history = state.timeline.filter((e) => e.player_ids?.includes(p.id))
          const live = ALIVE.has(p.status)
          return (
            <li key={p.id} className={`player-row${live ? '' : ' gone'}`}>
              <button className="player-main" onClick={() => setOpenId(isOpen ? null : p.id)} aria-expanded={isOpen}>
                <span className="player-place">{placeLabel(p, state.round_names) || '—'}</span>
                <span className="player-name">{p.name}</span>
                {p.id === state.tournament.champion_id ? (
                  <span className="status-chip s-advanced">Champion</span>
                ) : (
                  <span className={`status-chip s-${p.status}`}>{statusText(p, state.round_names)}</span>
                )}
                {p.division_id && state.tournament.uses_divisions && (
                  <span className="muted small hide-narrow">
                    {p.division_id === 'final' ? 'Final' : `Div ${divisionLabel(state, p.division_id)}`}
                  </span>
                )}
                <span className="grow muted small player-pen">{penaltySummary(p)}</span>
                <span className="muted" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && (
                <div className="player-detail">
                  {live && !done && (
                    <div className="grid-3">
                      <button className="btn btn-primary" disabled={!actions.canOut(p)} onClick={() => actions.markOut(p)}>Out</button>
                      <button className="btn btn-surface" disabled={!actions.canStalemate(p)}
                        onClick={() => actions.setAction({ kind: 'stalemate', ids: [p.id] })}>Stalemate</button>
                      <button className="btn btn-surface" disabled={!actions.canPenalty(p)}
                        onClick={() => actions.setAction({ kind: 'penalty', player: p })}>Penalty</button>
                    </div>
                  )}
                  <div className="grid-3">
                    {live && !done && (
                      <>
                        <button className="btn btn-ghost danger-text" disabled={pending} onClick={() => actions.eject(p)}>Eject</button>
                        <button className="btn btn-ghost" disabled={pending} onClick={() => actions.withdraw(p)}>Withdraw</button>
                      </>
                    )}
                    <button className="btn btn-surface" disabled={pending} onClick={() => setEditing(p)}>Rename</button>
                  </div>
                  {live && !done && !actions.isSeated(p) && (
                    <p className="muted small">{p.name} isn’t at the table this round, so Out and Stalemate are off.</p>
                  )}
                  <h3 className="section-label">HISTORY</h3>
                  {history.length === 0 ? (
                    <p className="muted small">Nothing yet.</p>
                  ) : (
                    <ol className="history">
                      {history.map((e) => (
                        <li key={e.seq}>
                          <span className="muted small">{clock(e.at)}{e.round_no != null ? ` · ${roundShort(state.round_names, e.round_no)}` : ''}</span>
                          <span>{e.label}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {editing && <Rename player={editing} onClose={() => setEditing(null)} />}
      {adding && <AddPlayerSheet onClose={() => setAdding(false)} />}
      {actions.sheet}
    </div>
  )
}

function Rename({ player, onClose }: { player: Player; onClose: () => void }) {
  const { act, pending } = useT()
  const [n, setN] = useState(player.name)
  return (
    <Sheet title={`Rename ${player.name}`} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await act({ type: 'rename_player', player_id: player.id, name: n })) onClose() }}>
        <input className="input input-lg" autoFocus value={n} onChange={(e) => setN(e.target.value)} aria-label="New name" />
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={pending || !n.trim() || n.trim() === player.name}>Rename</button>
        </div>
      </form>
    </Sheet>
  )
}

export function AddPlayerSheet({ onClose }: { onClose: () => void }) {
  const { act, pending, state } = useT()
  const [n, setN] = useState('')
  const where = !state.tournament.started
    ? 'They join the draw when you start.'
    : state.tournament.uses_divisions
      ? 'They go into the first division that hasn’t started and has room, otherwise the next stage’s draw.'
      : 'They join the table at the next seating.'
  return (
    <Sheet title="Add player" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (n.trim() && (await act({ type: 'add_player', name: n }))) onClose() }}>
        <label className="field">
          <span className="section-label">NAME</span>
          <input className="input input-lg" autoFocus value={n} onChange={(e) => setN(e.target.value)} />
        </label>
        <p className="muted small">{where}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!n.trim() || pending}>Add player</button>
        </div>
      </form>
    </Sheet>
  )
}

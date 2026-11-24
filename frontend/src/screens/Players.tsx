import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { Player } from '../api/types'
import { useConfirm } from '../components/Confirm'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { divisionLabel, PENALTIES, placeLabel } from '../state/describe'
import { useT } from '../state/tournament'
import { clock } from './Timeline'

const ALIVE = new Set(['in', 'waiting', 'advanced'])
const STATUS: Record<string, string> = {
  in: 'Playing', waiting: 'Waiting', advanced: 'Advanced', out: 'Out', dq: 'DQ', withdrawn: 'Withdrew',
}

function statusText(p: Player) {
  if ((p.status === 'out' || p.status === 'dq') && p.out_round != null) return `${STATUS[p.status]} · R${p.out_round}`
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
  const { state, act, pending } = useT()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [params] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(params.get('open')) // from Bracket/Report links
  const [editing, setEditing] = useState<Player | null>(null)
  const [penaltyFor, setPenaltyFor] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const done = state.tournament.completed
  const needle = search.trim().toLowerCase()
  const players = [...state.players].filter((p) => !needle || p.name.toLowerCase().includes(needle)).sort(order)
  const alive = state.players.filter((p) => ALIVE.has(p.status)).length

  const disqualify = async (p: Player) => {
    if (await confirm({ title: `Disqualify ${p.name}?`, body: 'They are removed from the tournament.', confirmLabel: 'Disqualify', destructive: true }))
      act({ type: 'disqualify', player_id: p.id })
  }

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

      <ul className="player-list">
        {players.map((p) => {
          const isOpen = openId === p.id
          const history = state.timeline.filter((e) => e.player_ids?.includes(p.id))
          const live = ALIVE.has(p.status)
          return (
            <li key={p.id} className={`player-row${live ? '' : ' gone'}`}>
              <button className="player-main" onClick={() => setOpenId(isOpen ? null : p.id)} aria-expanded={isOpen}>
                <span className="player-place">{placeLabel(p) || '—'}</span>
                <span className="player-name">{p.name}</span>
                {p.id === state.tournament.champion_id ? (
                  <span className="status-chip s-advanced">Champion</span>
                ) : (
                  <span className={`status-chip s-${p.status}`}>{statusText(p)}</span>
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
                  <div className="row small-gap">
                    <button className="btn btn-surface" disabled={pending} onClick={() => setEditing(p)}>Rename</button>
                    {live && !done && (
                      <>
                        <button className="btn btn-surface" disabled={pending} onClick={() => setPenaltyFor(p)}>Log penalty</button>
                        <button className="btn btn-ghost" disabled={pending} onClick={() => act({ type: 'withdraw', player_id: p.id })}>Withdraw</button>
                        <button className="btn btn-ghost danger-text" disabled={pending} onClick={() => disqualify(p)}>Disqualify…</button>
                      </>
                    )}
                  </div>
                  <h3 className="section-label">HISTORY</h3>
                  {history.length === 0 ? (
                    <p className="muted small">Nothing yet.</p>
                  ) : (
                    <ol className="history">
                      {history.map((e) => (
                        <li key={e.seq}>
                          <span className="muted small">{clock(e.at)}{e.round_no != null ? ` · R${e.round_no}` : ''}</span>
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
      {penaltyFor && (
        <Sheet title={`Penalty for ${penaltyFor.name}`} onClose={() => setPenaltyFor(null)}>
          <div className="list">
            {PENALTIES.map((k) => (
              <button
                key={k.kind}
                className="list-row"
                disabled={pending}
                onClick={async () => {
                  const p = penaltyFor
                  setPenaltyFor(null)
                  if (state.rules.immediate_dq.includes(k.kind)) {
                    const ok = await confirm({ title: `Disqualify ${p.name}?`, body: `${k.label} is an immediate disqualification.`, confirmLabel: 'Log and disqualify', destructive: true })
                    if (!ok) return
                  }
                  act({ type: 'log_penalty', player_id: p.id, kind: k.kind })
                }}
              >
                <span className="grow">{k.label}</span>
                <span className="muted small">
                  {penaltyFor.penalties[k.kind] ? `×${penaltyFor.penalties[k.kind]} · ` : ''}{k.rule}
                  {state.rules.immediate_dq.includes(k.kind) ? ' · DQ' : ''}
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
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

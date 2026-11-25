import { useState } from 'react'
import type { Player } from '../../api/types'
import { useConfirm } from '../../components/Confirm'
import { Sheet } from '../../components/Sheet'
import { PENALTIES } from '../../state/describe'
import { useT } from '../../state/tournament'

/** What the organiser is in the middle of: a player list to pick from, or a penalty to choose. */
export type Action =
  | { kind: 'out' }
  | { kind: 'stalemate'; ids: string[] }
  | { kind: 'penalty'; player?: Player }
  | { kind: 'winner'; out: Player; stalemate?: string } // second step of an out: who won the round?
  | null

const ALIVE = new Set(['in', 'waiting', 'advanced'])

/** Player actions shared by the Live controls and the Players tab. Render `sheet` once. */
export function usePlayerActions() {
  const { state, act, pending } = useT()
  const confirm = useConfirm()
  const [action, setAction] = useState<Action>(null)
  const r = state.round
  const live = !!r && !r.ended && !state.tournament.completed
  const byId = new Map(state.players.map((p) => [p.id, p]))
  // Players at the table this round, in seat order.
  const seated = live ? r.seats.map((s) => byId.get(s.player_id ?? '')).filter((p): p is Player => p?.status === 'in') : []
  const busy = new Set(state.open_stalemates.flatMap((s) => s.player_ids))

  const isSeated = (p: Player) => seated.includes(p)
  const canOut = (p: Player) => isSeated(p) && !state.open_stalemates.length && !pending
  const canStalemate = (p: Player) => isSeated(p) && !busy.has(p.id) && !pending
  const canPenalty = (p: Player) => live && ALIVE.has(p.status) && !pending

  // Marking out is two taps: who's out, then who won the round. Naming the winner (or
  // "not recorded") confirms it, so a slip on the first list can still be cancelled.
  const markOut = (p: Player) => setAction({ kind: 'winner', out: p })
  // A lost stalemate is an out too (rule 2.2.2): same question, then the stalemate is resolved.
  const loseStalemate = (stalemate: string, p: Player) => setAction({ kind: 'winner', out: p, stalemate })
  const finishOut = async (p: Player, winner: Player | null, stalemate?: string) => {
    setAction(null)
    const won = winner ? { winner_id: winner.id } : {}
    await act(stalemate
      ? { type: 'resolve_stalemate', stalemate_id: stalemate, loser_id: p.id, ...won }
      : { type: 'mark_out', player_id: p.id, ...won })
  }

  const logPenalty = async (p: Player, kind: string) => {
    setAction(null)
    if (state.rules.immediate_dq.includes(kind)) {
      const label = PENALTIES.find((x) => x.kind === kind)?.label
      const ok = await confirm({
        title: `Eject ${p.name}?`,
        body: `${label} means an immediate ejection (disqualification). Play carries on without them.`,
        confirmLabel: 'Log and eject',
        destructive: true,
      })
      if (!ok) return
    }
    await act({ type: 'log_penalty', player_id: p.id, kind })
  }

  const eject = async (p: Player) => {
    const ok = await confirm({
      title: `Eject ${p.name}?`,
      body: 'They are disqualified and removed from the tournament. Play carries on without them.',
      confirmLabel: 'Eject',
      destructive: true,
    })
    if (ok) await act({ type: 'disqualify', player_id: p.id })
  }

  const withdraw = async (p: Player) => {
    const ok = await confirm({
      title: `Withdraw ${p.name}?`,
      body: 'They leave the tournament. Play carries on without them.',
      confirmLabel: 'Withdraw',
      destructive: true,
    })
    if (ok) await act({ type: 'withdraw', player_id: p.id })
  }

  const close = () => setAction(null)
  let sheet = null
  if (action?.kind === 'out') {
    sheet = (
      <Sheet title="Who's out?" onClose={close}>
        <PlayerList players={seated} onPick={markOut} />
      </Sheet>
    )
  } else if (action?.kind === 'winner') {
    const p = action.out
    const sm = action.stalemate
    sheet = (
      <Sheet title={sm ? `${p.name} lost the stalemate` : `${p.name} is out`} onClose={close}>
        <p className="muted">
          {sm ? `${p.name} is out. ` : ''}Who won {r?.name} (got four of a kind)? This ends the round.
        </p>
        <PlayerList players={seated.filter((x) => x.id !== p.id)} onPick={(w) => finishOut(p, w, sm)} />
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-surface" disabled={pending} onClick={() => finishOut(p, null, sm)}>Not recorded</button>
        </div>
      </Sheet>
    )
  } else if (action?.kind === 'stalemate') {
    const ids = action.ids
    const toggle = (p: Player) =>
      setAction({ kind: 'stalemate', ids: ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id] })
    sheet = (
      <Sheet title="Stalemate: who's in it?" onClose={close}>
        <PlayerList players={seated.filter((p) => !busy.has(p.id))} selected={ids} onPick={toggle} />
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-sea" disabled={ids.length < 2 || pending}
            onClick={async () => { close(); await act({ type: 'open_stalemate', player_ids: ids }) }}>
            Open stalemate{ids.length >= 2 ? ` (${ids.length})` : ''}
          </button>
        </div>
      </Sheet>
    )
  } else if (action?.kind === 'penalty' && !action.player) {
    sheet = (
      <Sheet title="Penalty for…" onClose={close}>
        <PlayerList players={seated} onPick={(p) => setAction({ kind: 'penalty', player: p })} />
      </Sheet>
    )
  } else if (action?.kind === 'penalty' && action.player) {
    const p = action.player
    sheet = (
      <Sheet title={`Penalty for ${p.name}`} onClose={close}>
        <div className="list">
          {PENALTIES.map((k) => (
            <button key={k.kind} className="list-row" disabled={pending} onClick={() => logPenalty(p, k.kind)}>
              <span className="grow">{k.label}</span>
              <span className="muted small">
                {p.penalties[k.kind] ? `×${p.penalties[k.kind]} · ` : ''}{k.rule}
                {state.rules.immediate_dq.includes(k.kind) ? ' · ejection' : ''}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    )
  }

  return { setAction, sheet, markOut, loseStalemate, eject, withdraw, isSeated, canOut, canStalemate, canPenalty, live }
}

function PlayerList({ players, selected, onPick }: { players: Player[]; selected?: string[]; onPick: (p: Player) => void }) {
  const { state } = useT()
  const seatOf = new Map(state.round?.seats.map((s) => [s.player_id, s.seat_no]))
  if (!players.length) return <p className="muted">Nobody to pick right now.</p>
  return (
    <div className="list pick-list">
      {players.map((p) => {
        const on = selected?.includes(p.id)
        return (
          <button key={p.id} className={`list-row${on ? ' picked' : ''}`} aria-pressed={selected ? on : undefined} onClick={() => onPick(p)}>
            <span className="pick-seat">{seatOf.get(p.id) ?? '—'}</span>
            <span className="grow">{p.name}</span>
            {selected && <span aria-hidden="true">{on ? '✓' : ''}</span>}
          </button>
        )
      })}
    </div>
  )
}

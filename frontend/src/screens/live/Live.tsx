import { useState } from 'react'
import { Link } from 'react-router'
import type { Player } from '../../api/types'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { TableDiagram, type SeatView } from '../../components/TableDiagram'
import { TablePreview, usePreview } from '../../components/TableStep'
import { fmtDuration, PENALTIES, remaining } from '../../state/describe'
import { useT } from '../../state/tournament'
import { AddPlayerSheet } from '../Players'
import { StageCards } from './Cards'
import { ChangeTable, tableSummary } from './ChangeTable'
import { agoText, roundElapsed, useNow, useServerOffset } from './Timer'

type Mode =
  | { kind: 'menu'; seat: number }
  | { kind: 'penalty'; seat: number }
  | { kind: 'pick'; action: 'out' | 'penalty' }
  | { kind: 'stalemate'; ids: string[] }
  | { kind: 'swap'; from: number }
  | null

export function Live() {
  const { state, act, pending, name } = useT()
  const confirm = useConfirm()
  const offset = useServerOffset(state.server_now)
  const now = useNow(offset)
  const [mode, setMode] = useState<Mode>(null)
  const [sheet, setSheet] = useState<'table' | 'add' | null>(null)

  const r = state.round
  const live = !!r && !r.ended && !state.tournament.completed
  const byId = new Map(state.players.map((p) => [p.id, p]))
  const seatPlayer = (seatNo: number): Player | undefined => {
    const pid = r?.seats[seatNo - 1]?.player_id
    return pid ? byId.get(pid) : undefined
  }
  const inStalemate = new Set(state.open_stalemates.flatMap((s) => s.player_ids))

  if (!state.tournament.started) return <NotStarted onAdd={() => setSheet('add')} sheet={sheet} closeSheet={() => setSheet(null)} />

  const seatView = (seatNo: number): SeatView => {
    const p = seatPlayer(seatNo)
    if (!p) return {}
    const selected =
      (mode?.kind === 'menu' || mode?.kind === 'penalty') && mode.seat === seatNo
        ? true
        : mode?.kind === 'stalemate' ? mode.ids.includes(p.id) : mode?.kind === 'swap' && mode.from === seatNo
    const penalties = Object.values(p.penalties).reduce((a, b) => a + b, 0)
    const dealer = r?.dealers[0] === seatNo ? 'D' : r?.dealers[1] === seatNo ? 'D2' : undefined
    return {
      name: p.name,
      tag: dealer,
      dim: p.status !== 'in',
      ring: selected ? 'gold' : p.status === 'dq' ? 'brick' : inStalemate.has(p.id) ? 'sea' : undefined,
      badge: penalties,
      disabled: !live || pending || p.status !== 'in',
      label: `Seat ${seatNo}, ${p.name}${dealer ? (dealer === 'D' ? ', dealer' : ', second dealer') : ''}${p.status !== 'in' ? ` (${p.status})` : ''}${penalties ? `, ${penalties} penalties` : ''}`,
    }
  }

  const onSeat = async (seatNo: number) => {
    const p = seatPlayer(seatNo)
    if (!p || !live) return
    if (mode?.kind === 'pick' && mode.action === 'out') {
      setMode(null) // leave pick mode on tap, not on response: seats reshuffle after an out
      await act({ type: 'mark_out', player_id: p.id })
    } else if (mode?.kind === 'pick' && mode.action === 'penalty') {
      setMode({ kind: 'penalty', seat: seatNo })
    } else if (mode?.kind === 'stalemate') {
      const ids = mode.ids.includes(p.id) ? mode.ids.filter((x) => x !== p.id) : [...mode.ids, p.id]
      setMode({ kind: 'stalemate', ids })
    } else if (mode?.kind === 'swap') {
      setMode(null)
      if (seatNo !== mode.from) await act({ type: 'swap_seats', seat_a: mode.from, seat_b: seatNo })
    } else {
      setMode((m) => (m?.kind === 'menu' && m.seat === seatNo ? null : { kind: 'menu', seat: seatNo }))
    }
  }

  const logPenalty = async (p: Player, kind: string) => {
    setMode(null)
    if (state.rules.immediate_dq.includes(kind)) {
      const label = PENALTIES.find((x) => x.kind === kind)?.label
      const ok = await confirm({
        title: `Disqualify ${p.name}?`,
        body: `${label} is an immediate disqualification. The round carries on without them.`,
        confirmLabel: 'Log and disqualify',
        destructive: true,
      })
      if (!ok) return
    }
    await act({ type: 'log_penalty', player_id: p.id, kind })
  }

  const disqualify = async (p: Player) => {
    setMode(null)
    const ok = await confirm({
      title: `Disqualify ${p.name}?`,
      body: 'They are removed from the tournament. The round carries on without them.',
      confirmLabel: 'Disqualify',
      destructive: true,
    })
    if (ok) await act({ type: 'disqualify', player_id: p.id })
  }

  const menuSeat = mode?.kind === 'menu' || mode?.kind === 'penalty' ? mode.seat : null
  const menuPlayer = menuSeat ? seatPlayer(menuSeat) : undefined
  const spoons = r?.spoons.length ?? 0
  const between = r?.table.spoon_layout === 'between'

  const banner =
    mode?.kind === 'pick' ? (mode.action === 'out' ? "Tap the player who's out" : 'Tap the player who gets the penalty')
      : mode?.kind === 'stalemate' ? (mode.ids.length ? `Stalemate: ${mode.ids.map(name).join(' vs. ')}` : 'Tap the players in the stalemate')
        : mode?.kind === 'swap' ? `Tap the seat to swap with seat ${mode.from}` : null

  return (
    <div className={`live${pending ? ' busy' : ''}`}>
      <div className="stage" onClick={(e) => e.target === e.currentTarget && setMode(null)}>
        <div className="stage-top">
          {banner ? (
            <div className="mode-bar" role="status">
              <span className="grow">{banner}</span>
              {mode?.kind === 'stalemate' && (
                <button
                  className="btn btn-sea"
                  disabled={mode.ids.length < 2 || pending}
                  onClick={async () => { const ids = mode.ids; setMode(null); await act({ type: 'open_stalemate', player_ids: ids }) }}
                >
                  Open stalemate
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button>
            </div>
          ) : r?.paused_since != null && !r.ended ? (
            <div className="stoppage-banner" role="status">STOPPAGE — play is paused</div>
          ) : (
            <div className="grow" />
          )}
          <button className="table-chip" onClick={() => setSheet('table')} disabled={state.tournament.completed}>
            <span className="hide-narrow">{tableSummary(state.table_config)}</span>
            <span className="table-chip-btn">Change table</span>
          </button>
        </div>
        <div
          className="stage-table"
          onClick={(e) => {
            // Tapping empty table space closes the seat menu (not pick modes: those have Cancel).
            if (!(e.target as HTMLElement).closest('button, .popover') && (mode?.kind === 'menu' || mode?.kind === 'penalty'))
              setMode(null)
          }}
        >
        {r && (
          <TableDiagram
            geo={r}
            seatView={seatView}
            onSeat={onSeat}
            center={
              <div className="felt-labels">
                <span className="felt-corner">↻ CLOCKWISE FROM SEAT 1</span>
                {!between && <span className="felt-caption">{spoons} SPOONS · CENTER PILE</span>}
              </div>
            }
            overlay={(placed) => {
              if (!menuSeat || !menuPlayer) return null
              const s = placed.seats.find((x) => x.seat_no === menuSeat)
              if (!s) return null
              const below = s.y < placed.table.y + placed.table.h / 2
              const top = below ? s.y + 52 : undefined
              const bottom = below ? undefined : placed.box.h - s.y + 36
              const style = {
                left: Math.max(8, Math.min(s.x - 125, placed.box.w - 258)),
                top,
                bottom,
                maxHeight: Math.max(200, below ? placed.box.h - (top ?? 0) - 8 : s.y - 36 - 8),
              }
              return (
                <SeatMenu
                  style={style}
                  seat={menuSeat}
                  player={menuPlayer}
                  penaltyMode={mode?.kind === 'penalty'}
                  immediateDq={state.rules.immediate_dq}
                  onClose={() => setMode(null)}
                  onOut={async () => { setMode(null); await act({ type: 'mark_out', player_id: menuPlayer.id }) }}
                  onStalemate={() => setMode({ kind: 'stalemate', ids: [menuPlayer.id] })}
                  onPenaltyMenu={() => setMode({ kind: 'penalty', seat: menuSeat })}
                  onPenalty={(k) => logPenalty(menuPlayer, k)}
                  onDisqualify={() => disqualify(menuPlayer)}
                  onSwap={() => setMode({ kind: 'swap', from: menuSeat })}
                  onWithdraw={async () => { setMode(null); await act({ type: 'withdraw', player_id: menuPlayer.id }) }}
                  outBlocked={state.open_stalemates.length > 0}
                />
              )
            }}
          />
        )}
        </div>
        {r && (
          <p className="stage-caption always">
            ↻ Clockwise from seat 1 · {spoons} spoons ·{' '}
            {between && r.empty_gap ? (
              <>between players · <b>empty gap this round: seats {r.empty_gap.seats[0]} &amp; {r.empty_gap.seats[1]}</b></>
            ) : 'center pile'}
            {' · '}
            <b>{r.dealers.length > 1 ? `dealers: seats ${r.dealers[0]} & ${r.dealers[1]}` : `dealer: seat ${r.dealers[0]}`}</b>
          </p>
        )}
        <StageCards now={now} />
      </div>

      <Panel
        now={now}
        live={live}
        spoons={spoons}
        onMode={setMode}
        onAdd={() => setSheet('add')}
      />

      {sheet === 'table' && <ChangeTable onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddPlayerSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

function SeatMenu(props: {
  style: React.CSSProperties
  seat: number
  player: Player
  penaltyMode: boolean
  immediateDq: string[]
  outBlocked: boolean
  onClose: () => void
  onOut: () => void
  onStalemate: () => void
  onPenaltyMenu: () => void
  onPenalty: (kind: string) => void
  onDisqualify: () => void
  onSwap: () => void
  onWithdraw: () => void
}) {
  const p = props.player
  return (
    <div role="menu" aria-label={`Actions for seat ${props.seat}, ${p.name}`} className="popover" style={props.style}>
      <div className="popover-head">
        <span className="popover-name">{p.name}</span>
        <span className="muted small">Seat {props.seat}</span>
      </div>
      {!props.penaltyMode ? (
        <>
          <button role="menuitem" className="menu-item" onClick={props.onOut} disabled={props.outBlocked}
            title={props.outBlocked ? 'Resolve the open stalemate first' : undefined}>
            <Icon name="out" /> Mark out
          </button>
          <button role="menuitem" className="menu-item" onClick={props.onStalemate}>
            <Icon name="stalemate" /> Stalemate with…
          </button>
          <button role="menuitem" className="menu-item" onClick={props.onPenaltyMenu}>
            <Icon name="flag" /> <span className="grow">Log penalty</span><span aria-hidden="true" className="muted">›</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={props.onSwap}>
            <Icon name="swap" /> Swap seat
          </button>
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item danger" onClick={props.onWithdraw}>
            <Icon name="withdraw" /> Withdraw from tournament
          </button>
        </>
      ) : (
        <>
          {PENALTIES.map((k) => {
            const n = p.penalties[k.kind] ?? 0
            return (
              <button key={k.kind} role="menuitem" className="menu-item" onClick={() => props.onPenalty(k.kind)}>
                <span className="grow">{k.label}</span>
                <span className="muted small">{n ? `×${n} · ` : ''}{k.rule}{props.immediateDq.includes(k.kind) ? ' · DQ' : ''}</span>
              </button>
            )
          })}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item danger" onClick={props.onDisqualify}>
            <Icon name="out" /> Disqualify…
          </button>
        </>
      )}
    </div>
  )
}

function Panel({ now, live, spoons, onMode, onAdd }: {
  now: number; live: boolean; spoons: number; onMode: (m: Mode) => void; onAdd: () => void
}) {
  const { state, act, pending, name } = useT()
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
      <button className={`btn ${paused ? 'btn-primary' : 'btn-ghost'}`} disabled={!live || pending}
        onClick={() => act({ type: paused ? 'end_stoppage' : 'start_stoppage' })}>
        <Icon name={paused ? 'play' : 'pause'} size={18} strokeWidth={2} />
        {paused ? 'Resume play' : 'Call stoppage'}
      </button>
      <div className="stack-tight">
        <h2 className="round-title">{r ? `ROUND ${r.no}` : 'NO ROUND'}</h2>
        {r && <span className="muted">{r.ended ? 'Round over' : `Seats generated ${agoText(now - r.started_at)}`}</span>}
      </div>
      <div className="stats">
        <div><b>{remaining(state)}</b><span>Remaining</span></div>
        <div><b>{r && !r.ended ? spoons : '—'}</b><span>Spoons</span></div>
        <div><b>{r ? fmtDuration(roundElapsed(r, now)) : '—'}</b><span>Round time</span></div>
      </div>
      <button className="btn btn-primary btn-xl" disabled={!live || pending || state.open_stalemates.length > 0}
        onClick={() => onMode({ kind: 'pick', action: 'out' })}>
        <Icon name="out" strokeWidth={2} /> Mark player out
      </button>
      {state.open_stalemates.length > 0 && live && <p className="muted small">Resolve the open stalemate before marking anyone out.</p>}
      <div className="grid-2">
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => onMode({ kind: 'stalemate', ids: [] })}>Stalemate</button>
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => onMode({ kind: 'pick', action: 'penalty' })}>Penalty</button>
        <button className="btn btn-surface" disabled={!live || pending} onClick={() => act({ type: 'reroll' })}>Re-roll seats</button>
        <button className="btn btn-surface" disabled={state.tournament.completed || pending} onClick={onAdd}>Add player</button>
      </div>
      {live && r && <p className="muted small">Marking someone out ends the round and seats the rest for Round {r.no + 1}.</p>}
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
            {e.round_no != null && <span className="muted small">R{e.round_no}</span>}
          </li>
        ))}
      </ul>
      <div className="grow" />
      {outs.length > 0 && (
        <div className="out-box">
          <b>Out:</b>{' '}
          {outs.map((p) => {
            const tag = [p.status === 'dq' ? 'DQ' : null, p.out_round != null ? `R${p.out_round}` : null].filter(Boolean).join(' ')
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

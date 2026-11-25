import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { useConfirm } from '../../components/Confirm'
import { activeDivision, currentStage, divisionLabel } from '../../state/describe'
import { useT } from '../../state/tournament'
import { usePlayerActions } from './PlayerActions'
import { Elapsed } from './Timer'

/** Rule 2.2.2 (2026): the player left without a spoon loses the stalemate, and with it the
 *  round: they're out. Two players read more naturally as "X wins" (the other is out); three or
 *  more as "X left without a spoon". Then: who won the round? */
export function StalemateButtons({ id, players }: { id: string; players: string[] }) {
  const { state, pending, name } = useT()
  const actions = usePlayerActions()
  const two = players.length === 2
  const byId = new Map(state.players.map((p) => [p.id, p]))
  return (
    <>
      {players.map((pid, i) => (
        <button key={pid} className="btn btn-sea" disabled={pending}
          onClick={() => actions.loseStalemate(id, byId.get(two ? players[1 - i] : pid)!)}>
          {two ? `${name(pid)} wins` : `${name(pid)} left without a spoon`}
        </button>
      ))}
      {actions.sheet}
    </>
  )
}

/** Everything pinned to the bottom of the stage: stalemates, DQ and cutoff prompts, champion. */
export function StageCards({ now }: { now: number }) {
  const { state, act, undo, pending, name } = useT()
  const confirm = useConfirm()
  const stage = currentStage(state)
  // "Undo penalty" / "Undo last out" must only undo that exact action, so they appear
  // only while it is the newest thing in the history.
  const lastGroup = state.timeline.length ? state.timeline[state.timeline.length - 1].group : 0
  const newest = state.timeline.find((e) => e.group === lastGroup)
  const lastIsPenaltyFor = (pid: string) => newest?.type === 'PenaltyLogged' && newest.player_ids?.[0] === pid
  const lastIsOut = newest?.type === 'PlayerEliminated'

  // Who's in which division, until the stage's first player goes out (the draw happens at Start).
  const gone = new Set(state.players.filter((p) => !['in', 'waiting', 'advanced'].includes(p.status)).map((p) => p.id))
  // Until every division has had its first turn (or before anyone's out), so players can check.
  const showDraw = stage && !stage.is_final &&
    (stage.divisions.some((d) => d.status === 'waiting') || !stage.divisions.some((d) => d.player_ids.some((id) => gone.has(id))))

  return (
    <div className="stage-cards">
      {showDraw && (
        <section className="card" aria-label="Divisions">
          <div className="grow stack-tight">
            <span className="card-eyebrow">STAGE {stage.no} · DIVISIONS DRAWN</span>
            {stage.divisions.map((d) => (
              <span key={d.id}><b>Division {d.label}:</b> {d.player_ids.map(name).join(' · ')}</span>
            ))}
          </div>
        </section>
      )}
      {state.open_stalemates.map((sm) => (
        <section key={sm.id} className="card card-sea" aria-label="Open stalemate">
          <div className="card-icon sea"><Icon name="stalemate" size={22} strokeWidth={2} /></div>
          <div className="grow stack-tight">
            <span className="card-eyebrow sea-text">
              STALEMATE · {sm.started_at == null ? 'WAITING TO START' : <>PLAYING <Elapsed since={sm.started_at} now={now} /></>}
            </span>
            <span className="card-title">
              {sm.player_ids.map(name).join(' vs. ')} — stalemate round, {sm.player_ids.length - 1} spoon{sm.player_ids.length > 2 ? 's' : ''}
            </span>
          </div>
          <StalemateButtons id={sm.id} players={sm.player_ids} />
          <button className="icon-btn" aria-label="Cancel stalemate" disabled={pending}
            onClick={() => act({ type: 'cancel_stalemate', stalemate_id: sm.id })}>
            <Icon name="close" size={18} strokeWidth={2} />
          </button>
        </section>
      ))}

      {state.prompts.map((p) =>
        p.type === 'dq' ? (
          <section key={`dq-${p.player_id}`} className="card card-brick" aria-label="Disqualification">
            <div className="card-icon brick"><Icon name="flag" size={22} strokeWidth={2} /></div>
            <div className="grow stack-tight">
              <span className="card-eyebrow brick-text">RULE 3.2 · REPEAT FALSE SPOON GRAB</span>
              <span className="card-title">
                {name(p.player_id)} has {state.rules.false_grab_dq_at} false spoon grabs. Disqualify {name(p.player_id)}?
              </span>
            </div>
            <button className="btn btn-danger" disabled={pending}
              onClick={() => act({ type: 'disqualify', player_id: p.player_id })}>
              Disqualify
            </button>
            {lastIsPenaltyFor(p.player_id) && (
              <button className="btn btn-ghost" disabled={pending} onClick={undo}>Undo penalty</button>
            )}
          </section>
        ) : (
          <section key="cutoff" className="card card-gold" aria-label="Cutoff reached">
            <div className="card-icon gold"><Icon name="trophy" size={22} strokeWidth={2} /></div>
            <div className="grow stack-tight">
              <span className="card-eyebrow accent-text">
                CUTOFF REACHED · DIVISION {divisionLabel(state, p.division_id)}
              </span>
              <span className="card-title">
                {p.advancing_ids.length} advance: {p.advancing_ids.map(name).join(', ')}
              </span>
            </div>
            <button className="btn btn-primary" disabled={pending}
              onClick={() => act({ type: 'confirm_cutoff', division_id: p.division_id })}>
              Confirm {p.advancing_ids.length} advance
            </button>
            {lastIsOut && (
              <button className="btn btn-ghost" disabled={pending}
                onClick={async () => {
                  if (await confirm({ title: 'Undo the last out?', body: 'The division goes back to playing.', confirmLabel: 'Undo last out' }))
                    undo()
                }}>
                Undo last out
              </button>
            )}
          </section>
        ),
      )}

      {state.tournament.completed && (
        <section className="card card-gold" aria-label="Champion">
          <div className="card-icon gold"><Icon name="trophy" size={22} strokeWidth={2} /></div>
          <div className="grow stack-tight">
            <span className="card-eyebrow accent-text">TOURNAMENT COMPLETE</span>
            <span className="card-title">
              {state.tournament.champion_id ? `${name(state.tournament.champion_id)} wins ${state.tournament.name}` : 'No champion'}
            </span>
          </div>
          <Link to="../players" relative="path" className="btn btn-surface">Standings</Link>
        </section>
      )}

      {activeDivision(state) === null && !state.tournament.completed && state.tournament.started && state.prompts.length === 0 && (
        <section className="card"><span className="card-title">Waiting for the next division</span></section>
      )}
    </div>
  )
}

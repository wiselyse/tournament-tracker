import type { ReactNode } from 'react'
import type { Report, TournamentState } from '../api/types'
import { finishLabel, SurvivalChart, type ChartSize } from '../components/SurvivalChart'
import { fmtDuration } from '../state/describe'

/** 1080×1920 Instagram stories in the WSF brand (HANDOFF §8.5, WSF Instagram Templates). */

export const STORIES = [
  { id: 'champion', label: 'Champion' },
  { id: 'standings', label: 'Final standings' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'numbers', label: 'Night in numbers' },
  { id: 'recap', label: 'Round recap' },
] as const
export type StoryId = (typeof STORIES)[number]['id']

const GROUND = '#3e5654'
const ACCENT = '#d9b877'
const TEXT = '#f9e4c5'

interface Props {
  state: TournamentState
  report: Report
}

function Spoon({ width = 130 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 28) / 96} viewBox="0 0 96 28" aria-hidden="true">
      <ellipse cx="18" cy="14" rx="16" ry="11" fill={ACCENT} />
      <ellipse cx="15" cy="11" rx="7" ry="4" fill="rgba(255,255,255,0.35)" />
      <path d="M32 12.5 C 50 11, 70 10, 88 9.5 a 4.5 4.5 0 0 1 0 9 C 70 18, 50 17, 32 15.5 Z" fill={ACCENT} />
    </svg>
  )
}

function Frame({ state, title, subtitle, children, center }: {
  state: TournamentState; title: ReactNode; subtitle?: ReactNode; children?: ReactNode; center?: boolean
}) {
  return (
    <div className={`story${center ? ' story-center' : ''}`}>
      <div className="story-frame-outer" />
      <div className="story-frame-inner" />
      <header className="story-head">
        <Spoon />
        <p className="story-eyebrow">{state.tournament.name.toUpperCase()}</p>
        <h1 className="story-title">{title}</h1>
        {subtitle && <p className="story-sub">{subtitle}</p>}
      </header>
      {children}
      <p className="story-foot">WISELY SPOONS FEDERATION</p>
    </div>
  )
}

function sub(r: Report) {
  return `${r.stats.players} players · ${r.stats.rounds} round${r.stats.rounds === 1 ? '' : 's'}`
}

function nameOf(r: Report, id: string | null) {
  return r.players.find((p) => p.id === id)?.name ?? '—'
}

/** Cinzel caps run ~0.8 em per letter; keep the name inside the 900 px frame. */
function nameSize(name: string) {
  return Math.min(150, Math.floor(900 / (Math.max(name.length, 1) * 0.8)))
}

export function ChampionStory({ state, report }: Props) {
  const champ = report.players.find((p) => p.status === 'champion')
  return (
    <div className="story story-center story-champion">
      <div className="story-frame-outer" />
      <div className="story-frame-inner" />
      <img src="/brand/wsf-logo.png" alt="" className="story-logo" />
      <p className="story-eyebrow">{state.tournament.name.toUpperCase()}</p>
      <p className="story-sub">{champ ? 'The last player standing' : 'Tournament in progress'}</p>
      <div className="story-divider"><span /><Spoon width={110} /><span /></div>
      <h1 className="story-title story-name" style={{ fontSize: nameSize(champ?.name ?? '—') }}>{champ?.name ?? '—'}</h1>
      <p className="story-eyebrow big">CHAMPION</p>
      <p className="story-sub">
        Outlasted {Math.max(0, report.stats.players - 1)} players across {report.stats.rounds} round{report.stats.rounds === 1 ? '' : 's'}
        {champ && champ.stalemates_won ? ` · won ${champ.stalemates_won} stalemate${champ.stalemates_won > 1 ? 's' : ''}` : ''}
      </p>
      {state.tournament.date && <p className="story-date">{new Date(`${state.tournament.date}T12:00`).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
      <p className="story-foot">WISELY SPOONS FEDERATION</p>
    </div>
  )
}

export function StandingsStory({ state, report }: Props) {
  // shortcut: shows the top 20; a bigger field would need a second slide.
  const rows = report.players.filter((p) => p.place != null || p.status === 'dq').slice(0, 20)
  const rowH = Math.min(78, Math.floor(1060 / Math.max(rows.length, 1)))
  return (
    <Frame state={state} title="Final Standings" subtitle={sub(report)}>
      <ol className="story-list" style={{ fontSize: Math.min(40, rowH * 0.5) }}>
        {rows.map((p) => (
          <li key={p.id} style={{ height: rowH }} className={p.status === 'champion' ? 'gold' : ''}>
            <span className="story-place">{finishLabel(p)}</span>
            <span className="grow">{p.name}</span>
            <span className="story-note">
              {p.status === 'champion' ? 'Champion' : p.status === 'dq' ? 'Disqualified' : p.out_round ? `Round ${p.out_round}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

export function BracketStory({ state, report }: Props) {
  const cols = Math.max(report.rounds.length, 1)
  const rows = Math.max(report.players.filter((p) => p.status !== 'withdrawn').length, 1)
  const rowH = Math.min(76, Math.floor(920 / rows)) // header + legend + footer must fit 1920
  const size: ChartSize = {
    nameW: 196, colW: Math.floor(638 / cols), rowH, barH: Math.round(rowH * 0.29),
    mark: Math.round(rowH * 0.24), nameFont: Math.min(32, rowH * 0.45), headFont: Math.min(22, 640 / cols / 1.6),
  }
  const chartReport = { ...report, players: report.players.filter((p) => p.status !== 'withdrawn') }
  return (
    <Frame state={state} title="Round by Round" subtitle={`${sub(report)} · one champion`}>
      <div className="story-chart">
        <SurvivalChart report={chartReport} size={size} accent={ACCENT} ground={GROUND} text={TEXT} prefix="" />
      </div>
      <div className="story-legend">
        <span><i className="lg-dot" />Won stalemate</span>
        <span><i className="lg-ring" />Lost stalemate</span>
        <span><i className="lg-diamond" />Penalty</span>
        <span><b className="lg-x">×</b>Out</span>
      </div>
    </Frame>
  )
}

export function NumbersStory({ state, report }: Props) {
  const s = report.stats
  const items: [string, string][] = [
    [String(s.players), 'Players'],
    [String(s.rounds), 'Rounds'],
    [s.total_ms ? fmtHM(s.total_ms) : '—', 'Total time'],
    [String(s.stalemates), 'Stalemates'],
    [String(s.penalties), 'Penalties'],
    [s.longest_round ? fmtDuration(s.longest_round.ms) : '—', s.longest_round ? `Longest round · R${s.longest_round.no}` : 'Longest round'],
  ]
  return (
    <Frame state={state} title="Night in Numbers" subtitle={report.completed ? `Champion: ${nameOf(report, report.champion_id)}` : 'So far tonight'}>
      <div className="story-grid">
        {items.map(([v, l]) => (
          <div key={l} className="story-stat">
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      {s.most_stalemates_won && (
        <p className="story-sub story-note-line">
          Stalemate specialist: <b>{nameOf(report, s.most_stalemates_won.player_id)}</b> ({s.most_stalemates_won.count} won)
        </p>
      )}
    </Frame>
  )
}

export function RecapStory({ state, report }: Props) {
  // shortcut: the last 20 rounds fit one slide; earlier ones are dropped on very long nights.
  const rounds = report.rounds.slice(-20)
  const rowH = Math.min(74, Math.floor(1100 / Math.max(rounds.length, 1)))
  return (
    <Frame state={state} title="Round Recap" subtitle={sub(report)}>
      <ol className="story-list" style={{ fontSize: Math.min(36, rowH * 0.48) }}>
        {rounds.map((r) => (
          <li key={r.no} style={{ height: rowH }}>
            <span className="story-place">R{r.no}</span>
            <span className="grow">
              {r.out.length ? `${r.out.map((id) => nameOf(report, id)).join(', ')} out` : r.ended_at ? '—' : 'in progress'}
            </span>
            <span className="story-note">
              {r.stalemates ? `${r.stalemates}× stalemate · ` : ''}
              {r.ms != null ? fmtDuration(r.ms) : ''}
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

function fmtHM(ms: number) {
  const m = Math.round(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export const STORY_COMPONENTS: Record<StoryId, (p: Props) => ReactNode> = {
  champion: ChampionStory,
  standings: StandingsStory,
  bracket: BracketStory,
  numbers: NumbersStory,
  recap: RecapStory,
}

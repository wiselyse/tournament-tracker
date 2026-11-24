import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Report as ReportData, ReportPlayer } from '../api/types'
import { Icon } from '../components/Icon'
import { finishLabel } from '../components/SurvivalChart'
import { fileName, shareOrDownload, storyPng } from '../exports/share'
import { STORIES, STORY_COMPONENTS, type StoryId } from '../exports/stories'
import { fmtDuration } from '../state/describe'
import { useReport, useT } from '../state/tournament'

function hm(ms: number) {
  const m = Math.round(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

function note(p: ReportPlayer) {
  const bits = [
    p.status === 'champion' ? null : p.status === 'dq' ? 'DQ' : p.status === 'withdrawn' ? 'Withdrew' : p.out_round ? `Round ${p.out_round}` : 'Still in',
    p.stalemates_won ? `${p.stalemates_won} stalemate${p.stalemates_won > 1 ? 's' : ''} won` : null,
    p.penalties ? `${p.penalties} penalt${p.penalties > 1 ? 'ies' : 'y'}` : null,
  ]
  return bits.filter(Boolean).join(' · ')
}

export function Report() {
  const { state } = useT()
  const q = useReport()
  const r = q.data
  if (!r) return <p className="muted pad">{q.isError ? q.error.message : 'Loading…'}</p>

  const placed = (n: number) => r.players.find((p) => p.place === n)
  const champ = placed(1)
  const podium = [placed(2), champ, placed(3)]
  const rest = r.completed ? r.players.filter((p) => !podium.includes(p)) : r.players

  return (
    <div className="report-page">
      <section className="report-main" aria-label="Report">
        <div className="print-only print-head">
          <h1>{state.tournament.name}</h1>
          <p>{[state.tournament.date, r.completed ? 'Final report' : 'Report so far'].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="stat-tiles">
          <div><b>{r.stats.rounds}</b><span>Rounds</span></div>
          <div><b>{r.stats.total_ms ? hm(r.stats.total_ms) : '—'}</b><span>Total time</span></div>
          <div><b>{r.stats.stalemates}</b><span>Stalemates</span></div>
          <div><b>{r.stats.penalties}</b><span>Penalties</span></div>
        </div>
        {r.stats.longest_round && (
          <p className="muted small">
            Longest round: R{r.stats.longest_round.no} ({fmtDuration(r.stats.longest_round.ms)})
            {r.stats.shortest_round && ` · shortest: R${r.stats.shortest_round.no} (${fmtDuration(r.stats.shortest_round.ms)})`}
            {r.stats.stoppages ? ` · ${r.stats.stoppages} stoppage${r.stats.stoppages > 1 ? 's' : ''}` : ''}
            {r.stats.dqs ? ` · ${r.stats.dqs} DQ` : ''}
          </p>
        )}

        {r.completed && champ ? (
          <div className="podium">
            {podium.map((p, i) => p && (
              <div key={p.id} className={`podium-step p${i}`}>
                <span className="podium-rank">{i === 1 ? 'CHAMPION' : finishLabel(p).toUpperCase()}</span>
                <span className="podium-name" style={{ fontSize: Math.min(i === 1 ? 36 : 28, Math.floor(185 / (p.name.length * 0.85))) }}>
                  {p.name}
                </span>
                <span className="podium-note">
                  {i === 1 ? `Played ${p.rounds.length} round${p.rounds.length === 1 ? '' : 's'}` : note(p)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="note">The tournament is still going. These are the standings so far.</p>
        )}

        <h2 className="section-label">{r.completed ? 'FINAL STANDINGS' : 'STANDINGS SO FAR'}</h2>
        <ol className="standings">
          {rest.map((p) => (
            <li key={p.id}>
              <span className="st-place">{finishLabel(p) || '—'}</span>
              <Link className="st-name" to={`../players?open=${p.id}`} relative="path">{p.name}</Link>
              <span className="muted small">{note(p)}</span>
            </li>
          ))}
        </ol>
      </section>
      <ExportPanel report={r} />
    </div>
  )
}

function ExportPanel({ report }: { report: ReportData }) {
  const { state } = useT()
  const [chosen, setChosen] = useState<StoryId>('champion')
  const [all, setAll] = useState(true)
  const [pngs, setPngs] = useState<Partial<Record<StoryId, File>>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const nodes = useRef<Partial<Record<StoryId, HTMLDivElement | null>>>({})
  const key = `${state.cursor}-${state.head}-${state.tournament.name}`

  // Render the PNGs ahead of time: Safari only opens the share sheet straight after a tap.
  useEffect(() => {
    let cancelled = false
    setPngs({})
    const run = async () => {
      for (const s of STORIES) {
        const node = nodes.current[s.id]?.firstElementChild as HTMLElement | null
        if (!node || cancelled) continue
        try {
          const blob = await storyPng(node)
          if (!cancelled)
            setPngs((p) => ({ ...p, [s.id]: new File([blob], fileName(state.tournament.name, s.id), { type: 'image/png' }) }))
        } catch (e) {
          if (!cancelled) setMsg(`Couldn't render ${s.label}: ${e instanceof Error ? e.message : e}`)
        }
      }
    }
    const t = window.setTimeout(run, 300)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [key, report, state.tournament.name]) // report: the hidden stories redraw when it arrives

  const files = all ? STORIES.map((s) => pngs[s.id]).filter((f): f is File => !!f) : pngs[chosen] ? [pngs[chosen]!] : []
  const ready = all ? files.length === STORIES.length : files.length === 1
  const Preview = STORY_COMPONENTS[chosen]

  return (
    <aside className="export-panel" aria-label="Export for social media">
      <div className="row baseline">
        <h2 className="section-label grow">INSTAGRAM STORY</h2>
        <span className="muted small">1080 × 1920</span>
      </div>
      <div className="export-row">
        <div className="story-preview" role="img" aria-label={`Story preview: ${STORIES.find((s) => s.id === chosen)?.label}`}>
          <div className="story-scale"><Preview state={state} report={report} /></div>
        </div>
        <div role="radiogroup" aria-label="Story template" className="story-picker">
          {STORIES.map((s) => (
            <button key={s.id} role="radio" aria-checked={chosen === s.id} onClick={() => setChosen(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Include all 5 as one swipeable set
      </label>
      {msg && <p className="bad-text small">{msg}</p>}
      <div className="grow" />
      <button
        className="btn btn-primary btn-xl"
        disabled={!ready}
        onClick={async () => {
          setMsg(null)
          try {
            const res = await shareOrDownload(files, state.tournament.name)
            if (res === 'downloaded') setMsg(`Downloaded ${files.length} image${files.length > 1 ? 's' : ''}.`)
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        <Icon name="export" strokeWidth={2} /> {ready ? 'Share…' : 'Preparing images…'}
      </button>
      <button className="btn btn-ghost btn-lg" onClick={() => window.print()}>Download report (PDF)</button>

      {/* Full-size copies for rendering to PNG. Off-screen, not display:none (they need layout). */}
      <div className="story-offscreen" aria-hidden="true">
        {STORIES.map((s) => {
          const C = STORY_COMPONENTS[s.id]
          return (
            <div key={s.id} ref={(el) => { nodes.current[s.id] = el }}>
              <C state={state} report={report} />
            </div>
          )
        })}
      </div>
    </aside>
  )
}

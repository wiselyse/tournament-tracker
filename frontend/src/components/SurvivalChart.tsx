import type { Report, ReportPlayer } from '../api/types'
import { ordinal, roundName, roundShort } from '../state/describe'

export interface ChartSize {
  nameW: number
  colW: number
  rowH: number
  barH: number
  mark: number // marker diameter
  nameFont: number
  headFont: number
}

export const APP_SIZE: ChartSize = { nameW: 130, colW: 64, rowH: 46, barH: 14, mark: 14, nameFont: 15, headFont: 13 }

export function finishLabel(p: ReportPlayer): string {
  if (p.status === 'withdrawn') return 'WD'
  if (p.status === 'dq') return 'DQ'
  if (p.place == null) return ''
  return p.tied ? `T-${p.place}` : ordinal(p.place)
}

/** Rows = players by finish, columns = rounds. Markers sit centred on the bar (HANDOFF §8.4). */
export function SurvivalChart({ report, size, accent, ground, text, onName, compact = false }: {
  report: Report
  compact?: boolean // round header: "B·R1" in the app, "B1" on the story
  size: ChartSize
  accent: string // champion bar, penalty diamond
  ground: string // fill inside the "lost stalemate" ring
  text: string
  onName?: (id: string) => void
}) {
  const { nameW, colW, rowH, barH, mark, nameFont, headFont } = size
  const cols = report.rounds.map((r) => r.no)
  const col = new Map(cols.map((n, i) => [n, i]))
  const width = cols.length * colW
  const center = (rnd: number) => ((col.get(rnd) ?? 0) + 0.5) * colW
  const mid = (rowH - mark) / 2
  const step = mark * 1.3 // between marks in the same round

  return (
    <div role="table" aria-label="Survival chart by round" className="survival" style={{ color: text }}>
      <div role="row" className="sv-row sv-head" style={{ height: headFont * 2.6 }}>
        <span role="columnheader" style={{ width: nameW }} className="sv-name" />
        <div style={{ width, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, ${colW}px)` }}>
          {cols.map((n) => (
            <span key={n} role="columnheader" className="sv-round" style={{ fontSize: headFont, color: accent }}>
              {compact ? roundShort(report.round_names, n).replace(/·?R/, '') : roundShort(report.round_names, n)}
            </span>
          ))}
        </div>
        <span role="columnheader" className="sv-finish" style={{ fontSize: headFont * 0.9 }} />
      </div>
      {report.players.map((p) => {
        const champ = p.status === 'champion'
        const summary = champ
          ? `${p.name} survived every round and won`
          : p.out_round ? `${p.name} went out in ${roundName(report.round_names, p.out_round)}` : `${p.name}: ${p.status}`
        // Each round's marks sit in a row that ends on the round's column centre (under its
        // number): stalemates, then penalties, then the out ×, which closes the player's line.
        const order = { won: 0, lost: 0, penalty: 1, out: 2, dq: 2, withdrawn: 2 }
        const at = new Map<number, number>() // mark index → x
        const byRound = new Map<number, number[]>()
        p.marks.forEach((m, i) => { if (col.has(m.round)) byRound.set(m.round, [...(byRound.get(m.round) ?? []), i]) })
        for (const [rnd, idx] of byRound) {
          idx.sort((x, y) => order[p.marks[x].type] - order[p.marks[y].type])
          idx.forEach((i, k) => at.set(i, center(rnd) - (idx.length - 1 - k) * step))
        }
        const leftmost = (rnd: number) => Math.min(center(rnd), ...(byRound.get(rnd) ?? []).map((i) => at.get(i)!))
        return (
          <div key={p.id} role="row" className="sv-row" style={{ height: rowH }}>
            <span role="rowheader" className="sv-name" style={{ width: nameW, fontSize: nameFont, color: champ ? accent : text }}>
              {onName ? <button className="sv-name-btn" onClick={() => onName(p.id)}>{p.name}</button> : p.name}
            </span>
            <div role="cell" aria-label={summary} className="sv-cells" style={{ width, height: rowH }}>
              {cols.map((n, i) => i % 2 === 1 && (
                <span key={n} aria-hidden="true" className="sv-stripe" style={{ left: i * colW, width: colW }} />
              ))}
              {/* One line from the first round played to the last: divisions take turns, so a
                  player's own rounds skip the others' and the line runs through those. */}
              {[p.rounds.filter((r) => col.has(r))].filter((played) => played.length).map((played) => {
                const a = Math.min(...played), b = Math.max(...played)
                // From the first round's centre to the last one's (wider if marks need room).
                const left = Math.min(center(a), leftmost(a) - mark * 0.4) - barH / 2
                return (
                  <span
                    key={a}
                    aria-hidden="true"
                    className="sv-bar"
                    style={{
                      left,
                      width: center(b) + barH / 2 - left,
                      top: (rowH - barH) / 2,
                      height: barH,
                      background: champ ? accent : 'rgba(249,228,197,0.24)',
                    }}
                  />
                )
              })}
              {p.marks.map((m, i) => {
                const c = at.get(i)
                if (c == null) return null
                if (m.type === 'won' || m.type === 'lost') {
                  return (
                    <span key={i} aria-hidden="true" className="sv-mark"
                      style={{
                        left: c - mark / 2, top: mid, width: mark, height: mark, borderRadius: '50%',
                        background: m.type === 'won' ? '#8cbcb4' : ground,
                        border: m.type === 'lost' ? `${Math.max(2, mark / 7)}px solid #8cbcb4` : undefined,
                      }} />
                  )
                }
                if (m.type === 'penalty') {
                  const d = mark * 0.8
                  return (
                    <span key={i} aria-hidden="true" className="sv-mark"
                      style={{ left: c - d / 2, top: (rowH - d) / 2, width: d, height: d, background: accent, transform: 'rotate(45deg)' }} />
                  )
                }
                // Drawn, not typed: a font's × sits off-centre in its line box.
                const x = mark * 0.9
                return (
                  <svg key={i} aria-hidden="true" className="sv-x" width={x} height={x} viewBox="0 0 10 10"
                    style={{ left: c - x / 2, top: (rowH - x) / 2 }}>
                    <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="#e8988a" strokeWidth={2.2} strokeLinecap="round" />
                  </svg>
                )
              })}
            </div>
            <span role="cell" className="sv-finish" style={{ fontSize: nameFont, color: champ ? accent : text }}>
              {finishLabel(p)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

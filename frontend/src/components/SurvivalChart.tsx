import type { Report, ReportPlayer } from '../api/types'
import { ordinal } from '../state/describe'

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

/** Consecutive runs of rounds, e.g. [1,2,3,7,8] → [[1,3],[7,8]] (gaps = other divisions' rounds). */
export function runs(rounds: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const r of rounds) {
    const last = out[out.length - 1]
    if (last && r === last[1] + 1) last[1] = r
    else out.push([r, r])
  }
  return out
}

/** Rows = players by finish, columns = rounds. Markers sit centred on the bar (HANDOFF §8.4). */
export function SurvivalChart({ report, size, accent, ground, text, onName, prefix = 'R' }: {
  report: Report
  prefix?: string // round header: "R3" in the app, "3" on the story
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

  return (
    <div role="table" aria-label="Survival chart by round" className="survival" style={{ color: text }}>
      <div role="row" className="sv-row sv-head" style={{ height: headFont * 2.6 }}>
        <span role="columnheader" style={{ width: nameW }} className="sv-name" />
        <div style={{ width, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, ${colW}px)` }}>
          {cols.map((n) => (
            <span key={n} role="columnheader" className="sv-round" style={{ fontSize: headFont, color: accent }}>
              {prefix}{n}
            </span>
          ))}
        </div>
        <span role="columnheader" className="sv-finish" style={{ fontSize: headFont * 0.9 }} />
      </div>
      {report.players.map((p) => {
        const champ = p.status === 'champion'
        const summary = champ
          ? `${p.name} survived every round and won`
          : p.out_round ? `${p.name} went out in round ${p.out_round}` : `${p.name}: ${p.status}`
        let wonLost = 0
        return (
          <div key={p.id} role="row" className="sv-row" style={{ height: rowH }}>
            <span role="rowheader" className="sv-name" style={{ width: nameW, fontSize: nameFont, color: champ ? accent : text }}>
              {onName ? <button className="sv-name-btn" onClick={() => onName(p.id)}>{p.name}</button> : p.name}
            </span>
            <div role="cell" aria-label={summary} className="sv-cells" style={{ width, height: rowH }}>
              {cols.map((n, i) => i % 2 === 1 && (
                <span key={n} aria-hidden="true" className="sv-stripe" style={{ left: i * colW, width: colW }} />
              ))}
              {runs(p.rounds.filter((r) => col.has(r))).map(([a, b]) => (
                <span
                  key={a}
                  aria-hidden="true"
                  className="sv-bar"
                  style={{
                    left: col.get(a)! * colW + 4,
                    width: (col.get(b)! - col.get(a)! + 1) * colW - 8,
                    top: (rowH - barH) / 2,
                    height: barH,
                    background: champ ? accent : 'rgba(249,228,197,0.24)',
                  }}
                />
              ))}
              {p.marks.map((m, i) => {
                const c = center(m.round)
                if (m.type === 'won' || m.type === 'lost') {
                  const off = wonLost++ % 3
                  return (
                    <span key={i} aria-hidden="true" className="sv-mark"
                      style={{
                        left: c - mark * 1.6 - off * (mark * 0.5), top: mid, width: mark, height: mark, borderRadius: '50%',
                        background: m.type === 'won' ? '#8cbcb4' : ground,
                        border: m.type === 'lost' ? `${Math.max(2, mark / 7)}px solid #8cbcb4` : undefined,
                      }} />
                  )
                }
                if (m.type === 'penalty') {
                  const d = mark * 0.8
                  return (
                    <span key={i} aria-hidden="true" className="sv-mark"
                      style={{ left: c + mark * 0.7, top: (rowH - d) / 2, width: d, height: d, background: accent, transform: 'rotate(45deg)' }} />
                  )
                }
                return (
                  <span key={i} aria-hidden="true" className="sv-x"
                    style={{ left: c - mark * 0.7, top: 0, width: mark * 1.4, height: rowH, lineHeight: `${rowH}px`, fontSize: mark * 1.6 }}>
                    ×
                  </span>
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

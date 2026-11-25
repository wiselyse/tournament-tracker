import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Geometry } from '../api/types'
import { placeTable } from './tableLayout'

export interface SeatView {
  name?: string
  ring?: 'sea' | 'gold' | 'brick'
  dim?: boolean // out this round
  badge?: number // penalty count
  tag?: string // "D" / "D2": dealer and second dealer (rule 1.3.3)
  label?: string // aria-label override
}

interface Props {
  geo: Geometry
  seatView?: (seatNo: number) => SeatView
  center?: ReactNode // text inside the felt
  compact?: boolean // setup preview: smaller seats, no names
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

/** The table drawn from engine geometry: felt and spoons in SVG, seats and names on top. */
export function TableDiagram({ geo, seatView, center, compact }: Props) {
  const [ref, box] = useBox<HTMLDivElement>()
  const narrow = Math.min(box.w, box.h) < 520
  const seatR = compact ? 22 : narrow ? 22 : 29
  const margin = seatR * 2 + (compact ? 6 : 40)
  // Narrow portrait (phones): more room for names beside the long sides (keeping the table at
  // least 100px wide for two end seats), and a table stretched tall enough that seats don't overlap.
  // (Squares and circles never stand up, so they can't stretch to make up the width.)
  const phone = !compact && box.w < 520 && box.h > box.w && Math.abs(geo.table.w - geo.table.h) > 1e-9
  const sideRoom = compact ? 0 : phone ? Math.max(32, Math.min(58, (box.w - 2 * margin - 100) / 2)) : 32
  const p = box.w > 0 ? placeTable(geo, box.w, box.h, seatR, margin, sideRoom, phone ? seatR * 2 + 8 : 0, !compact) : null
  const t = p?.table
  const round = geo.table.shape === 'circle' || geo.table.shape === 'oval'

  return (
    <div ref={ref} className={`table-stage${compact ? ' compact' : ''}${round ? ' round' : ''}`}>
      {p && t && (
        <>
          <svg className="table-svg" width={box.w} height={box.h} aria-hidden="true">
            {round ? (
              <>
                <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w / 2} ry={t.h / 2} className="felt" />
                <ellipse cx={t.x + t.w / 2} cy={t.y + t.h / 2} rx={t.w / 2 - 9} ry={t.h / 2 - 9} className="felt-line" />
              </>
            ) : (
              <>
                <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={16} className="felt" />
                <rect x={t.x + 9} y={t.y + 9} width={t.w - 18} height={t.h - 18} rx={9} className="felt-line" />
              </>
            )}
            {p.spoons.map((s, i) => (
              <g key={i} transform={`translate(${s.x} ${s.y}) rotate(${s.deg})`}>
                <g transform={`scale(${p.spoonLen / 96}) translate(-48 -14)`}>
                  <ellipse cx="18" cy="14" rx="16" ry="11" className="spoon" />
                  <path className="spoon" d="M32 12.5 C 50 11, 70 10, 88 9.5 a 4.5 4.5 0 0 1 0 9 C 70 18, 50 17, 32 15.5 Z" />
                </g>
              </g>
            ))}
            {p.gap && (
              // The empty gap: a red spoon exactly where its spoon would go. No other spoon moves.
              <g transform={`translate(${p.gap.x} ${p.gap.y}) rotate(${p.gap.deg})`} className="gap-mark">
                <g transform={`scale(${p.spoonLen / 96}) translate(-48 -14)`}>
                  <ellipse cx="18" cy="14" rx="16" ry="11" />
                  <path d="M32 12.5 C 50 11, 70 10, 88 9.5 a 4.5 4.5 0 0 1 0 9 C 70 18, 50 17, 32 15.5 Z" />
                </g>
              </g>
            )}
          </svg>
          {center && (
            <div className="felt-center" style={{ left: t.x, top: t.y, width: t.w, height: t.h }}>
              {center}
            </div>
          )}
          {p.seats.map((s) => {
            const v = seatView?.(s.seat_no) ?? {}
            const nearest = Math.min(...p.seats.filter((o) => o !== s).map((o) => Math.hypot(o.x - s.x, o.y - s.y)), 999)
            // Seats down the left/right edges stack closely, so a name under the seat would hide
            // behind the next seat: put it beside the seat, on the side away from the table.
            // A lone or well-spaced end seat keeps its name underneath instead (no width needed).
            const edge = Math.abs(s.nx) > 0.7 ? (s.nx < 0 ? 'left' : 'right') : null
            const side = edge && nearest < seatR * 2 + 26 ? edge : null
            let style: CSSProperties
            let end: 'first' | 'last' | null = null
            if (side) {
              const room = Math.min(120, (side === 'left' ? s.x : box.w - s.x) - seatR - 8)
              style = { top: s.y, marginTop: -seatR, height: seatR * 2, ['--name-w' as string]: `${room}px` }
              if (side === 'left') style.right = box.w - s.x - seatR
              else style.left = s.x - seatR
            } else {
              // A name may use the room up to its nearest neighbour, so crowded sides truncate
              // with an ellipsis instead of running together. The end seats of a row have nothing
              // beyond them, so their names may run outward instead.
              const row = p.seats.filter((o) => o !== s && Math.abs(o.y - s.y) < 1 && Math.abs(o.nx) <= 0.7)
              const width = Math.max(seatR * 2, Math.min(seatR * 2 + 40, nearest - 6))
              // An end seat's name runs away from the table so it never covers the felt.
              const first = edge === 'left' || (!edge && row.length > 0 && row.every((o) => o.x > s.x))
              const last = edge === 'right' || (!edge && row.length > 0 && row.every((o) => o.x < s.x))
              // Rough width of the name at 14px; only names that don't fit centred move outward.
              const fits = !edge && (v.name?.length ?? 0) * 8 <= width
              if ((first || last) && !fits && nearest >= seatR * 2) {
                end = first ? 'first' : 'last'
                const out = Math.min(120, (first ? s.x + seatR : box.w - s.x + seatR) - 8)
                style = { top: s.y, marginTop: -seatR, width: Math.max(width, out) }
                if (first) style.right = box.w - s.x - seatR
                else style.left = s.x - seatR
              } else {
                const w = row.length ? width : Math.max(width, Math.min(120, 2 * Math.min(s.x, box.w - s.x) - 16))
                style = { left: s.x, top: s.y, width: w, marginLeft: -w / 2, marginTop: -seatR }
              }
            }
            return (
              <div key={s.seat_no} className={`seat-wrap${side ? ` beside ${side}` : ''}${end ? ` row-${end}` : ''}`} style={style}>
                <div
                  role="img"
                  className={`seat${v.ring ? ` ring-${v.ring}` : ''}${v.dim ? ' dim' : ''}`}
                  style={{ width: seatR * 2, height: seatR * 2, fontSize: seatR * 0.7 }}
                  aria-label={v.label ?? `Seat ${s.seat_no}${v.name ? `, ${v.name}` : ''}`}
                >
                  {s.seat_no}
                  {!!v.badge && <span className="seat-badge">{v.badge}</span>}
                  {v.tag && <span className="seat-tag" aria-hidden="true">{v.tag}</span>}
                </div>
                {v.name && <span className={`seat-name${v.dim ? ' struck' : ''}`}>{v.name}</span>}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

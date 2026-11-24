import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Geometry } from '../api/types'
import { placeTable, type Placed } from './tableLayout'

export interface SeatView {
  name?: string
  ring?: 'sea' | 'gold' | 'brick'
  dim?: boolean // out this round
  badge?: number // penalty count
  tag?: string // "D" / "D2": dealer and second dealer (rule 1.3.3)
  disabled?: boolean
  label?: string // aria-label override
}

interface Props {
  geo: Geometry
  seatView?: (seatNo: number) => SeatView
  onSeat?: (seatNo: number) => void
  center?: ReactNode // text inside the felt
  overlay?: (p: Placed) => ReactNode // popovers anchored to seats
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

/** The table drawn from engine geometry: felt and spoons in SVG, seats as real buttons. */
export function TableDiagram({ geo, seatView, onSeat, center, overlay, compact }: Props) {
  const [ref, box] = useBox<HTMLDivElement>()
  const narrow = Math.min(box.w, box.h) < 520
  const seatR = compact ? 22 : narrow ? 22 : 29
  const margin = seatR * 2 + (compact ? 14 : 40)
  const p = box.w > 0 ? placeTable(geo, box.w, box.h, seatR, margin, compact ? 0 : 32) : null
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
              <g transform={`translate(${p.gap.x} ${p.gap.y})`} className="gap-mark">
                <circle r={13} />
                <path d="M-5 -5 L5 5 M5 -5 L-5 5" />
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
            // Seats down the left/right edges are stacked, so a name under the seat would hide
            // behind the next seat: put it beside the seat, on the side away from the table.
            const side = Math.abs(s.nx) > 0.7 ? (s.nx < 0 ? 'left' : 'right') : null
            let style: CSSProperties
            if (side) {
              const room = Math.min(120, (side === 'left' ? s.x : box.w - s.x) - seatR - 8)
              style = { top: s.y, marginTop: -seatR, height: seatR * 2, ['--name-w' as string]: `${room}px` }
              if (side === 'left') style.right = box.w - s.x - seatR
              else style.left = s.x - seatR
            } else {
              // A name may use the room up to its nearest neighbour, so crowded sides truncate
              // with an ellipsis instead of running together.
              const nearest = Math.min(...p.seats.filter((o) => o !== s).map((o) => Math.hypot(o.x - s.x, o.y - s.y)), 999)
              const width = Math.max(seatR * 2, Math.min(seatR * 2 + 40, nearest - 6))
              style = { left: s.x, top: s.y, width, marginLeft: -width / 2, marginTop: -seatR }
            }
            return (
              <div key={s.seat_no} className={`seat-wrap${side ? ` beside ${side}` : ''}`} style={style}>
                <button
                  className={`seat${v.ring ? ` ring-${v.ring}` : ''}${v.dim ? ' dim' : ''}`}
                  style={{ width: seatR * 2, height: seatR * 2, fontSize: seatR * 0.7 }}
                  onClick={onSeat ? () => onSeat(s.seat_no) : undefined}
                  disabled={!onSeat || v.disabled}
                  aria-label={v.label ?? `Seat ${s.seat_no}${v.name ? `, ${v.name}` : ''}`}
                >
                  {s.seat_no}
                  {!!v.badge && <span className="seat-badge">{v.badge}</span>}
                  {v.tag && <span className="seat-tag" aria-hidden="true">{v.tag}</span>}
                </button>
                {v.name && <span className={`seat-name${v.dim ? ' struck' : ''}`}>{v.name}</span>}
              </div>
            )
          })}
          {overlay?.(p)}
        </>
      )}
    </div>
  )
}

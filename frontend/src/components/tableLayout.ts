import type { Geometry } from '../api/types'

/** Fit the engine's normalised table geometry into a box of `boxW`×`boxH` px.
 *  The only geometry on the client: rotation for portrait and scaling. Seat numbers,
 *  positions and spoon placement all come from the engine. */

export interface Placed {
  box: { w: number; h: number }
  portrait: boolean
  scale: number
  table: { x: number; y: number; w: number; h: number; shape: string }
  seats: { seat_no: number; x: number; y: number; nx: number; ny: number }[]
  spoons: { x: number; y: number; deg: number }[] // deg = CSS rotation for the left-headed glyph
  gap: { x: number; y: number; deg: number } | null // the empty gap's spoon, drawn red
  spoonLen: number
}

/** 90° clockwise: the long axis becomes vertical (HANDOFF §5.2). */
export function rotatePoint(x: number, y: number, h: number): [number, number] {
  return [h - y, x]
}

/** CSS rotation for the spoon glyph, whose head points left (180°). `stretch` is how much
 *  taller than wide the table is drawn compared with its true shape (headings tilt to match). */
export function glyphRotation(headDeg: number, portrait: boolean, stretch = 1): number {
  let head = headDeg + (portrait ? 90 : 0)
  if (stretch !== 1) {
    const a = (head * Math.PI) / 180
    head = (Math.atan2(Math.sin(a) * stretch, Math.cos(a)) * 180) / Math.PI
  }
  const deg = Math.round((head - 180) * 1e6) / 1e6
  return ((deg % 360) + 360) % 360
}

export function placeTable(
  geo: Geometry,
  boxW: number,
  boxH: number,
  seatR: number,
  margin: number,
  sideRoom = 0, // extra space left and right, for names beside the side seats
  minGap = 0, // portrait only: stretch the table taller until side seats are this far apart (px)
  names = true, // false: seats hug the table (no names to fit between them)
): Placed {
  const { w, h } = geo.table
  const portrait = boxH > boxW * 1.05 && Math.abs(w - h) > 1e-9
  const tw = portrait ? h : w
  const th = portrait ? w : h
  const fitY = (boxH - 2 * margin) / th
  const scale = Math.max(0, Math.min((boxW - 2 * (margin + sideRoom)) / tw, fitY))
  // A narrow phone has height to spare but not width: stretch the long sides just enough that
  // their seats don't overlap, instead of shrinking the whole table.
  let scaleY = scale
  if (portrait && minGap > 0) {
    const gaps = [1, -1].flatMap((side) => {
      const ys = geo.seats.filter((st) => st.ny * side > 0.7).map((st) => st.x).sort((a, b) => a - b)
      return ys.slice(1).map((y, i) => y - ys[i])
    })
    const tightest = Math.min(...gaps.filter((g) => g > 1e-9), Infinity)
    if (tightest < Infinity) scaleY = Math.max(scale, Math.min(fitY, minGap / tightest))
  }
  const stretch = scale > 0 ? scaleY / scale : 1
  const ox = (boxW - tw * scale) / 2
  const oy = (boxH - th * scaleY) / 2
  const pt = (x: number, y: number) => {
    const [rx, ry] = portrait ? rotatePoint(x, y, h) : [x, y]
    return { x: ox + rx * scale, y: oy + ry * scaleY }
  }
  const seats = geo.seats.map((s) => {
    const [nx, ny] = portrait ? [-s.ny, s.nx] : [s.nx, s.ny]
    const p = pt(s.x, s.y)
    // Seats sit off the edge; seats above the table go further so names clear the felt.
    const off = seatR + (names ? 10 + (ny < -0.5 ? 20 : 0) : 4)
    return { seat_no: s.seat_no, x: p.x + nx * off, y: p.y + ny * off, nx, ny }
  })
  return {
    box: { w: boxW, h: boxH },
    portrait,
    scale,
    table: { x: ox, y: oy, w: tw * scale, h: th * scaleY, shape: geo.table.shape },
    seats,
    spoons: geo.spoons.map((sp) => ({ ...pt(sp.x, sp.y), deg: glyphRotation(sp.rot, portrait, stretch) })),
    gap: geo.empty_gap ? { ...pt(geo.empty_gap.x, geo.empty_gap.y), deg: glyphRotation(geo.empty_gap.rot ?? 0, portrait, stretch) } : null,
    spoonLen: Math.max(22, Math.min(46, 0.086 * Math.max(tw, th) * scale, 0.36 * Math.min(tw, th) * scale)),
  }
}

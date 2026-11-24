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
  gap: { x: number; y: number } | null
  spoonLen: number
}

/** 90° clockwise: the long axis becomes vertical (HANDOFF §5.2). */
export function rotatePoint(x: number, y: number, h: number): [number, number] {
  return [h - y, x]
}

/** CSS rotation for the spoon glyph, whose head points left (180°). */
export function glyphRotation(headDeg: number, portrait: boolean): number {
  const deg = headDeg + (portrait ? 90 : 0) - 180
  return ((deg % 360) + 360) % 360
}

export function placeTable(
  geo: Geometry,
  boxW: number,
  boxH: number,
  seatR: number,
  margin: number,
  sideRoom = 0, // extra space left and right, for names beside the side seats
): Placed {
  const { w, h } = geo.table
  const portrait = boxH > boxW * 1.05 && Math.abs(w - h) > 1e-9
  const tw = portrait ? h : w
  const th = portrait ? w : h
  const scale = Math.max(0, Math.min((boxW - 2 * (margin + sideRoom)) / tw, (boxH - 2 * margin) / th))
  const ox = (boxW - tw * scale) / 2
  const oy = (boxH - th * scale) / 2
  const pt = (x: number, y: number) => {
    const [rx, ry] = portrait ? rotatePoint(x, y, h) : [x, y]
    return { x: ox + rx * scale, y: oy + ry * scale }
  }
  const seats = geo.seats.map((s) => {
    const [nx, ny] = portrait ? [-s.ny, s.nx] : [s.nx, s.ny]
    const p = pt(s.x, s.y)
    // Seats sit off the edge; seats above the table go further so names clear the felt.
    const off = seatR + 10 + (ny < -0.5 ? 20 : 0)
    return { seat_no: s.seat_no, x: p.x + nx * off, y: p.y + ny * off, nx, ny }
  })
  return {
    box: { w: boxW, h: boxH },
    portrait,
    scale,
    table: { x: ox, y: oy, w: tw * scale, h: th * scale, shape: geo.table.shape },
    seats,
    spoons: geo.spoons.map((sp) => ({ ...pt(sp.x, sp.y), deg: glyphRotation(sp.rot, portrait) })),
    gap: geo.empty_gap ? pt(geo.empty_gap.x, geo.empty_gap.y) : null,
    spoonLen: Math.max(22, Math.min(46, 0.086 * Math.max(tw, th) * scale, 0.36 * Math.min(tw, th) * scale)),
  }
}

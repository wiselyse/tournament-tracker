import { describe, expect, it } from 'vitest'
import type { Geometry } from '../api/types'
import { glyphRotation, placeTable, rotatePoint } from './tableLayout'

const geo: Geometry = {
  table: { shape: 'rectangle', max_long: 4, max_end: 2, max_side: 3, spoon_layout: 'center', w: 1, h: 0.5 },
  seats: [
    { seat_no: 1, x: 0.125, y: 0, nx: 0, ny: -1 },
    { seat_no: 2, x: 1, y: 0.25, nx: 1, ny: 0 },
  ],
  spoons: [{ x: 0.5, y: 0.25, rot: -90 }],
  empty_gap: null,
}

describe('glyphRotation', () => {
  it('turns the left-headed glyph to face the engine heading', () => {
    expect(glyphRotation(180, false)).toBe(0) // head left: no rotation
    expect(glyphRotation(0, false)).toBe(180) // head right
    expect(glyphRotation(-90, false)).toBe(90) // head up: CSS rotates clockwise
    expect(glyphRotation(90, false)).toBe(270) // head down
  })
  it('adds a quarter turn in portrait', () => {
    expect(glyphRotation(-90, true)).toBe(180) // "up" becomes "right"
  })
})

describe('rotatePoint', () => {
  it('rotates 90° clockwise inside an h-tall table', () => {
    expect(rotatePoint(0, 0, 0.5)).toEqual([0.5, 0]) // top-left → top-right
    expect(rotatePoint(1, 0.5, 0.5)).toEqual([0, 1]) // bottom-right → bottom-left
  })
})

describe('placeTable', () => {
  it('keeps landscape tables horizontal and seats outside the felt', () => {
    const p = placeTable(geo, 1000, 600, 29, 100)
    expect(p.portrait).toBe(false)
    expect(p.table.w).toBeGreaterThan(p.table.h)
    expect(p.seats[0].y).toBeLessThan(p.table.y) // above the top edge
    expect(p.seats[1].x).toBeGreaterThan(p.table.x + p.table.w) // right of the right end
  })
  it('stands the table up in portrait without renumbering', () => {
    const p = placeTable(geo, 400, 800, 22, 70)
    expect(p.portrait).toBe(true)
    expect(p.table.h).toBeGreaterThan(p.table.w)
    expect(p.seats.map((s) => s.seat_no)).toEqual([1, 2])
    expect(p.seats[0].x).toBeGreaterThan(p.table.x + p.table.w) // top side → right side
    expect(p.seats[1].y).toBeGreaterThan(p.table.y + p.table.h) // right end → bottom
    expect(p.spoons[0].deg).toBe(180)
  })
  it('never rotates circles', () => {
    const circle = { ...geo, table: { ...geo.table, shape: 'circle' as const, w: 1, h: 1 } }
    expect(placeTable(circle, 400, 800, 22, 70).portrait).toBe(false)
  })
})

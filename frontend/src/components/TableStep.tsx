import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Preview, Shape, TableConfig } from '../api/types'
import { TableDiagram } from './TableDiagram'

const SHAPES: { shape: Shape; label: string; w: number; h: number; r: string }[] = [
  { shape: 'square', label: 'Square', w: 34, h: 34, r: '4px' },
  { shape: 'rectangle', label: 'Rectangle', w: 52, h: 28, r: '4px' },
  { shape: 'oval', label: 'Oval', w: 54, h: 32, r: '50%' },
  { shape: 'circle', label: 'Circle', w: 38, h: 38, r: '50%' },
]

export const DEFAULT_TABLE: TableConfig = {
  shape: 'rectangle',
  max_long: 4,
  max_end: 2,
  max_side: 3,
  spoon_layout: 'center',
}

/** The editable table fields only (the server rejects extras like `capacity`). */
export function tableOnly(t: TableConfig): TableConfig {
  return { shape: t.shape, max_long: t.max_long, max_end: t.max_end, max_side: t.max_side, spoon_layout: t.spoon_layout }
}

export function usePreview(players: number, table: TableConfig) {
  return useQuery({
    queryKey: ['preview', players, table],
    queryFn: () => api.preview(players, tableOnly(table)),
    placeholderData: keepPreviousData,
  })
}

function Stepper({ label, hint, value, min, max, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className="stepper">
      <div className="grow stack-tight">
        <span className="strong">{label}</span>
        <span className="muted small">{hint}</span>
      </div>
      <button className="icon-btn" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <button className="icon-btn" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

export function capacityLine(t: TableConfig, pv: Preview | undefined): { text: string; ok: boolean } | null {
  if (!pv) return null
  const sum = t.shape === 'rectangle'
    ? ` (${t.max_long} + ${t.max_long} + ${t.max_end} + ${t.max_end})`
    : t.shape === 'square' ? ` (4 × ${t.max_side})` : ''
  const who = pv.uses_divisions ? `biggest table needs ${pv.largest_group}` : `${pv.players} players`
  if (pv.capacity == null) return { text: `No seat limit on a ${t.shape} table — ${who}`, ok: true }
  return pv.fits
    ? { text: `Seats ${pv.capacity}${sum} — ${who}, everyone fits`, ok: true }
    : { text: `Seats ${pv.capacity}${sum} — ${who}. Add seats.`, ok: false }
}

/** Shape, per-side limits and spoon layout. Used by the setup wizard, Change table and Settings. */
export function TableFields({ table, onChange, preview }: {
  table: TableConfig; onChange: (t: TableConfig) => void; preview?: Preview
}) {
  const set = (patch: Partial<TableConfig>) => onChange({ ...table, ...patch })
  const cap = capacityLine(table, preview)
  const between = table.spoon_layout === 'between'
  return (
    <div className="stack-lg">
      <fieldset className="fieldset">
        <legend className="section-label">TABLE SHAPE</legend>
        <div className="shape-grid">
          {SHAPES.map((s) => (
            <button
              key={s.shape}
              className="shape-btn"
              aria-pressed={table.shape === s.shape}
              onClick={() => set({ shape: s.shape })}
            >
              <span aria-hidden="true" className="shape-icon" style={{ width: s.w, height: s.h, borderRadius: s.r }} />
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      {(table.shape === 'rectangle' || table.shape === 'square') && (
        <fieldset className="fieldset">
          <legend className="section-label">MAX PLAYERS PER SIDE</legend>
          {table.shape === 'rectangle' ? (
            <>
              <Stepper label="Long sides" hint="Top and bottom, equal" value={table.max_long} min={1} max={10} onChange={(v) => set({ max_long: v })} />
              <Stepper label="Ends" hint="Left and right, equal" value={table.max_end} min={0} max={6} onChange={(v) => set({ max_end: v })} />
            </>
          ) : (
            <Stepper label="Each side" hint="All four sides" value={table.max_side} min={1} max={8} onChange={(v) => set({ max_side: v })} />
          )}
        </fieldset>
      )}
      {cap && <p className={cap.ok ? 'ok-text' : 'bad-text'} role="status">{cap.text}</p>}

      <fieldset className="fieldset">
        <legend className="section-label">SPOON LAYOUT</legend>
        <div className="segmented">
          <button aria-pressed={!between} onClick={() => set({ spoon_layout: 'center' })}>Center pile</button>
          <button aria-pressed={between} onClick={() => set({ spoon_layout: 'between' })}>Between players</button>
        </div>
        <p className="muted small">
          {between
            ? 'One spoon about 12 in from the edge in each gap between players. One gap is left empty at random each round (rule 1.2.2, 2026).'
            : 'Spoons evenly spaced down the middle, heads alternating, one fewer than players (rulebook v2.1).'}
        </p>
      </fieldset>
    </div>
  )
}

/** Live preview of the table the engine would draw for the biggest group. */
export function TablePreview({ preview }: { preview?: Preview }) {
  if (!preview || !preview.seats.length) return <div className="preview-empty muted">Add players to see the table</div>
  return (
    <div className="preview-wrap">
      <TableDiagram geo={preview} compact />
      {preview.empty_gap && (
        <p className="muted small center">
          Empty gap shown at <b>seats {preview.empty_gap.seats[0]} &amp; {preview.empty_gap.seats[1]}</b> — picked at random every round
        </p>
      )}
    </div>
  )
}

export function stagePlanText(pv: Preview): string {
  return pv.stage_plan
    .map((st, i) =>
      'final' in st
        ? `${i === 0 ? 'One table' : 'Final table'} of ${st.final}`
        : `Stage ${i + 1}: ${st.sizes.length} divisions (${st.sizes.join(', ')})`,
    )
    .join(' → ')
}

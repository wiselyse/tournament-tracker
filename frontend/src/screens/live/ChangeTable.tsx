import { useState } from 'react'
import type { TableConfig } from '../../api/types'
import { Sheet } from '../../components/Sheet'
import { tableOnly, TableFields, usePreview } from '../../components/TableStep'
import { useT } from '../../state/tournament'

export function tableSummary(t: TableConfig): string {
  const shape = t.shape[0].toUpperCase() + t.shape.slice(1)
  if (t.shape === 'rectangle') return `${shape} · ${t.max_long} long / ${t.max_end} end`
  if (t.shape === 'square') return `${shape} · ${t.max_side} per side`
  return shape
}

/** The Change table sheet: the setup table step, applied now (re-roll) or at the next seating. */
export function ChangeTable({ onClose }: { onClose: () => void }) {
  const { state, act, pending } = useT()
  const [table, setTable] = useState<TableConfig>(() => tableOnly(state.table_config))
  const playing = state.players.filter((p) => p.status === 'in').length
  const alive = state.players.filter((p) => ['in', 'waiting', 'advanced'].includes(p.status)).length
  const pv = usePreview(state.tournament.started ? Math.max(playing, 2) : alive, table)
  const live = !!state.round && !state.round.ended

  const apply = async (reroll: boolean) => {
    if (await act({ type: 'change_table', table, reroll })) onClose()
  }

  return (
    <Sheet title="Change table" onClose={onClose}>
      <TableFields table={table} onChange={setTable} preview={pv.data} />
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-surface" disabled={pending || pv.data?.fits === false} onClick={() => apply(false)}>
          Apply at next seating
        </button>
        {live && (
          <button className="btn btn-primary" disabled={pending || pv.data?.fits === false} onClick={() => apply(true)}>
            Apply and re-roll now
          </button>
        )}
      </div>
    </Sheet>
  )
}

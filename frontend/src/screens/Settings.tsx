import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import type { Rules, TableConfig } from '../api/types'
import { ThemeButton } from '../components/Shell'
import { DEFAULT_TABLE, TableFields, usePreview } from '../components/TableStep'

const NUMBERS: { key: keyof Rules; label: string; hint: string }[] = [
  { key: 'division_threshold', label: 'Divisions above', hint: 'Rule 2.1.3 · players' },
  { key: 'max_per_table', label: 'Max per table', hint: 'Rule 1.2.1 · when divisions run' },
  { key: 'false_grab_dq_at', label: 'False grabs to DQ', hint: 'Rule 3.2' },
  { key: 'card_pass_forfeit_at', label: 'Card-pass forfeit at', hint: 'Rule 3.5 · offense number' },
  { key: 'second_dealer_at', label: 'Second dealer from', hint: 'Rule 1.3.3 · players at the table' },
]

/** Server-side defaults for NEW tournaments (shared by every device). */
export function Settings() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [rules, setRules] = useState<Partial<Rules>>({})
  const [table, setTable] = useState<TableConfig>(DEFAULT_TABLE)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pv = usePreview(10, table)

  useEffect(() => {
    if (!q.data) return
    setRules(q.data.rules)
    setTable({ ...DEFAULT_TABLE, spoon_layout: q.data.rules.spoon_layout, ...q.data.default_table })
  }, [q.data])

  const save = async () => {
    if (!q.data) return
    // Store only what differs from the rulebook defaults.
    const merged = { ...rules, spoon_layout: table.spoon_layout }
    const overrides = Object.fromEntries(
      Object.entries(merged).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(q.data.rule_defaults[k as keyof Rules])),
    )
    try {
      await api.saveSettings({ rules_overrides: overrides, default_table: table })
      qc.invalidateQueries({ queryKey: ['settings'] })
      setMsg({ ok: true, text: 'Saved. New tournaments use these settings; running ones keep their own.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="page page-wide">
      <header className="page-head">
        <Link to="/" className="back-link">← Tournaments</Link>
        <h1 className="page-title grow">Settings</h1>
        <ThemeButton />
      </header>
      {q.isError && <p className="error-banner">{q.error.message}</p>}
      <div className="settings-grid">
        <section className="stack-lg">
          <h2 className="section-label">RULE THRESHOLDS</h2>
          <p className="muted small">Defaults from the 2026 rulebook (proposals 2026-2, -3, -10). Change these after a WSF vote.</p>
          {NUMBERS.map((n) => (
            <label key={n.key} className="stepper">
              <div className="grow stack-tight">
                <span className="strong">{n.label}</span>
                <span className="muted small">{n.hint}{q.data && ` · default ${q.data.rule_defaults[n.key]}`}</span>
              </div>
              <input
                className="input input-num"
                type="number"
                min={1}
                inputMode="numeric"
                value={(rules[n.key] as number | undefined) ?? ''}
                onChange={(e) => setRules({ ...rules, [n.key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </section>
        <section className="stack-lg">
          <h2 className="section-label">DEFAULT TABLE</h2>
          <TableFields table={table} onChange={setTable} preview={pv.data} />
        </section>
      </div>
      {msg && <p className={msg.ok ? 'ok-text' : 'error-banner'} role="status">{msg.text}</p>}
      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={save} disabled={!q.data}>Save settings</button>
      </div>
    </div>
  )
}

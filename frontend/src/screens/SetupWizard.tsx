import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import type { TableConfig } from '../api/types'
import { Icon } from '../components/Icon'
import { DEFAULT_TABLE, stagePlanText, TableFields, usePreview } from '../components/TableStep'

const STEPS = ['Details', 'Players', 'Table', 'Review']

/** "Ann, Bo\nCal" → ["Ann", "Bo", "Cal"] */
export function parseNames(text: string): string[] {
  return text.split(/[\n,;\t]+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function SetupWizard() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today())
  const [players, setPlayers] = useState<string[]>([])
  const [entry, setEntry] = useState('')
  const [table, setTable] = useState<TableConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The table step starts from the saved default table (Settings).
  useEffect(() => {
    if (table) return
    if (settings.data)
      setTable({ ...DEFAULT_TABLE, spoon_layout: settings.data.rules.spoon_layout, ...settings.data.default_table })
    else if (settings.isError) setTable(DEFAULT_TABLE)
  }, [settings.data, settings.isError, table])

  const tbl = table ?? DEFAULT_TABLE
  const pv = usePreview(players.length, tbl)
  const dupes = players.filter((p, i) => players.findIndex((q) => q.toLowerCase() === p.toLowerCase()) !== i)

  const addNames = (text: string) => {
    const names = parseNames(text)
    if (!names.length) return
    setPlayers((ps) => [...ps, ...names.filter((n) => !ps.some((p) => p.toLowerCase() === n.toLowerCase()))])
    setEntry('')
  }

  const canNext = [
    name.trim().length > 0,
    players.length >= 2 && dupes.length === 0,
    !!pv.data?.fits,
    true,
  ][step]

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const t = await api.create({ name: name.trim(), date: date || null, players, table: tbl })
      qc.invalidateQueries({ queryKey: ['tournaments'] })
      // If starting fails, Live shows the tournament unstarted with its own Start button,
      // so a retry here can never create a second copy.
      await api.command(t.id, { type: 'start' }).catch(() => undefined)
      nav(`/t/${t.id}/live`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="page page-wide wizard">
      <header className="page-head">
        <Link to="/" className="back-link">← Tournaments</Link>
        <h1 className="page-title grow">New tournament</h1>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>
              {i < step ? <span className="tick" aria-hidden="true">✓</span> : `${i + 1} · `}
              {s}
              {s === 'Players' && i < step ? ` · ${players.length}` : ''}
            </li>
          ))}
        </ol>
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}

      <div className="wizard-body">
        <section className="wizard-form">
          {step === 0 && (
            <div className="stack-lg">
              <label className="field">
                <span className="section-label">TOURNAMENT NAME</span>
                <input className="input input-lg" value={name} autoFocus placeholder="WSF Winter Open" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span className="section-label">DATE</span>
                <input className="input input-lg" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="stack-lg">
              <label className="field">
                <span className="section-label">ADD PLAYERS</span>
                <textarea
                  className="input textarea"
                  rows={4}
                  value={entry}
                  placeholder={'Type a name and press Enter,\nor paste a list (one per line or comma-separated)'}
                  onChange={(e) => setEntry(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      addNames(entry)
                    }
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    if (/[\n,;\t]/.test(text)) {
                      e.preventDefault()
                      addNames(entry + text)
                    }
                  }}
                />
              </label>
              <button className="btn btn-surface" onClick={() => addNames(entry)} disabled={!entry.trim()}>
                <Icon name="plus" /> Add
              </button>
              <p className="muted">{players.length} player{players.length === 1 ? '' : 's'}{players.length < 2 ? ' · need at least 2' : ''}</p>
              <ul className="chips" aria-label="Players">
                {players.map((p) => (
                  <li key={p} className="chip chip-player">
                    {p}
                    <button aria-label={`Remove ${p}`} onClick={() => setPlayers((ps) => ps.filter((q) => q !== p))}>×</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 2 && table && <TableFields table={table} onChange={setTable} preview={pv.data} />}

          {step === 3 && pv.data && (
            <div className="stack-lg">
              <dl className="review">
                <dt>Name</dt><dd>{name}</dd>
                <dt>Date</dt><dd>{date || '—'}</dd>
                <dt>Players</dt><dd>{players.length}</dd>
                <dt>Table</dt>
                <dd>
                  {tbl.shape}
                  {tbl.shape === 'rectangle' && ` · ${tbl.max_long} long / ${tbl.max_end} end`}
                  {tbl.shape === 'square' && ` · ${tbl.max_side} per side`}
                  {' · '}spoons {tbl.spoon_layout === 'between' ? 'between players' : 'center pile'}
                </dd>
                <dt>Format</dt><dd>{stagePlanText(pv.data)}</dd>
              </dl>
              {pv.data.uses_divisions && (
                <p className="note">
                  Divisions play one after another at this table, drawn at random when you start. The top half
                  of each division (rounded down) advances; you confirm each cutoff.
                </p>
              )}
            </div>
          )}

          <div className="grow" />
          <div className="row">
            {step > 0 && <button className="btn btn-ghost btn-lg" onClick={() => setStep(step - 1)}>Back</button>}
            {step < 3 ? (
              <button className="btn btn-primary btn-lg grow" disabled={!canNext} onClick={() => setStep(step + 1)}>
                Next: {STEPS[step + 1]}
              </button>
            ) : (
              <button className="btn btn-primary btn-lg grow" disabled={busy || !pv.data?.fits} onClick={start}>
                {busy ? 'Starting…' : 'Start tournament'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

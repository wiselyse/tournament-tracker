import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import type { TournamentSummary } from '../api/types'
import { useConfirm } from '../components/Confirm'
import { Icon } from '../components/Icon'

const STATUS = { setup: 'Not started', live: 'In progress', complete: 'Complete', error: "Can't be read" }

function meta(t: TournamentSummary) {
  return [t.date, `${t.players} players`, t.rounds ? `${t.rounds} round${t.rounds === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
}

export function Tournaments() {
  const q = useQuery({ queryKey: ['tournaments'], queryFn: api.list })
  const qc = useQueryClient()
  const nav = useNavigate()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    qc.invalidateQueries({ queryKey: ['tournaments'] })
  }

  const all = q.data ?? []
  const active = all.filter((t) => !t.archived && (t.status === 'live' || t.status === 'setup'))
  const needle = search.trim().toLowerCase()
  const past = all.filter(
    (t) =>
      !active.includes(t) &&
      t.archived === showArchived &&
      (!needle || `${t.name} ${t.champion ?? ''} ${t.date ?? ''}`.toLowerCase().includes(needle)),
  )

  const duplicate = (t: TournamentSummary) =>
    run(async () => {
      const copy = await api.duplicate(t.id)
      nav(`/t/${copy.id}/live`)
    })

  const importFile = async (file: File) =>
    run(async () => {
      const data = JSON.parse(await file.text())
      const t = await api.importJson(data)
      nav(`/t/${t.id}/live`)
    })

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div className="grow">
          <span className="eyebrow">WISELY SPOONS FEDERATION</span>
          <h1 className="page-title page-title-xl">Tournaments</h1>
        </div>
        <Link to="/settings" className="icon-btn show-narrow" aria-label="Settings">
          <Icon name="settings" />
        </Link>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) importFile(f)
          }}
        />
        <Link to="/new" className="btn btn-primary btn-lg">
          <Icon name="plus" strokeWidth={2.2} /> New tournament
        </Link>
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}
      {q.isError && <p className="error-banner" role="alert">{q.error.message}</p>}
      {q.isPending && <p className="muted">Loading…</p>}

      {active.length > 0 && (
        <section className="stack" aria-label="In progress">
          <h2 className="section-label">IN PROGRESS</h2>
          {active.map((t) => (
            <div key={t.id} className="resume-card">
              <div className="grow stack-tight">
                <span className="resume-name">{t.name}</span>
                <span className="resume-meta">{[STATUS[t.status], meta(t)].join(' · ')}</span>
              </div>
              <div className="resume-stats">
                <div><b>{t.rounds}</b><span>Rounds</span></div>
                <div><b>{t.players}</b><span>Players</span></div>
              </div>
              <Link to={`/t/${t.id}/live`} className="btn btn-primary btn-lg">
                {t.status === 'setup' ? 'Open' : 'Resume'}
              </Link>
              {/* Archiving moves it to "Show archived", where it can be deleted. */}
              <button
                className="icon-btn on-felt"
                aria-label={`Archive ${t.name}`}
                onClick={() => run(() => api.patch(t.id, { archived: true }))}
              >
                <Icon name="archive" />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="stack" aria-label="Past tournaments">
        <div className="row">
          <h2 className="section-label grow">{showArchived ? 'ARCHIVED' : 'PAST'}</h2>
          <label className="sr-only" htmlFor="search">Search tournaments</label>
          <input
            id="search"
            type="search"
            className="input search"
            placeholder="Search tournaments"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-ghost" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Show past' : 'Show archived'}
          </button>
        </div>
        {past.length === 0 && !q.isPending && (
          <p className="muted">{showArchived ? 'Nothing archived.' : 'No finished tournaments yet.'}</p>
        )}
        <div className="card-grid">
          {past.map((t) => (
            <article key={t.id} className="past-card">
              <div className="stack-tight">
                <span className="past-name">{t.name}</span>
                <span className="muted small">{meta(t)}</span>
              </div>
              <div className="row small-gap">
                <Icon name="trophy" size={16} />
                <span className="strong">{t.champion ?? STATUS[t.status]}</span>
              </div>
              <div className="row small-gap">
                <Link to={`/t/${t.id}/live`} className="btn btn-surface grow">Open</Link>
                <button className="icon-btn" aria-label={`Duplicate setup of ${t.name}`} onClick={() => duplicate(t)}>
                  <Icon name="copy" />
                </button>
                <a className="icon-btn" aria-label={`Download ${t.name} backup`} href={api.exportUrl(t.id)} download>
                  <Icon name="download" />
                </a>
                <button
                  className="icon-btn"
                  aria-label={`${t.archived ? 'Unarchive' : 'Archive'} ${t.name}`}
                  onClick={() => run(() => api.patch(t.id, { archived: !t.archived }))}
                >
                  <Icon name="archive" />
                </button>
                {t.archived && (
                  <button
                    className="icon-btn danger"
                    aria-label={`Delete ${t.name}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${t.name}?`,
                        body: 'This permanently removes the tournament and its whole history. Download a backup first if you might want it.',
                        confirmLabel: 'Delete',
                        destructive: true,
                      })
                      if (ok) run(() => api.remove(t.id))
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

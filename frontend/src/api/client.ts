import type { Preview, Report, Settings, TableConfig, TournamentState, TournamentSummary } from './types'

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** 409 from a command sent while the cursor is behind the head: how many actions
 *  (command groups) would be replaced, or null if it wasn't a 409. */
export function divergedActions(e: unknown): number | null {
  if (e instanceof ApiError && e.status === 409) {
    const d = (e.body as { detail?: { actions?: number } })?.detail
    return d?.actions ?? 1
  }
  return null
}

function messageOf(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown })?.detail
  if (typeof detail === 'string') return detail
  // FastAPI's own validation errors come back as a list.
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join('; ')
  return status === 0 ? "Can't reach the server" : `Request failed (${status})`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      // A stalled connection mustn't lock the controls. (Optional call: Safari < 16 lacks it.)
      signal: AbortSignal.timeout?.(10_000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection", null)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, messageOf(res.status, data), data)
  return data as T
}

export interface CreateBody {
  name: string
  date: string | null
  players: string[]
  table: Partial<TableConfig>
}

export const api = {
  list: () => request<TournamentSummary[]>('GET', '/tournaments'),
  get: (id: string) => request<TournamentState>('GET', `/tournaments/${id}`),
  create: (body: CreateBody) => request<TournamentState>('POST', '/tournaments', body),
  command: (id: string, cmd: Record<string, unknown>) =>
    request<TournamentState>('POST', `/tournaments/${id}/commands`, cmd),
  undo: (id: string) => request<TournamentState>('POST', `/tournaments/${id}/undo`),
  redo: (id: string) => request<TournamentState>('POST', `/tournaments/${id}/redo`),
  rewind: (id: string, seq: number) =>
    request<TournamentState>('POST', `/tournaments/${id}/rewind`, { seq }),
  duplicate: (id: string) => request<TournamentState>('POST', `/tournaments/${id}/duplicate`, {}),
  patch: (id: string, body: { name?: string; date?: string | null; archived?: boolean }) =>
    request<TournamentState>('PATCH', `/tournaments/${id}`, body),
  remove: (id: string) => request<void>('DELETE', `/tournaments/${id}`),
  importJson: (data: unknown) => request<TournamentState>('POST', '/tournaments/import', data),
  exportUrl: (id: string) => `/api/tournaments/${id}/export.json`,
  report: (id: string) => request<Report>('GET', `/tournaments/${id}/report`),
  preview: (players: number, table: Partial<TableConfig>) =>
    request<Preview>('POST', '/preview', { players, table }),
  settings: () => request<Settings>('GET', '/settings'),
  saveSettings: (body: { rules_overrides: object; default_table: object }) =>
    request<Settings>('PUT', '/settings', body),
}

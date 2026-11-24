import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { api, divergedActions } from '../api/client'
import type { TimelineEntry, TournamentState } from '../api/types'
import { useConfirm } from '../components/Confirm'

export interface Toast {
  id: number
  text: string
  kind: 'done' | 'undone' | 'error'
}

interface Ctx {
  state: TournamentState
  pending: boolean
  /** Send a command. Resolves true when it was applied. */
  act: (cmd: Record<string, unknown>) => Promise<boolean>
  undo: () => Promise<void>
  redo: () => Promise<void>
  rewind: (seq: number) => Promise<void>
  toast: Toast | null
  dismissToast: () => void
  name: (playerId: string) => string
}

const TournamentCtx = createContext<Ctx | null>(null)

export function useT(): Ctx {
  const c = useContext(TournamentCtx)
  if (!c) throw new Error('useT outside TournamentProvider')
  return c
}

/** The newest command group's first entry: "Kit out", not the round it started. */
function lastAction(timeline: TimelineEntry[]): string | null {
  if (!timeline.length) return null
  const group = timeline[timeline.length - 1].group
  return timeline.find((e) => e.group === group)?.label ?? null
}

export function useTournamentQuery(id: string) {
  return useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.get(id),
    refetchInterval: 15_000, // other devices may be looking at the same tournament
  })
}

/** Round-by-round history; refetched whenever the tournament moves (cursor changes). */
export function useReport() {
  const { state } = useT()
  return useQuery({
    queryKey: ['report', state.id, state.cursor, state.head],
    queryFn: () => api.report(state.id),
    placeholderData: (prev) => prev,
  })
}

export function TournamentProvider({ state, children }: { state: TournamentState; children: ReactNode }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [pending, setPending] = useState(false)
  const busy = useRef(false) // synchronous guard: one command in flight at a time
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const id = state.id

  const show = useCallback((text: string, kind: Toast['kind']) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text, kind })
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 7000 : 5000)
  }, [])

  const run = useCallback(
    async (
      fn: () => Promise<TournamentState>,
      onOk?: (s: TournamentState) => void,
      handled?: (e: unknown) => boolean,
    ): Promise<boolean> => {
      if (busy.current) return false
      busy.current = true
      setPending(true)
      try {
        const next = await fn()
        await qc.cancelQueries({ queryKey: ['tournament', id] }) // an older poll mustn't overwrite this
        qc.setQueryData(['tournament', id], next)
        qc.invalidateQueries({ queryKey: ['tournaments'] })
        onOk?.(next)
        return true
      } catch (e) {
        if (handled?.(e)) return false
        show(e instanceof Error ? e.message : String(e), 'error')
        // Refetch either way: after a network failure the command may still have landed.
        qc.invalidateQueries({ queryKey: ['tournament', id] })
        return false
      } finally {
        busy.current = false
        setPending(false)
      }
    },
    [id, qc, show],
  )

  const act = useCallback(
    async (cmd: Record<string, unknown>) => {
      const done = (s: TournamentState) => show(lastAction(s.timeline) ?? 'Done', 'done')
      let diverged: number | null = null
      const ok = await run(
        () => api.command(id, cmd),
        done,
        (e) => (diverged = divergedActions(e)) !== null,
      )
      if (ok || diverged === null) return ok
      // Undo-then-correct is the common fix: replacing just the one undone action needs no dialog.
      if (diverged > 1) {
        const yes = await confirm({
          title: `Replace ${diverged} later actions?`,
          body: "You've stepped back in the history. Doing this throws away everything after this point.",
          confirmLabel: 'Replace them',
          destructive: true,
        })
        if (!yes) return false
      }
      return run(() => api.command(id, { ...cmd, discard_future: true }), done)
    },
    [id, run, show, confirm],
  )

  const undo = useCallback(async () => {
    const undone = lastAction(state.timeline)
    await run(() => api.undo(id), () => show(`Undone: ${undone ?? 'last action'}`, 'undone'))
  }, [id, run, show, state.timeline])

  const redo = useCallback(async () => {
    await run(() => api.redo(id), (s) => show(`Redone: ${lastAction(s.timeline) ?? ''}`, 'done'))
  }, [id, run, show])

  const rewind = useCallback(
    async (seq: number) => {
      await run(() => api.rewind(id, seq), () => show('Rewound', 'undone'))
    },
    [id, run, show],
  )

  const names = new Map(state.players.map((p) => [p.id, p.name]))

  return (
    <TournamentCtx.Provider
      value={{
        state,
        pending,
        act,
        undo,
        redo,
        rewind,
        toast,
        dismissToast: () => setToast(null),
        name: (pid) => names.get(pid) ?? '?',
      }}
    >
      {children}
    </TournamentCtx.Provider>
  )
}

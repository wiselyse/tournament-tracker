import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { api, divergedActions } from '../api/client'
import type { TournamentState } from '../api/types'
import { useConfirm } from '../components/Confirm'

export interface Toast {
  id: number
  text: string
  kind: 'error' // only problems pop up; Undo and the timeline cover everything else
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
    toastTimer.current = window.setTimeout(() => setToast(null), 7000)
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
      let diverged: number | null = null
      const ok = await run(
        () => api.command(id, cmd),
        undefined,
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
      return run(() => api.command(id, { ...cmd, discard_future: true }))
    },
    [id, run, confirm],
  )

  const undo = useCallback(async () => {
    await run(() => api.undo(id))
  }, [id, run])

  const redo = useCallback(async () => {
    await run(() => api.redo(id))
  }, [id, run])

  const rewind = useCallback(
    async (seq: number) => {
      // Redo brings the later events back; a new action replaces them (asked first).
      await run(() => api.rewind(id, seq))
    },
    [id, run],
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

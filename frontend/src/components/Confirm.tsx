import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

type Ask = (o: ConfirmOptions) => Promise<boolean>
const Ctx = createContext<Ask>(async () => false)

/** Promise-based confirm dialog. Only for DQ, cutoff, history truncation and delete. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const ask = useCallback<Ask>((o) => new Promise((resolve) => setOpen({ ...o, resolve })), [])
  const confirmRef = useRef<HTMLButtonElement>(null)

  const close = (ok: boolean) => {
    open?.resolve(ok)
    setOpen(null)
  }

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Ctx.Provider value={ask}>
      {children}
      {open && (
        <div className="scrim" onClick={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title" className="dialog-title">{open.title}</h2>
            {open.body && <div className="dialog-body">{open.body}</div>}
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                {open.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmRef}
                className={open.destructive ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => close(true)}
              >
                {open.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export const useConfirm = () => useContext(Ctx)

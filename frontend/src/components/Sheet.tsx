import { useEffect, type ReactNode } from 'react'

/** Modal sheet: centred dialog on tablets and desktops, slides up from the bottom on phones. */
export function Sheet({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet${wide ? ' sheet-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <h2 className="dialog-title grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </div>
  )
}

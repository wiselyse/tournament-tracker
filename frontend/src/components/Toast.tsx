import { useT } from '../state/tournament'

/** One-tap undo after every action (HANDOFF §8.2). */
export function Toast() {
  const { toast, undo, redo, dismissToast, state, pending } = useT()
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} key={toast.id}>
      <span className="grow">{toast.text}</span>
      {toast.kind === 'done' && state.can_undo && (
        <button className="toast-btn" onClick={undo} disabled={pending}>Undo</button>
      )}
      {toast.kind === 'undone' && state.can_redo && (
        <button className="toast-btn" onClick={redo} disabled={pending}>Redo</button>
      )}
      <button className="toast-x" onClick={dismissToast} aria-label="Dismiss">×</button>
    </div>
  )
}

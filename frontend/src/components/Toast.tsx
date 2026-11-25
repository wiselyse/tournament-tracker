import { useT } from '../state/tournament'

/** Shows why a command was refused (or couldn't reach the server). Successes stay quiet:
 *  Undo and the timeline already say what happened. */
export function Toast() {
  const { toast, dismissToast } = useT()
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.kind}`} role="alert" key={toast.id}>
      <span className="grow">{toast.text}</span>
      <button className="toast-x" onClick={dismissToast} aria-label="Dismiss">×</button>
    </div>
  )
}

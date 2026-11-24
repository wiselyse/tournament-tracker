import { useEffect, useMemo, useState } from 'react'
import type { Round } from '../../api/types'
import { fmtDuration } from '../../state/describe'

/** Ticks once a second. `offset` corrects this device's clock to the server's. */
export function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset), 1000)
    return () => window.clearInterval(t)
  }, [offset])
  return now
}

export function useServerOffset(serverNow: number) {
  // Recomputed each time fresh state arrives; good to within one request's latency.
  return useMemo(() => serverNow - Date.now(), [serverNow])
}

export function roundElapsed(r: Round, now: number): number {
  const end = r.ended && r.ended_at ? r.ended_at : now
  const paused = r.paused_ms + (r.paused_since != null ? end - r.paused_since : 0)
  return end - r.started_at - paused
}

export function Elapsed({ since, now }: { since: number; now: number }) {
  return <>{fmtDuration(now - since)}</>
}

export function agoText(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

// Stroke icons from the mockups (24×24, currentColor).
const PATHS: Record<string, string[]> = {
  live: ['C12 12 9', 'C12 12 3'],
  players: [
    'C9 8 3.5',
    'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6',
    'M16 4.5a3.5 3.5 0 0 1 0 7',
    'M18 14.3c2.1.7 3.5 2.8 3.5 5.7',
  ],
  bracket: ['M3 5h5v6H3', 'M3 13h5v6H3', 'M8 8h4v8H8', 'M12 12h9'],
  timeline: ['C12 12 9', 'M12 7v5l3 2'],
  report: ['M5 20V11', 'M11 20V5', 'M17 20v-7', 'M3 20h18'],
  export: ['M12 3v12', 'M7 8l5-5 5 5', 'M5 13v7h14v-7'],
  settings: [
    'M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12',
    'C16 6 2', 'C10 12 2', 'C18 18 2',
  ],
  more: ['C5 12 1.5', 'C12 12 1.5', 'C19 12 1.5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  sun: ['C12 12 4', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  pause: ['M9 5v14', 'M15 5v14'],
  play: ['M7 5l12 7-12 7z'],
  out: ['C12 12 9', 'M9 9l6 6', 'M15 9l-6 6'],
  stalemate: ['M3 12h6', 'M15 12h6', 'M6 8l4 4-4 4', 'M18 8l-4 4 4 4'],
  flag: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  swap: ['M7 4L3 8l4 4', 'M3 8h14', 'M17 20l4-4-4-4', 'M21 16H7'],
  withdraw: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  copy: ['M10 8h10v12H8V8', 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
  archive: ['M3 4h18v5H3z', 'M5 9v10h14V9', 'M10 13h4'],
  trophy: [
    'M8 21h8', 'M12 17v4', 'M7 4h10v5a5 5 0 0 1-10 0V4z',
    'M17 6h3v2a3 3 0 0 1-3 3', 'M7 6H4v2a3 3 0 0 0 3 3',
  ],
  shuffle: ['M16 3h5v5', 'M4 20L21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  back: ['M15 18l-6-6 6-6'],
  rewind: ['M11 6L5 12l6 6V6z', 'M19 6l-6 6 6 6V6z'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  upload: ['M12 15V3', 'M7 8l5-5 5 5', 'M5 21h14'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
}

export function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(PATHS[name] ?? []).map((d, i) => {
        if (d.startsWith('C ') || /^C\d/.test(d)) {
          const [cx, cy, r] = d.slice(1).trim().split(/\s+/).map(Number)
          return <circle key={i} cx={cx} cy={cy} r={r} />
        }
        return <path key={i} d={d} />
      })}
    </svg>
  )
}

/** The spoon glyph from HANDOFF §8.3. Its head (bowl) points left. */
export function SpoonGlyph({ width = 40, color = 'var(--spoon)' }: { width?: number; color?: string }) {
  return (
    <svg width={width} height={(width * 28) / 96} viewBox="0 0 96 28" aria-hidden="true">
      <ellipse cx="18" cy="14" rx="16" ry="11" fill={color} />
      <path d="M32 12.5 C 50 11, 70 10, 88 9.5 a 4.5 4.5 0 0 1 0 9 C 70 18, 50 17, 32 15.5 Z" fill={color} />
    </svg>
  )
}

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
const KEY = 'wsf-theme'

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Dark by default; the choice is a per-device convenience kept in localStorage. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(stored)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

// Apply before React mounts so there's no flash of the wrong theme.
document.documentElement.dataset.theme = stored()

import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/eb-garamond/400-italic.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './theme/useTheme'
import { registerSW } from 'virtual:pwa-register'

// State lives on the server, so reloading into a new build is always safe. A home-screen
// app resumes without navigating, so also look for a new build whenever it comes back.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration?.update().catch(() => undefined)
    })
  },
})
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

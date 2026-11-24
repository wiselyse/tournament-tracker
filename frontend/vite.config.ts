import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in main.tsx
      manifest: {
        name: 'WSF Tournament Tracker',
        short_name: 'WSF Tracker',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#2a2c33',
        theme_color: '#23252b',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      // A new build takes over straight away; main.tsx then reloads into it.
      workbox: { navigateFallbackDenylist: [/^\/api/], skipWaiting: true, clientsClaim: true },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // tailscale serve points at 5173: fail loudly rather than move ports
    allowedHosts: ['.ts.net'], // reached as https://<machine>.<tailnet>.ts.net
    proxy: { '/api': 'http://127.0.0.1:8421' }, // dev backend (dev.sh); the live app uses 8420
  },
})

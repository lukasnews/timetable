import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD = (process.env.GITHUB_SHA ?? 'lokal').slice(0, 7);
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: './',
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Familienkalender',
        short_name: 'Familienkalender',
        description: 'Familienkalender für Tablet und Handy',
        theme_color: '#0e0f15',
        background_color: '#f3c896',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        id: './',
        lang: 'de',
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Neue Version aktiviert sich selbst; das Neuladen steuert die App (siehe src/main.tsx)
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Dienst (/svc), Datenschutz- und Offline-Seite nicht durch die App-Startseite ersetzen
        navigateFallbackDenylist: [/^\/svc\//, /^\/datenschutz/, /^\/offline/, /\.(ics|json|txt)$/],
      },
    }),
  ],
  build: {
    // Auch ältere Android-WebViews/iPads unterstützen (Syntax wird bei Bedarf umgeschrieben)
    target: ['es2019', 'chrome74', 'safari13', 'firefox78', 'edge88'],
    cssTarget: ['chrome74', 'safari13', 'firefox78', 'edge88'],
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], calendar: ['@fullcalendar/core', '@fullcalendar/react', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction'] },
      },
    },
  },
  test: { environment: 'node' },
} as any);

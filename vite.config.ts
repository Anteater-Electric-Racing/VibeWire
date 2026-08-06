import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API used to be mounted in-process here via a static `import
// { createApiMiddleware } from './server/api'`. Vite treats every file
// statically (or dynamically) reachable from vite.config.ts as a "config
// dependency" and does a full dev-server restart whenever any of them
// change — which then forces every connected browser tab to hard-reload
// (see the Vite client's `vite:ws:disconnect` -> reload behavior). Since
// server/api.ts transitively pulls in nearly everything under server/,
// editing *any* backend file caused a full page reload.
//
// The API now runs as its own process (`npm run dev:api`, started
// alongside Vite by `npm run dev`) and is reached through this proxy
// instead, so backend edits only restart the API process and never touch
// the frontend dev server or the browser.
const API_PORT = process.env.PORT ?? '3001'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  publicDir: 'public',
  server: {
    allowedHosts: true,
    fs: {
      allow: ['.'],
    },
    watch: {
      ignored: [
        '**/public/user-data/**',
        // Every autosave and edit-log append writes here (edit-log, revisions,
        // attribution, checkpoints). None of it is ever imported by the app,
        // but Vite's watcher still notices the writes (they land via
        // write-temp-then-rename, so they arrive as add/unlink events) and
        // broadcasts a `full-reload` over the HMR socket, hard-reloading the
        // browser tab on literally every edit made in the app. Confirmed by
        // reproducing it with a bare `fs.rename` into this directory with no
        // app/browser involved at all.
        '**/vibewire-state/**',
      ],
    },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
})

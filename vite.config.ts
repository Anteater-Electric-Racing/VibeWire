import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createApiMiddleware } from './server/api'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'vibewire-server',
      configureServer(server) {
        // Full REST API (handles all /api/* routes including auto-save endpoints)
        server.middlewares.use(createApiMiddleware(__dirname));
      },
    },
  ],
  publicDir: 'public',
  server: {
    fs: {
      allow: ['.'],
    },
    watch: {
      ignored: [
        '**/public/user-data/**',
      ],
    },
  },
})

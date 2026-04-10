import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { createApiMiddleware } from './server/api'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'vibewire-server',
      configureServer(server) {
        // Full REST API (handles all /api/* routes including legacy save endpoints)
        server.middlewares.use(createApiMiddleware(__dirname));

        // Serve connector library images at /connector-lib-photos/
        server.middlewares.use('/connector-lib-photos', (req, res, next) =>
          serveStaticDir('connector_library', req, res, next));

        // Serve general image assets at /img-assets/
        server.middlewares.use('/img-assets', (req, res, next) =>
          serveStaticDir('img_assets_besides_connectors', req, res, next));

        // Serve connector-library.json from connector_library/ (overrides public/ copy)
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/connector-library.json') { next(); return; }
          const filePath = path.resolve(__dirname, 'connector_library/connector-library.json');
          if (!fs.existsSync(filePath)) { next(); return; }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filePath));
        });

        function serveStaticDir(
          folder: string,
          req: import('node:http').IncomingMessage,
          res: import('node:http').ServerResponse,
          next: () => void,
        ) {
          const filename = (req.url ?? '/').replace(/^\//, '').split('?')[0];
          if (!filename) { next(); return; }
          const filePath = path.resolve(__dirname, folder, filename);
          if (!fs.existsSync(filePath)) { next(); return; }
          const ext = path.extname(filename).toLowerCase();
          const mime: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
          };
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
          res.end(fs.readFileSync(filePath));
        }
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
        '**/public/harnesses/**',
        '**/public/layouts.json',
        '**/connector_library/connector-library.json',
      ],
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'save-api',
      configureServer(server) {
        function jsonPost(
          req: import('node:http').IncomingMessage,
          res: import('node:http').ServerResponse,
          filePath: string,
        ) {
          if (req.method !== 'POST') {
            res.statusCode = 405; res.end('Method Not Allowed'); return;
          }
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              JSON.parse(body);
              fs.writeFileSync(path.resolve(__dirname, filePath), body, 'utf-8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 400; res.end(String(e));
            }
          });
        }

        server.middlewares.use('/api/save-harness', (req, res) =>
          jsonPost(req, res, 'public/harnesses/fsae-car.json'));

        server.middlewares.use('/api/save-layouts', (req, res) =>
          jsonPost(req, res, 'public/layouts.json'));

        server.middlewares.use('/api/save-library', (req, res) =>
          jsonPost(req, res, 'connector_library/connector-library.json'));

        // Serve all non-connector images from img_assets_besides_connectors/
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

        server.middlewares.use('/img-assets', (req, res, next) =>
          serveStaticDir('img_assets_besides_connectors', req, res, next));

        // List available image assets
        server.middlewares.use('/api/list-assets', (_req, res) => {
          const dir = path.resolve(__dirname, 'img_assets_besides_connectors');
          try {
            const files = fs.existsSync(dir)
              ? fs.readdirSync(dir).filter((f) =>
                  /\.(png|jpe?g|webp|gif)$/i.test(f))
              : [];
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
          } catch {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end('[]');
          }
        });

        // connector_library/ — serves images at /connector-lib-photos/ and JSON at /connector-library.json
        server.middlewares.use('/connector-lib-photos', (req, res, next) =>
          serveStaticDir('connector_library', req, res, next));

        // List connector library images
        server.middlewares.use('/api/list-connector-assets', (_req, res) => {
          const dir = path.resolve(__dirname, 'connector_library');
          try {
            const files = fs.existsSync(dir)
              ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
              : [];
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
          } catch {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end('[]');
          }
        });

        // Serve connector-library.json from connector_library/ (overrides public/ copy)
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/connector-library.json') { next(); return; }
          const filePath = path.resolve(__dirname, 'connector_library/connector-library.json');
          if (!fs.existsSync(filePath)) { next(); return; }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filePath));
        });
      },
    },
  ],
  publicDir: 'public',
  server: {
    fs: {
      allow: ['.'],
    },
  },
})

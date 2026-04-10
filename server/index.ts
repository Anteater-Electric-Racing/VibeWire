import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const port = parseInt(process.env.PORT ?? '3001');

const api = createApiMiddleware(projectRoot);

const server = http.createServer((req, res) => {
  api(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

server.listen(port, () => {
  console.log(`
  VibeWire API server
  ───────────────────
  URL:    http://localhost:${port}
  Root:   ${projectRoot}

  Try:    curl http://localhost:${port}/api
          curl http://localhost:${port}/api/harness/stats
          curl http://localhost:${port}/api/enclosures
`);
});

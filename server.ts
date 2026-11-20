import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './server/app.js';
import { closeDatabase, ensureDatabaseReady, sanitizeDbErrorMessage } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  try {
    await ensureDatabaseReady();
  } catch (err) {
    console.warn('[NOVA AI] PostgreSQL non initialisé au démarrage :', sanitizeDbErrorMessage(err));
  }

  const app = createApp();

  // Frontend Dev / Prod Static Serving (local & standalone Node hosting)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`NOVA AI server listening on http://localhost:${PORT}`);
  });
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 120_000;

  const shutdown = async () => {
    httpServer.close(async () => {
      await closeDatabase().catch(() => {});
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

startServer().catch((err) => {
  console.error('Failed to start NOVA AI server:', err);
  process.exit(1);
});

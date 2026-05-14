import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEmbeddedPostgres } from './db/postgres.js';
import { initDb, closeDb } from './db/index.js';
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import squadRouter from './routes/squad.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// packages/server/dist/index.js → up 2 → packages/ → client/dist
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

async function main(): Promise<void> {
  const startMs = Date.now();
  console.log('[squadboard] starting…');

  const connectionString = await startEmbeddedPostgres();
  await initDb(connectionString);

  const app = express();
  app.use(express.json());

  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/squad', squadRouter);

  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    // SPA fallback — let the React router handle unknown paths
    app.use((_req, res) => {
      res.sendFile(join(CLIENT_DIST, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.json({
        message: 'Squadboard API',
        version: '0.1.0',
        endpoints: ['/api/health', '/api/projects'],
        note: 'Frontend not yet built — run Keyser\'s `pnpm build` in packages/client first',
      });
    });
  }

  const server = app.listen(PORT, () => {
    const elapsed = Date.now() - startMs;
    console.log(
      `[squadboard] ready in ${elapsed}ms → http://localhost:${PORT}`,
    );
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`[squadboard] received ${signal}`);
    server.close(() => {
      closeDb()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('[squadboard] fatal startup error:', err);
  process.exit(1);
});

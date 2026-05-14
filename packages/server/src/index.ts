import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEmbeddedPostgres } from './db/postgres.js';
import { initDb, closeDb } from './db/index.js';
import healthRouter from './routes/health.js';
import projectsRouter from './routes/projects.js';
import squadRouter from './routes/squad.js';
import agentsRouter from './routes/agents.js';
import issuesRouter from './routes/issues.js';
import labelsRouter from './routes/labels.js';
import { issueRunsRouter, projectRunsRouter } from './routes/runs.js';
import routingRouter from './routes/routing.js';
import { workflowsRouter, issueWorkflowRouter } from './routes/workflows.js';
import { dispatcher } from './engine/dispatcher.js';

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

  // Start the workflow engine dispatcher (5 s tick: sweep → wake → advance)
  dispatcher.start();

  const app = express();
  app.use(express.json());

  app.use('/api/health', healthRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/squad', squadRouter);
  app.use('/api/projects/:projectId/agents', agentsRouter);
  app.use('/api/projects/:projectId/issues', issuesRouter);
  app.use('/api/projects/:projectId/labels', labelsRouter);
  app.use('/api/projects/:projectId/issues/:issueId/runs', issueRunsRouter);
  app.use('/api/projects/:projectId/runs', projectRunsRouter);
  app.use('/api/projects/:projectId/routing', routingRouter);
  app.use('/api/projects/:projectId/workflows', workflowsRouter);
  app.use('/api/projects/:projectId/issues/:issueId/workflow', issueWorkflowRouter);

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
    dispatcher.stop();
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

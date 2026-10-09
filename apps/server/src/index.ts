import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { migrate, pool, seed } from './db.js';
import routes from './routes.js';
import { initializeSearch } from './search.js';
import { reconcileQueue, startWorker } from './queue.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', routes);

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(serverDir, '../../web/dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(webDist, 'index.html'), (error) => error ? next() : undefined);
});

async function start() {
  try {
    await migrate();
    await seed();
    await initializeSearch();
    await reconcileQueue();
    startWorker();
  } catch (error) {
    console.warn('Optional infrastructure is not ready yet; the HTTP shell will still start.', error instanceof Error ? error.message : error);
  }
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`ReachInbox listening on http://0.0.0.0:${config.port}`));
  const shutdown = async () => { server.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => { console.error(error); process.exit(1); });

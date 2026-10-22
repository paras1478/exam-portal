import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { sweepExpiredAttempts } from './services/attempts.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.info(`ExamFlow API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Auto-submit attempts whose server-side deadline has passed, even if the student never returns.
const sweeper = setInterval(() => {
  sweepExpiredAttempts()
    .then((n) => n && console.info(`[sweeper] auto-submitted ${n} expired attempt(s)`))
    .catch((err) => console.error('[sweeper] error', err));
}, 30_000);

async function shutdown(signal: string) {
  console.info(`${signal} received, shutting down`);
  clearInterval(sweeper);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

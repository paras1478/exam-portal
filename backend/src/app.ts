import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { ok } from './lib/http.js';
import { authenticateUser } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { studentRouter } from './routes/student.js';
import { examsRouter, facultyRouter } from './routes/exams.js';
import { adminRouter } from './routes/admin.js';
import { notificationsRouter } from './routes/notifications.js';
import { docsRouter } from './routes/docs.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(res, { status: 'ok', time: new Date() });
  });
  app.use('/api/docs', docsRouter);

  app.use('/api', csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api/student', authenticateUser, studentRouter);
  app.use('/api/faculty', authenticateUser, facultyRouter);
  app.use('/api/exams', authenticateUser, examsRouter);
  app.use('/api/admin', authenticateUser, adminRouter);
  app.use('/api/notifications', authenticateUser, notificationsRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}

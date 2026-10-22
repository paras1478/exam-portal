import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, ok, paginated } from '../lib/http.js';
import { paginationSchema, skipTake } from '../lib/pagination.js';
import { authorizeRoles } from '../middleware/auth.js';
import { announcementSchema, sendAnnouncement } from '../services/announcements.js';
import { idParam } from '../schemas/common.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const q = paginationSchema.extend({ unreadOnly: z.enum(['true', 'false']).optional() }).parse(req.query);
  const where: Prisma.NotificationWhereInput = { userId: req.user!.id };
  if (q.unreadOnly === 'true') where.readAt = null;
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  return res.json({
    success: true,
    data: items,
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), unreadCount },
  });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  return ok(res, { unreadCount: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }) });
});

notificationsRouter.patch('/:id/read', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { count } = await prisma.notification.updateMany({ where: { id, userId: req.user!.id }, data: { readAt: new Date() } });
  if (!count) throw ApiError.notFound('Notification not found');
  return ok(res, { read: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const { count } = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  return ok(res, { updated: count });
});

notificationsRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { count } = await prisma.notification.deleteMany({ where: { id, userId: req.user!.id } });
  if (!count) throw ApiError.notFound('Notification not found');
  return ok(res, { deleted: true });
});

/** Faculty may announce to students; admins may announce to anyone (checked in the service). */
notificationsRouter.post('/announcements', authorizeRoles('FACULTY', 'ADMIN'), async (req, res) => {
  const body = announcementSchema.parse(req.body);
  const announcement = await sendAnnouncement(req, body);
  return ok(res, announcement, 201);
});

/** The current user's own announcement history. */
notificationsRouter.get('/announcements/mine', authorizeRoles('FACULTY', 'ADMIN'), async (req, res) => {
  const q = paginationSchema.parse(req.query);
  const where = { createdById: req.user!.id };
  const [items, total] = await Promise.all([
    prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
    prisma.announcement.count({ where }),
  ]);
  return paginated(res, items, total, q.page, q.pageSize);
});

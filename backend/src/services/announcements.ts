import type { Request } from 'express';
import type { AnnouncementAudience, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { hasPermission } from '../middleware/auth.js';

export const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120),
  message: z.string().trim().min(3, 'Message must be at least 3 characters').max(2000),
  audience: z.enum(['ALL', 'STUDENT', 'FACULTY']),
});

/** Stores the announcement and fans it out as notifications in one transaction. */
export async function sendAnnouncement(req: Request, input: z.infer<typeof announcementSchema>) {
  const canAll = await hasPermission(req, 'announcement:send_all');
  if (!canAll) {
    if (!(await hasPermission(req, 'announcement:send_students'))) throw ApiError.forbidden();
    if (input.audience !== 'STUDENT') throw ApiError.forbidden('You can only send announcements to students');
  }
  const roles: Role[] = input.audience === 'ALL' ? ['STUDENT', 'FACULTY', 'ADMIN'] : [input.audience];
  const users = await prisma.user.findMany({ where: { role: { in: roles }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });

  return prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({
      data: { title: input.title, message: input.message, audience: input.audience as AnnouncementAudience, recipients: users.length, createdById: req.user!.id },
    });
    await tx.notification.createMany({
      data: users.map((u) => ({ userId: u.id, type: 'ANNOUNCEMENT' as const, title: input.title, message: `${input.message}\n— ${req.user!.name}` })),
    });
    await audit(req, 'ANNOUNCEMENT_SENT', 'Announcement', announcement.id, { audience: input.audience, recipients: users.length, title: input.title }, tx);
    return announcement;
  });
}

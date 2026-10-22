import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

type Db = Prisma.TransactionClient | typeof prisma;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

export async function notifyUsers(userIds: string[], n: NotificationInput, db: Db = prisma) {
  if (userIds.length === 0) return;
  await db.notification.createMany({ data: userIds.map((userId) => ({ userId, ...n })) });
}

import { prisma } from '../lib/prisma.js';

export const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  deletedAt: true,
  lastLoginAt: true,
  createdAt: true,
  studentProfile: { select: { rollNumber: true, department: true, year: true, phone: true } },
  facultyProfile: { select: { employeeId: true, department: true, designation: true, phone: true } },
} as const;

export function getPublicUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: userPublicSelect });
}

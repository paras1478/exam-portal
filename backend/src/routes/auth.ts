import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, isProd } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { ApiError, ok } from '../lib/http.js';
import { signToken } from '../lib/jwt.js';
import { audit } from '../lib/audit.js';
import { mailTemplates } from '../lib/mailer.js';
import { notifyUsers } from '../lib/notify.js';
import { authenticateUser, loadPermissions, SESSION_COOKIE } from '../middleware/auth.js';
import { getPublicSettings, getSettings } from '../services/settings.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { email, facultyProfileFields, password, personName, studentProfileFields } from '../schemas/common.js';
import { getPublicUser } from '../services/users.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password-1', BCRYPT_ROUNDS);

const limiterOptions = { standardHeaders: 'draft-7' as const, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' };
const loginLimiter = rateLimit({
  ...limiterOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } },
});
const registerLimiter = rateLimit({
  ...limiterOptions,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many registrations from this network. Try again later.' } },
});

function setSessionCookie(res: Response, userId: string, tokenVersion: number) {
  res.cookie(SESSION_COOKIE, signToken(userId, tokenVersion), {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: env.JWT_EXPIRES_IN_HOURS * 3600 * 1000,
    path: '/',
  });
}

authRouter.get('/csrf', (_req, res) => ok(res, { csrfToken: issueCsrfToken(res) }));

/** Settings the login and registration screens need (no authentication). */
authRouter.get('/public-settings', async (_req, res) => ok(res, await getPublicSettings()));

/** The current user plus their effective permissions (for UI decisions only; the server re-checks everything). */
async function sessionPayload(req: import('express').Request, userId: string) {
  const [user, settings] = await Promise.all([getPublicUser(userId), getSettings()]);
  const permissions = req.user ? [...(await loadPermissions(req))].sort() : [];
  return {
    ...user,
    permissions,
    policy: { requireExamApproval: settings.requireExamApproval, facultyCanPublishResults: settings.facultyCanPublishResults },
  };
}

const registerSchema = z.object({
  name: personName,
  email,
  password,
  rollNumber: studentProfileFields.shape.rollNumber,
  department: studentProfileFields.shape.department,
  year: studentProfileFields.shape.year,
});

/** Public self-registration always creates a STUDENT; elevated roles are assigned by admins only. */
authRouter.post('/register', registerLimiter, async (req, res) => {
  if (!(await getSettings()).allowStudentRegistration) {
    throw ApiError.forbidden('Self-registration is currently closed. Contact your institution for an account.');
  }
  const body = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (exists) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
      role: 'STUDENT',
      studentProfile: { create: { rollNumber: body.rollNumber, department: body.department, year: body.year } },
    },
  });
  await notifyUsers([user.id], {
    type: 'ACCOUNT',
    title: 'Welcome to ExamFlow',
    message: 'Your student account is ready. Browse available exams to get started.',
    link: '/student/exams',
  });
  void mailTemplates.welcome(user.email, user.name);
  req.user = { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status, tokenVersion: user.tokenVersion };
  await audit(req, 'USER_REGISTERED', 'User', user.id, { email: user.email });

  setSessionCookie(res, user.id, user.tokenVersion);
  issueCsrfToken(res);
  return ok(res, await sessionPayload(req, user.id), 201);
});

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const valid = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || user.deletedAt) {
    await audit(req, 'LOGIN_FAILED', 'User', user?.id, { email: body.email }, undefined, 'FAILURE');
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.status !== 'ACTIVE') {
    await audit(req, 'LOGIN_BLOCKED', 'User', user.id, { status: user.status }, undefined, 'DENIED');
    throw new ApiError(403, `Your account is ${user.status.toLowerCase()}. Contact an administrator.`, 'ACCOUNT_DISABLED');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, user.id, user.tokenVersion);
  issueCsrfToken(res); // rotate the CSRF token on privilege change
  req.user = user;
  await audit(req, 'LOGIN', 'User', user.id);
  return ok(res, await sessionPayload(req, user.id));
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  issueCsrfToken(res);
  return ok(res, { loggedOut: true });
});

authRouter.get('/me', authenticateUser, async (req, res) => ok(res, await sessionPayload(req, req.user!.id)));

const updateMeSchema = z.object({
  name: personName.optional(),
  // Students may edit contact/academic details but not their roll number (assigned by the institution).
  student: studentProfileFields.omit({ rollNumber: true }).partial().optional(),
  faculty: facultyProfileFields.omit({ employeeId: true }).partial().optional(),
});

authRouter.patch('/me', authenticateUser, async (req, res) => {
  const body = updateMeSchema.parse(req.body);
  const { id, role } = req.user!;
  await prisma.$transaction(async (tx) => {
    if (body.name) await tx.user.update({ where: { id }, data: { name: body.name } });
    if (role === 'STUDENT' && body.student) {
      await tx.studentProfile.upsert({ where: { userId: id }, create: { userId: id, ...body.student }, update: body.student });
    }
    if (role === 'FACULTY' && body.faculty) {
      await tx.facultyProfile.upsert({ where: { userId: id }, create: { userId: id, ...body.faculty }, update: body.faculty });
    }
  });
  return ok(res, await sessionPayload(req, id));
});

const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'New password must differ from the current one', path: ['newPassword'] });

authRouter.post('/me/password', authenticateUser, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('Current password is incorrect', { fieldErrors: { currentPassword: ['Current password is incorrect'] } });
  }
  // Revoke every other session, then issue a fresh cookie so this browser stays signed in.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS), tokenVersion: { increment: 1 } },
  });
  setSessionCookie(res, updated.id, updated.tokenVersion);
  await audit(req, 'PASSWORD_CHANGED', 'User', user.id);
  return ok(res, { changed: true });
});

export { BCRYPT_ROUNDS };

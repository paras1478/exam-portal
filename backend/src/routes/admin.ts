import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, ok, paginated } from '../lib/http.js';
import { paginationSchema, skipTake } from '../lib/pagination.js';
import { audit } from '../lib/audit.js';
import { mailTemplates } from '../lib/mailer.js';
import { notifyUsers } from '../lib/notify.js';
import { toCsv } from '../lib/csv.js';
import { authorizePermission, authorizeRoles, hasPermission } from '../middleware/auth.js';
import { getValidated, validateRequest } from '../middleware/validate.js';
import { email, facultyProfileFields, idParam, password, personName, searchQuery, studentProfileFields, uuid } from '../schemas/common.js';
import { getPublicUser, userPublicSelect } from '../services/users.js';
import { examPhase, isResultReleased } from '../services/examRules.js';
import { transitionExam, type ExamAction } from '../services/examWorkflow.js';
import { applyMark, loadAccessibleResult, publishExamResults, publishResult } from '../services/results.js';
import { getSettings, settingsSchema, updateSettings } from '../services/settings.js';
import { announcementSchema, sendAnnouncement } from '../services/announcements.js';
import { round2 } from '../services/grading.js';
import { examDetail } from './exams.js';
import { BCRYPT_ROUNDS } from './auth.js';

export const adminRouter = Router();
// Every admin route requires the ADMIN role *and* the specific permission declared on the route.
adminRouter.use(authorizeRoles('ADMIN'), authorizePermission('admin:access'));

const roleEnum = z.enum(['STUDENT', 'FACULTY', 'ADMIN']);
const statusEnum = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
const examStatusEnum = z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED', 'ARCHIVED']);
const dateParam = z.coerce.date().optional();

function daysAgo(n: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function dailySeries(dates: Date[], days: number) {
  const series = Array.from({ length: days }, (_, i) => ({ date: daysAgo(days - 1 - i).toISOString().slice(0, 10), count: 0 }));
  const index = new Map(series.map((s, i) => [s.date, i]));
  for (const d of dates) {
    const i = index.get(d.toISOString().slice(0, 10));
    if (i !== undefined) series[i]!.count++;
  }
  return series;
}

/** Graded results that students cannot see yet and that need an explicit publication. */
function awaitingPublicationWhere(now = new Date()): Prisma.ResultWhereInput {
  return {
    status: 'GRADED',
    publishedAt: null,
    exam: {
      resultsPublishedAt: null,
      status: { not: 'CANCELLED' },
      OR: [{ resultRelease: 'MANUAL' }, { resultRelease: 'AFTER_END', endsAt: { gte: now } }],
    },
  };
}

function sendCsv(res: import('express').Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// =====================================================================
// Dashboard
// =====================================================================
adminRouter.get('/dashboard/stats', async (_req, res) => {
  const since = daysAgo(29);
  const now = new Date();
  const active = { deletedAt: null };
  const [
    students, faculty, admins, exams, publishedExams, liveExams, submissions, pendingReview, pendingApprovalCount,
    awaitingPublication, registrations, attempts, recentActivity, statusGroups, pendingApprovals, examStatusGroups,
  ] = await Promise.all([
    prisma.user.count({ where: { ...active, role: 'STUDENT' } }),
    prisma.user.count({ where: { ...active, role: 'FACULTY' } }),
    prisma.user.count({ where: { ...active, role: 'ADMIN' } }),
    prisma.exam.count(),
    prisma.exam.count({ where: { status: 'PUBLISHED' } }),
    prisma.exam.count({ where: { status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } } }),
    prisma.examAttempt.count({ where: { status: 'SUBMITTED' } }),
    prisma.result.count({ where: { status: 'PENDING_REVIEW' } }),
    prisma.exam.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.result.count({ where: awaitingPublicationWhere(now) }),
    prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.examAttempt.findMany({ where: { submittedAt: { gte: since } }, select: { submittedAt: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { actor: { select: { name: true, role: true } } } }),
    prisma.user.groupBy({ by: ['status'], where: active, _count: true }),
    prisma.exam.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { submittedForApprovalAt: 'asc' },
      take: 5,
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { questions: true } } },
    }),
    prisma.exam.groupBy({ by: ['status'], _count: true }),
  ]);
  return ok(res, {
    stats: {
      students, faculty, admins, exams, publishedExams, liveExams, submissions, pendingReview,
      pendingApprovals: pendingApprovalCount, awaitingPublication,
    },
    registrations: dailySeries(registrations.map((r) => r.createdAt), 30),
    submissions: dailySeries(attempts.map((a) => a.submittedAt!).filter(Boolean), 30),
    accountStatus: statusGroups.map((g) => ({ status: g.status, count: g._count })),
    examStatus: examStatusGroups.map((g) => ({ status: g.status, count: g._count })),
    pendingApprovals: pendingApprovals.map(({ _count, ...e }) => ({ ...e, questionCount: _count.questions })),
    recentActivity,
    generatedAt: now,
  });
});

// =====================================================================
// Users
// =====================================================================
const usersQuery = paginationSchema.extend({
  search: searchQuery,
  role: roleEnum.optional(),
  status: statusEnum.optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  sort: z.enum(['-createdAt', 'createdAt', 'name', '-name', '-lastLoginAt']).default('-createdAt'),
});

function usersWhere(q: z.infer<typeof usersQuery>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (q.includeDeleted !== 'true') where.deletedAt = null;
  if (q.role) where.role = q.role;
  if (q.status) where.status = q.status;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { email: { contains: q.search, mode: 'insensitive' } },
      { studentProfile: { rollNumber: { contains: q.search, mode: 'insensitive' } } },
      { facultyProfile: { employeeId: { contains: q.search, mode: 'insensitive' } } },
    ];
  }
  return where;
}

adminRouter.get('/users', authorizePermission('user:read'), async (req, res) => {
  const q = usersQuery.parse(req.query);
  const where = usersWhere(q);
  const [field, dir] = q.sort.startsWith('-') ? [q.sort.slice(1), 'desc' as const] : [q.sort, 'asc' as const];
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: userPublicSelect, orderBy: { [field]: dir }, ...skipTake(q) }),
    prisma.user.count({ where }),
  ]);
  return paginated(res, items, total, q.page, q.pageSize);
});

// Kept for backwards compatibility with existing clients; prefer /reports/export?type=users.
adminRouter.get('/users/export', authorizePermission('report:export'), async (req, res) => {
  const q = usersQuery.parse({ ...req.query, page: 1, pageSize: 100 });
  return sendCsv(res, 'users.csv', await usersCsv(req, q));
});

async function usersCsv(req: Request, q: z.infer<typeof usersQuery>) {
  const users = await prisma.user.findMany({ where: usersWhere(q), select: userPublicSelect, orderBy: { createdAt: 'desc' } });
  await audit(req, 'USERS_EXPORTED', 'User', null, { rows: users.length });
  return toCsv(
    ['Name', 'Email', 'Role', 'Status', 'Roll / Employee ID', 'Department', 'Created At', 'Last Login', 'Deleted At'],
    users.map((u) => [
      u.name, u.email, u.role, u.status,
      u.studentProfile?.rollNumber ?? u.facultyProfile?.employeeId,
      u.studentProfile?.department ?? u.facultyProfile?.department,
      u.createdAt.toISOString(), u.lastLoginAt?.toISOString(), u.deletedAt?.toISOString(),
    ]),
  );
}

/** Admins create student and faculty accounts; administrator rights are granted separately via the role endpoint. */
const createUserSchema = z.object({
  name: personName,
  email,
  password,
  role: z.enum(['STUDENT', 'FACULTY']),
  student: studentProfileFields.partial().optional(),
  faculty: facultyProfileFields.partial().optional(),
});

adminRouter.post('/users', authorizePermission('user:manage'), async (req, res) => {
  const body = createUserSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: body.name, email: body.email, role: body.role, passwordHash,
        ...(body.role === 'STUDENT' && { studentProfile: { create: body.student ?? {} } }),
        ...(body.role === 'FACULTY' && { facultyProfile: { create: body.faculty ?? {} } }),
      },
    });
    await audit(req, 'USER_CREATED', 'User', created.id, { email: created.email, role: created.role }, tx);
    return created;
  });
  void mailTemplates.welcome(user.email, user.name);
  return ok(res, await getPublicUser(user.id), 201);
});

adminRouter.get('/users/:id', authorizePermission('user:read'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const user = await getPublicUser(id);
  if (!user) throw ApiError.notFound('User not found');
  const [attempts, examsCreated, recentActivity] = await Promise.all([
    prisma.examAttempt.count({ where: { studentId: id } }),
    prisma.exam.count({ where: { createdById: id } }),
    prisma.auditLog.findMany({ where: { OR: [{ actorId: id }, { entityType: 'User', entityId: id }] }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  return ok(res, { ...user, attemptCount: attempts, examsCreated, recentActivity });
});

/** Only these fields can be changed here; role/status/password have dedicated, audited endpoints. */
const updateUserSchema = z
  .object({
    name: personName.optional(),
    email: email.optional(),
    student: studentProfileFields.partial().optional(),
    faculty: facultyProfileFields.partial().optional(),
  })
  .strict();

async function loadLiveUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.deletedAt) throw ApiError.conflict('This account has been deleted', 'USER_DELETED');
  return user;
}

adminRouter.patch('/users/:id', authorizePermission('user:manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateUserSchema.parse(req.body);
  const user = await loadLiveUser(id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { name: body.name, email: body.email } });
    if (user.role === 'STUDENT' && body.student) {
      await tx.studentProfile.upsert({ where: { userId: id }, create: { userId: id, ...body.student }, update: body.student });
    }
    if (user.role === 'FACULTY' && body.faculty) {
      await tx.facultyProfile.upsert({ where: { userId: id }, create: { userId: id, ...body.faculty }, update: body.faculty });
    }
    await audit(req, 'USER_UPDATED', 'User', id, { fields: Object.keys(body), ...(body.email && body.email !== user.email && { emailChanged: true }) }, tx);
  });
  return ok(res, await getPublicUser(id));
});

/**
 * Guards for privileged changes: nobody can change their own role/status/existence, and the
 * system must always keep at least one active administrator.
 */
async function assertSafeTarget(req: Request, targetId: string) {
  if (targetId === req.user!.id) {
    await audit(req, 'SELF_MODIFICATION_BLOCKED', 'User', targetId, { path: req.originalUrl }, undefined, 'DENIED');
    throw ApiError.forbidden('You cannot change your own role, status or account from the admin panel');
  }
  const target = await loadLiveUser(targetId);
  if (target.role === 'ADMIN' && target.status === 'ACTIVE') {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } });
    if (activeAdmins <= 1) throw ApiError.conflict('At least one active administrator is required', 'LAST_ADMIN');
  }
  return target;
}

const statusSchemas = { params: idParam, body: z.object({ status: statusEnum, reason: z.string().trim().max(500).optional() }) };

adminRouter.patch('/users/:id/status', authorizePermission('user:manage'), validateRequest(statusSchemas), async (req, res) => {
  const { params, body } = getValidated(res, statusSchemas);
  const target = await assertSafeTarget(req, params.id);
  if (target.status === body.status) return ok(res, await getPublicUser(params.id));
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: params.id },
      // Leaving ACTIVE revokes every existing session immediately.
      data: { status: body.status, ...(body.status !== 'ACTIVE' && { tokenVersion: { increment: 1 } }) },
    });
    await audit(req, 'USER_STATUS_CHANGED', 'User', params.id, { from: target.status, to: body.status, reason: body.reason ?? null }, tx);
  });
  if (body.status === 'ACTIVE') await notifyUsers([params.id], { type: 'ACCOUNT', title: 'Account activated', message: 'Your account is active.' });
  return ok(res, await getPublicUser(params.id));
});

const roleSchemas = { params: idParam, body: z.object({ role: roleEnum, reason: z.string().trim().max(500).optional() }) };

adminRouter.patch('/users/:id/role', authorizePermission('role:assign'), validateRequest(roleSchemas), async (req, res) => {
  const { params, body } = getValidated(res, roleSchemas);
  const target = await assertSafeTarget(req, params.id);
  if (target.role === body.role) return ok(res, await getPublicUser(params.id));
  await prisma.$transaction(async (tx) => {
    // Privilege changes revoke existing sessions so new rights apply only after a fresh sign-in.
    await tx.user.update({ where: { id: params.id }, data: { role: body.role, tokenVersion: { increment: 1 } } });
    if (body.role === 'STUDENT') await tx.studentProfile.upsert({ where: { userId: params.id }, create: { userId: params.id }, update: {} });
    if (body.role === 'FACULTY') await tx.facultyProfile.upsert({ where: { userId: params.id }, create: { userId: params.id }, update: {} });
    await audit(req, 'USER_ROLE_CHANGED', 'User', params.id, { from: target.role, to: body.role, reason: body.reason ?? null }, tx);
  });
  await notifyUsers([params.id], { type: 'ACCOUNT', title: 'Role updated', message: `Your role is now ${body.role.toLowerCase()}. Please sign in again.` });
  return ok(res, await getPublicUser(params.id));
});

adminRouter.post('/users/:id/reset-password', authorizePermission('user:manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { newPassword } = z.object({ newPassword: password }).parse(req.body);
  if (id === req.user!.id) throw ApiError.forbidden('Change your own password from your profile');
  await loadLiveUser(id);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await audit(req, 'USER_PASSWORD_RESET', 'User', id, undefined, tx);
  });
  return ok(res, { reset: true });
});

/**
 * Retention policy: accounts with academic or audit history (attempts, results, authored exams,
 * gradings or audit entries) are soft-deleted — deactivated, hidden and unable to sign in — so
 * records stay intact. Accounts without any history are removed permanently.
 */
adminRouter.delete('/users/:id', authorizePermission('user:delete'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const target = await assertSafeTarget(req, id);
  const [attempts, exams, graded, activity] = await Promise.all([
    prisma.examAttempt.count({ where: { studentId: id } }),
    prisma.exam.count({ where: { createdById: id } }),
    prisma.submittedAnswer.count({ where: { gradedById: id } }),
    prisma.auditLog.count({ where: { actorId: id } }),
  ]);
  const hasHistory = attempts + exams + graded + activity > 0;
  const mode = hasHistory ? 'SOFT' : 'HARD';
  await prisma.$transaction(async (tx) => {
    if (mode === 'SOFT') {
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE', tokenVersion: { increment: 1 } } });
    } else {
      await tx.user.delete({ where: { id } });
    }
    await audit(req, 'USER_DELETED', 'User', id, { email: target.email, role: target.role, mode, reason: reason ?? null }, tx);
  });
  return ok(res, { deleted: true, mode });
});

// =====================================================================
// Examinations
// =====================================================================
const adminExamsQuery = paginationSchema.extend({
  search: searchQuery,
  status: examStatusEnum.optional(),
  phase: z.enum(['SCHEDULED', 'LIVE', 'ENDED']).optional(),
  createdById: uuid.optional(),
  sort: z.enum(['-createdAt', 'createdAt', 'startsAt', '-startsAt', 'title', 'submittedForApprovalAt']).default('-createdAt'),
});

adminRouter.get('/exams', authorizePermission('exam:manage_any'), async (req, res) => {
  const q = adminExamsQuery.parse(req.query);
  const now = new Date();
  const where: Prisma.ExamWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.createdById) where.createdById = q.createdById;
  if (q.phase) {
    where.status = 'PUBLISHED';
    if (q.phase === 'SCHEDULED') where.startsAt = { gt: now };
    if (q.phase === 'LIVE') Object.assign(where, { startsAt: { lte: now }, endsAt: { gte: now } });
    if (q.phase === 'ENDED') where.endsAt = { lt: now };
  }
  if (q.search) {
    where.OR = [
      { title: { contains: q.search, mode: 'insensitive' } },
      { subject: { contains: q.search, mode: 'insensitive' } },
      { createdBy: { name: { contains: q.search, mode: 'insensitive' } } },
    ];
  }
  const [field, dir] = q.sort.startsWith('-') ? [q.sort.slice(1), 'desc' as const] : [q.sort, 'asc' as const];
  const [items, total, counts] = await Promise.all([
    prisma.exam.findMany({
      where,
      orderBy: { [field]: dir },
      ...skipTake(q),
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { questions: true, attempts: true } } },
    }),
    prisma.exam.count({ where }),
    prisma.exam.groupBy({ by: ['status'], _count: true }),
  ]);
  return res.json({
    success: true,
    data: items.map(({ _count, ...e }) => ({ ...e, phase: examPhase(e, now), questionCount: _count.questions, attemptCount: _count.attempts })),
    meta: {
      page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    },
  });
});

adminRouter.get('/exams/:id', authorizePermission('exam:manage_any'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  if (!(await prisma.exam.findUnique({ where: { id }, select: { id: true } }))) throw ApiError.notFound('Exam not found');
  return ok(res, await examDetail(req, id));
});

const adminExamActions: { path: string; action: ExamAction; reasonRequired?: boolean }[] = [
  { path: 'approve', action: 'APPROVE' },
  { path: 'reject', action: 'REJECT', reasonRequired: true },
  { path: 'publish', action: 'PUBLISH' },
  { path: 'cancel', action: 'CANCEL', reasonRequired: true },
  { path: 'archive', action: 'ARCHIVE' },
  { path: 'restore', action: 'RESTORE' },
];

for (const { path, action, reasonRequired } of adminExamActions) {
  const schemas = {
    params: idParam,
    body: z.object({
      reason: reasonRequired
        ? z.string({ required_error: 'A reason is required' }).trim().min(3, 'Please give a reason (at least 3 characters)').max(1000)
        : z.string().trim().max(1000).optional().nullable(),
    }),
  };
  adminRouter.patch(`/exams/:id/${path}`, validateRequest(schemas), async (req, res) => {
    const { params, body } = getValidated(res, schemas);
    await transitionExam(req, params.id, action, body.reason);
    return ok(res, await examDetail(req, params.id));
  });
}

adminRouter.patch('/exams/:id/results/publish', authorizePermission('result:publish'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  return ok(res, await publishExamResults(req, id));
});

// =====================================================================
// Results
// =====================================================================
const resultsQuery = paginationSchema.extend({
  search: searchQuery,
  examId: uuid.optional(),
  status: z.enum(['PENDING_REVIEW', 'GRADED']).optional(),
  publication: z.enum(['awaiting', 'released']).optional(),
});

adminRouter.get('/results', authorizePermission('result:read_all'), async (req, res) => {
  const q = resultsQuery.parse(req.query);
  const now = new Date();
  const and: Prisma.ResultWhereInput[] = [];
  if (q.examId) and.push({ examId: q.examId });
  if (q.status) and.push({ status: q.status });
  if (q.publication === 'awaiting') and.push(awaitingPublicationWhere(now));
  if (q.publication === 'released') and.push({ NOT: awaitingPublicationWhere(now) }, { status: 'GRADED', exam: { status: { not: 'CANCELLED' } } });
  if (q.search) {
    and.push({
      OR: [
        { student: { name: { contains: q.search, mode: 'insensitive' } } },
        { student: { email: { contains: q.search, mode: 'insensitive' } } },
        { exam: { title: { contains: q.search, mode: 'insensitive' } } },
      ],
    });
  }
  const where: Prisma.ResultWhereInput = and.length ? { AND: and } : {};
  const [items, total] = await Promise.all([
    prisma.result.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...skipTake(q),
      include: {
        student: { select: { id: true, name: true, email: true } },
        exam: { select: { id: true, title: true, subject: true, status: true, resultRelease: true, resultsPublishedAt: true, endsAt: true } },
      },
    }),
    prisma.result.count({ where }),
  ]);
  return paginated(res, items.map((r) => ({ ...r, released: isResultReleased(r.exam, r, now) })), total, q.page, q.pageSize);
});

adminRouter.get('/results/:id', authorizePermission('result:read_all'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  await loadAccessibleResult(req, id);
  const result = await prisma.result.findUniqueOrThrow({
    where: { id },
    include: {
      student: { select: { id: true, name: true, email: true, studentProfile: { select: { rollNumber: true, department: true } } } },
      publishedBy: { select: { name: true } },
      revisions: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true, role: true } } } },
      attempt: { include: { answers: { include: { gradedBy: { select: { name: true } } } } } },
      exam: {
        include: {
          createdBy: { select: { id: true, name: true } },
          questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  });
  const answerBy = new Map(result.attempt.answers.map((a) => [a.questionId, a]));
  const { attempt, exam, ...rest } = result;
  return ok(res, {
    ...rest,
    released: isResultReleased(exam, result),
    attempt: { id: attempt.id, attemptNumber: attempt.attemptNumber, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, submissionType: attempt.submissionType },
    exam: {
      id: exam.id, title: exam.title, subject: exam.subject, status: exam.status, totalMarks: exam.totalMarks, passMarks: exam.passMarks,
      negativeMarking: exam.negativeMarking, negativeMarkRatio: exam.negativeMarkRatio, resultRelease: exam.resultRelease,
      resultsPublishedAt: exam.resultsPublishedAt, endsAt: exam.endsAt, createdBy: exam.createdBy,
    },
    questions: exam.questions.map((q) => ({ ...q, answer: answerBy.get(q.id) ?? null })),
  });
});

adminRouter.patch('/results/:id/publish', authorizePermission('result:publish'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  return ok(res, await publishResult(req, id));
});

const correctSchemas = {
  params: idParam,
  body: z.object({
    questionId: uuid,
    marks: z.coerce.number().min(0, 'Marks cannot be negative'),
    reason: z.string({ required_error: 'A reason is required' }).trim().min(3, 'Please give a reason (at least 3 characters)').max(1000),
    feedback: z.string().trim().max(2000).optional().nullable(),
  }),
};

adminRouter.patch('/results/:id/correct', authorizePermission('result:correct'), validateRequest(correctSchemas), async (req, res) => {
  const { params, body } = getValidated(res, correctSchemas);
  const result = await loadAccessibleResult(req, params.id);
  return ok(res, await applyMark(req, { attemptId: result.attemptId, ...body }, 'CORRECTION'));
});

// =====================================================================
// Reports
// =====================================================================
const reportQuery = z.object({
  from: dateParam,
  to: dateParam,
  subject: z.string().trim().max(100).optional(),
  examId: uuid.optional(),
});

async function buildResultsReport(q: z.infer<typeof reportQuery>) {
  const where: Prisma.ExamWhereInput = { status: { in: ['PUBLISHED', 'ARCHIVED', 'CANCELLED'] } };
  if (q.examId) where.id = q.examId;
  if (q.subject) where.subject = q.subject;
  if (q.from || q.to) where.startsAt = { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) };
  const now = new Date();
  const exams = await prisma.exam.findMany({
    where,
    orderBy: { startsAt: 'desc' },
    include: {
      createdBy: { select: { name: true } },
      results: { select: { percentage: true, totalScore: true, passed: true, status: true, publishedAt: true } },
      _count: { select: { attempts: true } },
    },
  });
  const rows = exams.map((e) => {
    const graded = e.results.filter((r) => r.status === 'GRADED');
    return {
      examId: e.id, title: e.title, subject: e.subject, faculty: e.createdBy.name, status: e.status, phase: examPhase(e, now),
      startsAt: e.startsAt, totalMarks: e.totalMarks, attempts: e._count.attempts, submissions: e.results.length,
      graded: graded.length, pendingReview: e.results.length - graded.length,
      released: e.results.filter((r) => isResultReleased(e, r, now)).length,
      averagePercentage: graded.length ? round2(graded.reduce((s, r) => s + r.percentage, 0) / graded.length) : null,
      passRate: graded.length ? round2((graded.filter((r) => r.passed).length / graded.length) * 100) : null,
      highestScore: graded.length ? Math.max(...graded.map((r) => r.totalScore)) : null,
      lowestScore: graded.length ? Math.min(...graded.map((r) => r.totalScore)) : null,
    };
  });
  const bySubject = new Map<string, { subject: string; exams: number; graded: number; sum: number; passed: number }>();
  for (const e of exams) {
    const s = bySubject.get(e.subject) ?? { subject: e.subject, exams: 0, graded: 0, sum: 0, passed: 0 };
    s.exams++;
    for (const r of e.results) if (r.status === 'GRADED') { s.graded++; s.sum += r.percentage; if (r.passed) s.passed++; }
    bySubject.set(e.subject, s);
  }
  const allGraded = exams.flatMap((e) => e.results.filter((r) => r.status === 'GRADED'));
  return {
    rows,
    subjects: [...bySubject.values()].map((s) => ({
      subject: s.subject, exams: s.exams, graded: s.graded,
      averagePercentage: s.graded ? round2(s.sum / s.graded) : null, passRate: s.graded ? round2((s.passed / s.graded) * 100) : null,
    })),
    totals: {
      exams: exams.length,
      submissions: rows.reduce((n, r) => n + r.submissions, 0),
      graded: allGraded.length,
      pendingReview: rows.reduce((n, r) => n + r.pendingReview, 0),
      averagePercentage: allGraded.length ? round2(allGraded.reduce((s, r) => s + r.percentage, 0) / allGraded.length) : null,
      passRate: allGraded.length ? round2((allGraded.filter((r) => r.passed).length / allGraded.length) * 100) : null,
    },
  };
}

adminRouter.get('/reports/results', authorizePermission('report:view'), async (req, res) => {
  const q = reportQuery.parse(req.query);
  const [report, subjects] = await Promise.all([
    buildResultsReport(q),
    prisma.exam.findMany({ distinct: ['subject'], select: { subject: true }, orderBy: { subject: 'asc' } }),
  ]);
  return ok(res, { ...report, availableSubjects: subjects.map((s) => s.subject), filters: q });
});

const exportQuery = reportQuery.extend({
  type: z.enum(['results', 'exam-summary', 'users', 'exams', 'audit-logs']),
  role: roleEnum.optional(),
  status: z.string().trim().max(40).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
});

adminRouter.get('/reports/export', authorizePermission('report:export'), async (req, res) => {
  const q = exportQuery.parse(req.query);
  const stamp = new Date().toISOString().slice(0, 10);
  const range = q.from || q.to ? { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } : undefined;

  if (q.type === 'users') {
    const uq = usersQuery.parse({ role: q.role, status: statusEnum.safeParse(q.status).success ? q.status : undefined, includeDeleted: q.includeDeleted });
    return sendCsv(res, `users-${stamp}.csv`, await usersCsv(req, uq));
  }

  if (q.type === 'exam-summary') {
    const { rows } = await buildResultsReport(q);
    await audit(req, 'REPORT_EXPORTED', 'Report', null, { type: q.type, rows: rows.length });
    return sendCsv(res, `exam-summary-${stamp}.csv`, toCsv(
      ['Exam', 'Subject', 'Faculty', 'Status', 'Starts At', 'Total Marks', 'Submissions', 'Graded', 'Pending Review', 'Released', 'Average %', 'Pass Rate %', 'Highest', 'Lowest'],
      rows.map((r) => [r.title, r.subject, r.faculty, r.status, r.startsAt.toISOString(), r.totalMarks, r.submissions, r.graded, r.pendingReview, r.released, r.averagePercentage, r.passRate, r.highestScore, r.lowestScore]),
    ));
  }

  if (q.type === 'exams') {
    const status = examStatusEnum.safeParse(q.status);
    const exams = await prisma.exam.findMany({
      where: { ...(status.success && { status: status.data }), ...(q.subject && { subject: q.subject }), ...(range && { startsAt: range }) },
      orderBy: { startsAt: 'desc' },
      include: { createdBy: { select: { name: true } }, approvedBy: { select: { name: true } }, _count: { select: { questions: true, attempts: true } } },
    });
    await audit(req, 'REPORT_EXPORTED', 'Report', null, { type: q.type, rows: exams.length });
    return sendCsv(res, `exams-${stamp}.csv`, toCsv(
      ['Title', 'Subject', 'Faculty', 'Status', 'Starts At', 'Ends At', 'Duration (min)', 'Questions', 'Total Marks', 'Pass Marks', 'Attempts', 'Approved By', 'Approved At', 'Result Release'],
      exams.map((e) => [e.title, e.subject, e.createdBy.name, e.status, e.startsAt.toISOString(), e.endsAt.toISOString(), e.durationMinutes, e._count.questions, e.totalMarks, e.passMarks, e._count.attempts, e.approvedBy?.name, e.approvedAt?.toISOString(), e.resultRelease]),
    ));
  }

  if (q.type === 'audit-logs') {
    await authorizeAudit(req);
    const logs = await prisma.auditLog.findMany({ where: { ...(range && { createdAt: range }) }, orderBy: { createdAt: 'desc' }, take: 10_000 });
    await audit(req, 'REPORT_EXPORTED', 'Report', null, { type: q.type, rows: logs.length });
    return sendCsv(res, `audit-logs-${stamp}.csv`, toCsv(
      ['Time', 'Actor', 'Role', 'Action', 'Outcome', 'Entity', 'Entity ID', 'IP', 'Details'],
      logs.map((l) => [l.createdAt.toISOString(), l.actorEmail, l.actorRole, l.action, l.outcome, l.entityType, l.entityId, l.ipAddress, l.metadata ? JSON.stringify(l.metadata) : '']),
    ));
  }

  // type === 'results': one row per result
  const now = new Date();
  const results = await prisma.result.findMany({
    where: {
      ...(q.examId && { examId: q.examId }),
      exam: { ...(q.subject && { subject: q.subject }), ...(range && { startsAt: range }) },
    },
    orderBy: [{ exam: { startsAt: 'desc' } }, { student: { name: 'asc' } }],
    include: {
      student: { select: { name: true, email: true, studentProfile: { select: { rollNumber: true } } } },
      exam: { select: { title: true, subject: true, status: true, resultRelease: true, resultsPublishedAt: true, endsAt: true } },
      attempt: { select: { attemptNumber: true, submittedAt: true } },
    },
  });
  await audit(req, 'REPORT_EXPORTED', 'Report', null, { type: q.type, rows: results.length });
  return sendCsv(res, `results-${stamp}.csv`, toCsv(
    ['Exam', 'Subject', 'Student', 'Email', 'Roll Number', 'Attempt', 'Submitted At', 'Score', 'Max Score', 'Percentage', 'Status', 'Result', 'Released'],
    results.map((r) => [
      r.exam.title, r.exam.subject, r.student.name, r.student.email, r.student.studentProfile?.rollNumber, r.attempt.attemptNumber,
      r.attempt.submittedAt?.toISOString(), r.totalScore, r.maxScore, r.percentage, r.status,
      r.status === 'GRADED' ? (r.passed ? 'PASS' : 'FAIL') : 'PENDING', isResultReleased(r.exam, r, now) ? 'YES' : 'NO',
    ]),
  ));
});

async function authorizeAudit(req: Request) {
  if (!(await hasPermission(req, 'audit:read'))) throw ApiError.forbidden();
}

// =====================================================================
// Audit logs (read-only: the table is append-only at the database level)
// =====================================================================
adminRouter.get('/audit-logs', authorizePermission('audit:read'), async (req, res) => {
  const q = paginationSchema
    .extend({
      search: searchQuery,
      action: z.string().trim().max(60).optional(),
      entityType: z.string().trim().max(60).optional(),
      outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
      from: dateParam,
      to: dateParam,
    })
    .parse(req.query);
  const where: Prisma.AuditLogWhereInput = {};
  if (q.action) where.action = q.action;
  if (q.entityType) where.entityType = q.entityType;
  if (q.outcome) where.outcome = q.outcome;
  if (q.from || q.to) where.createdAt = { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) };
  if (q.search) {
    where.OR = [
      { action: { contains: q.search, mode: 'insensitive' } },
      { actorEmail: { contains: q.search, mode: 'insensitive' } },
      { actor: { name: { contains: q.search, mode: 'insensitive' } } },
      ...(z.string().uuid().safeParse(q.search).success ? [{ entityId: q.search }] : []),
    ];
  }
  const [items, total, actions] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), include: { actor: { select: { id: true, name: true, email: true, role: true } } } }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ]);
  return res.json({
    success: true,
    data: items,
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), actions: actions.map((a) => a.action) },
  });
});

// =====================================================================
// System settings
// =====================================================================
adminRouter.get('/settings', authorizePermission('settings:read'), async (_req, res) => {
  const [settings, rows] = await Promise.all([
    getSettings(),
    prisma.systemSetting.findMany({ include: { updatedBy: { select: { name: true } } } }),
  ]);
  return ok(res, { settings, meta: Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedBy: r.updatedBy?.name ?? null }])) });
});

// strict(): unknown keys are rejected instead of silently stored.
const settingsPatchSchema = settingsSchema.partial().strict();

adminRouter.patch('/settings', authorizePermission('settings:manage'), async (req, res) => {
  const patch = settingsPatchSchema.parse(req.body);
  if (!Object.keys(patch).length) throw ApiError.badRequest('No settings to update');
  const { after } = await prisma.$transaction(async (tx) => {
    const r = await updateSettings(patch, req.user!.id, tx);
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => r.before[k] !== r.after[k]);
    await audit(req, 'SETTINGS_UPDATED', 'SystemSetting', null, {
      changed,
      before: Object.fromEntries(changed.map((k) => [k, r.before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, r.after[k]])),
    }, tx);
    return r;
  });
  return ok(res, { settings: after });
});

// =====================================================================
// Announcements
// =====================================================================
adminRouter.post('/announcements', authorizePermission('announcement:send_all'), async (req, res) => {
  const body = announcementSchema.parse(req.body);
  return ok(res, await sendAnnouncement(req, body), 201);
});

adminRouter.get('/announcements', authorizePermission('announcement:send_all'), async (req, res) => {
  const q = paginationSchema.extend({ search: searchQuery, audience: z.enum(['ALL', 'STUDENT', 'FACULTY']).optional() }).parse(req.query);
  const where: Prisma.AnnouncementWhereInput = {};
  if (q.audience) where.audience = q.audience;
  if (q.search) where.OR = [{ title: { contains: q.search, mode: 'insensitive' } }, { message: { contains: q.search, mode: 'insensitive' } }];
  const [items, total] = await Promise.all([
    prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q), include: { createdBy: { select: { name: true, role: true } } } }),
    prisma.announcement.count({ where }),
  ]);
  return paginated(res, items, total, q.page, q.pageSize);
});

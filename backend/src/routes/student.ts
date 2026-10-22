import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, ok, paginated } from '../lib/http.js';
import { paginationSchema, skipTake } from '../lib/pagination.js';
import { authorizePermission, authorizeRoles } from '../middleware/auth.js';
import { idParam, searchQuery, uuid } from '../schemas/common.js';
import { canRevealAnswers, examPhase, isResultReleased } from '../services/examRules.js';
import { getAttemptForStudent, saveAnswers, startAttempt, submitAttempt } from '../services/attempts.js';

export const studentRouter = Router();
studentRouter.use(authorizeRoles('STUDENT'), authorizePermission('exam:take', 'result:read_self'));

const examCardSelect = {
  id: true, title: true, description: true, subject: true, durationMinutes: true, totalMarks: true,
  passMarks: true, maxAttempts: true, startsAt: true, endsAt: true, status: true, negativeMarking: true,
  resultRelease: true, resultsPublishedAt: true, _count: { select: { questions: true } },
  createdBy: { select: { name: true } },
} as const;

type ExamCard = Prisma.ExamGetPayload<{ select: typeof examCardSelect }>;

async function decorateForStudent(exams: ExamCard[], studentId: string, now = new Date()) {
  const attempts = await prisma.examAttempt.findMany({
    where: { studentId, examId: { in: exams.map((e) => e.id) } },
    select: { id: true, examId: true, status: true, deadlineAt: true },
    orderBy: { attemptNumber: 'asc' },
  });
  return exams.map(({ _count, ...e }) => {
    const mine = attempts.filter((a) => a.examId === e.id);
    const inProgress = mine.find((a) => a.status === 'IN_PROGRESS' && a.deadlineAt > now);
    const phase = examPhase(e, now);
    return {
      ...e,
      questionCount: _count.questions,
      phase,
      attemptsUsed: mine.length,
      inProgressAttemptId: inProgress?.id ?? null,
      canStart: phase === 'LIVE' && (!!inProgress || mine.length < e.maxAttempts),
    };
  });
}

// ---------- Dashboard ----------
studentRouter.get('/dashboard', async (req, res) => {
  const studentId = req.user!.id;
  const now = new Date();
  const published = { status: 'PUBLISHED' as const };

  const [totalExams, upcomingCount, liveExams, upcoming, completedAttempts, results] = await Promise.all([
    prisma.exam.count({ where: published }),
    prisma.exam.count({ where: { ...published, startsAt: { gt: now } } }),
    prisma.exam.findMany({ where: { ...published, startsAt: { lte: now }, endsAt: { gte: now } }, select: examCardSelect, orderBy: { endsAt: 'asc' }, take: 6 }),
    prisma.exam.findMany({ where: { ...published, startsAt: { gt: now } }, select: examCardSelect, orderBy: { startsAt: 'asc' }, take: 6 }),
    prisma.examAttempt.count({ where: { studentId, status: 'SUBMITTED' } }),
    prisma.result.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
      include: { exam: { select: { id: true, title: true, subject: true, status: true, resultRelease: true, resultsPublishedAt: true, endsAt: true } } },
    }),
  ]);

  const released = results.filter((r) => isResultReleased(r.exam, r, now));
  const averageScore = released.length ? released.reduce((s, r) => s + r.percentage, 0) / released.length : null;

  const bySubject = new Map<string, { total: number; count: number }>();
  for (const r of released) {
    const s = bySubject.get(r.exam.subject) ?? { total: 0, count: 0 };
    s.total += r.percentage;
    s.count++;
    bySubject.set(r.exam.subject, s);
  }

  const unread = await prisma.notification.findMany({
    where: { userId: studentId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return ok(res, {
    stats: {
      totalExams,
      upcomingExams: upcomingCount,
      completedExams: completedAttempts,
      averageScore: averageScore === null ? null : Math.round(averageScore * 10) / 10,
      passedCount: released.filter((r) => r.passed).length,
    },
    liveExams: await decorateForStudent(liveExams, studentId, now),
    upcomingExams: await decorateForStudent(upcoming, studentId, now),
    performance: released.slice(-10).map((r) => ({
      attemptId: r.attemptId,
      exam: r.exam.title,
      subject: r.exam.subject,
      percentage: r.percentage,
      date: r.createdAt,
    })),
    subjectPerformance: [...bySubject.entries()].map(([subject, s]) => ({
      subject,
      average: Math.round((s.total / s.count) * 10) / 10,
      exams: s.count,
    })),
    recentResults: results
      .slice(-5)
      .reverse()
      .map((r) => {
        const isReleased = isResultReleased(r.exam, r, now);
        return {
          attemptId: r.attemptId,
          examTitle: r.exam.title,
          subject: r.exam.subject,
          submittedAt: r.createdAt,
          released: isReleased,
          status: r.status,
          percentage: isReleased ? r.percentage : null,
          passed: isReleased ? r.passed : null,
        };
      }),
    notifications: unread,
  });
});

// ---------- Exams ----------
const examListQuery = paginationSchema.extend({
  tab: z.enum(['all', 'upcoming', 'active', 'completed']).default('all'),
  search: searchQuery,
  subject: z.string().trim().max(100).optional(),
  sort: z.enum(['startsAt', '-startsAt', 'title']).default('startsAt'),
});

studentRouter.get('/exams', async (req, res) => {
  const q = examListQuery.parse(req.query);
  const studentId = req.user!.id;
  const now = new Date();
  const where: Prisma.ExamWhereInput = { status: 'PUBLISHED' };
  if (q.search) {
    where.OR = [{ title: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }];
  }
  if (q.subject) where.subject = q.subject;
  if (q.tab === 'upcoming') where.startsAt = { gt: now };
  if (q.tab === 'active') Object.assign(where, { startsAt: { lte: now }, endsAt: { gte: now } });
  if (q.tab === 'completed') {
    where.AND = [{ OR: [{ endsAt: { lt: now } }, { attempts: { some: { studentId, status: 'SUBMITTED' } } }] }];
  }
  const orderBy: Prisma.ExamOrderByWithRelationInput =
    q.sort === 'title' ? { title: 'asc' } : { startsAt: q.sort === '-startsAt' ? 'desc' : 'asc' };

  const [items, total] = await Promise.all([
    prisma.exam.findMany({ where, select: examCardSelect, orderBy, ...skipTake(q) }),
    prisma.exam.count({ where }),
  ]);
  return paginated(res, await decorateForStudent(items, studentId, now), total, q.page, q.pageSize);
});

studentRouter.get('/subjects', async (_req, res) => {
  const rows = await prisma.exam.findMany({ where: { status: 'PUBLISHED' }, distinct: ['subject'], select: { subject: true }, orderBy: { subject: 'asc' } });
  return ok(res, rows.map((r) => r.subject));
});

studentRouter.get('/exams/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await prisma.exam.findFirst({
    where: { id, status: 'PUBLISHED' },
    select: { ...examCardSelect, instructions: true, negativeMarkRatio: true },
  });
  if (!exam) throw ApiError.notFound('Exam not found');
  const [decorated] = await decorateForStudent([exam], req.user!.id);
  const attempts = await prisma.examAttempt.findMany({
    where: { examId: id, studentId: req.user!.id },
    orderBy: { attemptNumber: 'asc' },
    select: { id: true, attemptNumber: true, status: true, startedAt: true, submittedAt: true, submissionType: true },
  });
  return ok(res, { ...decorated, instructions: exam.instructions, negativeMarkRatio: exam.negativeMarkRatio, attempts });
});

studentRouter.post('/exams/:id/attempts', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { attempt, resumed } = await startAttempt(id, req.user!.id);
  return ok(res, { attemptId: attempt.id, resumed, deadlineAt: attempt.deadlineAt }, resumed ? 200 : 201);
});

// ---------- Attempts ----------
studentRouter.get('/attempts/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  return ok(res, await getAttemptForStudent(id, req.user!.id));
});

const saveSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: uuid,
        selectedOptionIds: z.array(uuid).max(20).optional(),
        textAnswer: z.string().max(20_000).nullable().optional(),
        markedForReview: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

studentRouter.put('/attempts/:id/answers', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = saveSchema.parse(req.body);
  return ok(res, await saveAnswers(id, req.user!.id, body.answers));
});

studentRouter.post('/attempts/:id/submit', async (req, res) => {
  const { id } = idParam.parse(req.params);
  return ok(res, await submitAttempt(id, req.user!.id));
});

// ---------- Results ----------
studentRouter.get('/results', async (req, res) => {
  const q = paginationSchema.extend({ search: searchQuery }).parse(req.query);
  const now = new Date();
  const where: Prisma.ExamAttemptWhereInput = { studentId: req.user!.id, status: 'SUBMITTED' };
  if (q.search) where.exam = { title: { contains: q.search, mode: 'insensitive' } };
  const [attempts, total] = await Promise.all([
    prisma.examAttempt.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      ...skipTake(q),
      include: {
        result: true,
        exam: { select: { id: true, title: true, subject: true, status: true, resultRelease: true, resultsPublishedAt: true, endsAt: true, totalMarks: true } },
      },
    }),
    prisma.examAttempt.count({ where }),
  ]);
  const items = attempts.map((a) => {
    const released = !!a.result && isResultReleased(a.exam, a.result, now);
    return {
      attemptId: a.id,
      attemptNumber: a.attemptNumber,
      submittedAt: a.submittedAt,
      submissionType: a.submissionType,
      exam: { id: a.exam.id, title: a.exam.title, subject: a.exam.subject, totalMarks: a.exam.totalMarks },
      resultStatus: a.result?.status ?? 'PENDING_REVIEW',
      examCancelled: a.exam.status === 'CANCELLED',
      released,
      score: released ? a.result!.totalScore : null,
      maxScore: a.result?.maxScore ?? a.exam.totalMarks,
      percentage: released ? a.result!.percentage : null,
      passed: released ? a.result!.passed : null,
    };
  });
  return paginated(res, items, total, q.page, q.pageSize);
});

studentRouter.get('/results/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const now = new Date();
  const attempt = await prisma.examAttempt.findUnique({
    where: { id },
    include: {
      result: true,
      answers: true,
      student: { select: { name: true, email: true, studentProfile: { select: { rollNumber: true, department: true } } } },
      exam: {
        include: {
          createdBy: { select: { name: true } },
          questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  });
  if (!attempt || attempt.studentId !== req.user!.id) throw ApiError.notFound('Result not found');
  if (attempt.status !== 'SUBMITTED') throw ApiError.conflict('This attempt is still in progress', 'ATTEMPT_IN_PROGRESS');

  const { exam, result } = attempt;
  const attemptsUsed = await prisma.examAttempt.count({ where: { examId: exam.id, studentId: attempt.studentId } });
  const released = !!result && isResultReleased(exam, result, now);
  const reveal = !!result && canRevealAnswers(exam, result, attemptsUsed, now);
  const answerBy = new Map(attempt.answers.map((a) => [a.questionId, a]));

  return ok(res, {
    attempt: {
      id: attempt.id, attemptNumber: attempt.attemptNumber, startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt, submissionType: attempt.submissionType,
    },
    student: attempt.student,
    exam: {
      id: exam.id, title: exam.title, subject: exam.subject, durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks, passMarks: exam.passMarks, negativeMarking: exam.negativeMarking,
      negativeMarkRatio: exam.negativeMarkRatio, faculty: exam.createdBy.name, resultRelease: exam.resultRelease,
    },
    released,
    examCancelled: exam.status === 'CANCELLED',
    answersRevealed: reveal,
    resultStatus: result?.status ?? 'PENDING_REVIEW',
    result: released && result
      ? {
          totalScore: result.totalScore, maxScore: result.maxScore, percentage: result.percentage, passed: result.passed,
          correctCount: result.correctCount, incorrectCount: result.incorrectCount, unansweredCount: result.unansweredCount,
          objectiveScore: result.objectiveScore, descriptiveScore: result.descriptiveScore, gradedAt: result.gradedAt,
        }
      : null,
    // Students always see their own responses; marks and correct options only once released.
    questions: exam.questions.map((q) => {
      const a = answerBy.get(q.id);
      return {
        id: q.id, order: q.order, type: q.type, text: q.text, marks: q.marks,
        explanation: reveal ? q.explanation : null,
        options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: reveal ? o.isCorrect : undefined })),
        response: {
          selectedOptionIds: a?.selectedOptionIds ?? [],
          textAnswer: a?.textAnswer ?? null,
          marksAwarded: released ? (a?.marksAwarded ?? 0) : null,
          isCorrect: reveal ? (a?.isCorrect ?? null) : null,
          feedback: released ? (a?.feedback ?? null) : null,
        },
      };
    }),
  });
});

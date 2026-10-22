import { Router, type Request } from 'express';
import type { Exam, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError, ok, paginated } from '../lib/http.js';
import { paginationSchema, skipTake } from '../lib/pagination.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { assertPermission, authorizePermission, authorizeRoles } from '../middleware/auth.js';
import { getValidated, validateRequest } from '../middleware/validate.js';
import { idParam, searchQuery, uuid } from '../schemas/common.js';
import { editLevel, examPhase, isResultReleased, safeFields } from '../services/examRules.js';
import { availableActions, loadManagedExam, transitionExam, type ExamAction } from '../services/examWorkflow.js';
import { applyMark, publishExamResults } from '../services/results.js';
import { getSettings } from '../services/settings.js';
import { round2 } from '../services/grading.js';

export const examsRouter = Router();
examsRouter.use(authorizeRoles('FACULTY', 'ADMIN'));

// ---------- helpers ----------
const attemptCount = (examId: string) => prisma.examAttempt.count({ where: { examId } });

async function assertQuestionsEditable(exam: Exam) {
  const level = editLevel(exam.status, await attemptCount(exam.id), await getSettings());
  if (level === 'FULL') return;
  const reason =
    exam.status === 'PENDING_APPROVAL' ? 'The exam is awaiting approval. Withdraw it to make changes.'
    : exam.status === 'APPROVED' || exam.status === 'PUBLISHED' ? 'Questions are locked because the exam was approved or attempted. Move it back to draft to change them.'
    : `Exams that are ${exam.status.toLowerCase()} cannot be modified.`;
  throw ApiError.conflict(reason, 'EXAM_LOCKED');
}

async function recomputeTotalMarks(tx: Prisma.TransactionClient, examId: string) {
  const agg = await tx.question.aggregate({ where: { examId }, _sum: { marks: true } });
  await tx.exam.update({ where: { id: examId }, data: { totalMarks: round2(agg._sum.marks ?? 0) } });
}

// ---------- schemas ----------
const examFields = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  subject: z.string().trim().min(2, 'Subject is required').max(100),
  instructions: z.string().trim().max(5000).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(600),
  passMarks: z.coerce.number().min(0),
  negativeMarking: z.boolean().default(false),
  negativeMarkRatio: z.coerce.number().min(0).max(1).default(0),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  resultRelease: z.enum(['IMMEDIATE', 'AFTER_END', 'MANUAL']).default('AFTER_END'),
});

const windowValid = (v: { startsAt?: Date; endsAt?: Date }) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt;
const windowMsg = { message: 'End time must be after start time', path: ['endsAt'] };
const createExamSchema = examFields.refine(windowValid, windowMsg);
// No defaults on update: omitted fields must stay untouched (and never count as a "change").
const updateExamSchema = examFields
  .extend({ negativeMarking: z.boolean(), negativeMarkRatio: z.coerce.number().min(0).max(1), maxAttempts: z.coerce.number().int().min(1).max(10), resultRelease: z.enum(['IMMEDIATE', 'AFTER_END', 'MANUAL']) })
  .partial()
  .refine(windowValid, windowMsg);

/** Settings whose changes are audited with before/after values. */
const IMPORTANT_FIELDS = ['startsAt', 'endsAt', 'durationMinutes', 'passMarks', 'negativeMarking', 'negativeMarkRatio', 'maxAttempts', 'resultRelease'] as const;

const optionSchema = z.object({ text: z.string().trim().min(1, 'Option text is required').max(1000), isCorrect: z.boolean() });

const questionSchema = z
  .object({
    type: z.enum(['MCQ', 'MULTI_SELECT', 'TRUE_FALSE', 'DESCRIPTIVE']),
    text: z.string().trim().min(1, 'Question text is required').max(5000),
    marks: z.coerce.number().positive('Marks must be greater than 0').max(100),
    explanation: z.string().trim().max(5000).optional().nullable(),
    options: z.array(optionSchema).max(10).default([]),
  })
  .superRefine((q, ctx) => {
    const correct = q.options.filter((o) => o.isCorrect).length;
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['options'] });
    if (q.type === 'DESCRIPTIVE') {
      if (q.options.length) issue('Descriptive questions cannot have options');
    } else if (q.type === 'TRUE_FALSE') {
      if (q.options.length !== 2 || correct !== 1) issue('True/false questions need exactly two options with one correct');
    } else {
      if (q.options.length < 2) issue('Provide at least two options');
      if (q.type === 'MCQ' && correct !== 1) issue('Single-choice questions need exactly one correct option');
      if (q.type === 'MULTI_SELECT' && correct < 1) issue('Mark at least one option as correct');
    }
  });

const fullExamInclude = {
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } },
  statusChanges: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true, role: true } } } },
  _count: { select: { attempts: true } },
} satisfies Prisma.ExamInclude;

/** Full exam (with answer key) for its manager, plus what the current user may do with it. */
export async function examDetail(req: Request, id: string) {
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id }, include: fullExamInclude });
  const settings = await getSettings();
  const { _count, ...rest } = exam;
  const level = editLevel(exam.status, _count.attempts, settings);
  return {
    ...rest,
    phase: examPhase(exam),
    attemptCount: _count.attempts,
    locked: level !== 'FULL',
    editLevel: level,
    editableFields: level === 'FULL' ? Object.keys(examFields.shape) : level === 'SAFE' ? [...safeFields(settings)] : [],
    allowedActions: await availableActions(req, exam, _count.attempts),
    requiresApproval: settings.requireExamApproval,
  };
}

// ---------- exam CRUD ----------
const listQuery = paginationSchema.extend({
  search: searchQuery,
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED', 'ARCHIVED']).optional(),
  phase: z.enum(['SCHEDULED', 'LIVE', 'ENDED']).optional(),
  sort: z.enum(['-createdAt', 'createdAt', 'startsAt', '-startsAt', 'title', '-updatedAt']).default('-createdAt'),
});

examsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const now = new Date();
  const where: Prisma.ExamWhereInput = {};
  if (req.user!.role !== 'ADMIN') where.createdById = req.user!.id;
  if (q.status) where.status = q.status;
  if (q.phase) {
    where.status = 'PUBLISHED';
    if (q.phase === 'SCHEDULED') where.startsAt = { gt: now };
    if (q.phase === 'LIVE') Object.assign(where, { startsAt: { lte: now }, endsAt: { gte: now } });
    if (q.phase === 'ENDED') where.endsAt = { lt: now };
  }
  if (q.search) {
    where.OR = [{ title: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }];
  }
  const [field, dir] = q.sort.startsWith('-') ? [q.sort.slice(1), 'desc' as const] : [q.sort, 'asc' as const];
  const [items, total] = await Promise.all([
    prisma.exam.findMany({
      where,
      orderBy: { [field]: dir },
      ...skipTake(q),
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { questions: true, attempts: true } } },
    }),
    prisma.exam.count({ where }),
  ]);
  const rows = await Promise.all(
    items.map(async ({ _count, ...e }) => ({
      ...e,
      phase: examPhase(e, now),
      questionCount: _count.questions,
      attemptCount: _count.attempts,
      allowedActions: await availableActions(req, e, _count.attempts),
    })),
  );
  return paginated(res, rows, total, q.page, q.pageSize);
});

examsRouter.post('/', authorizePermission('exam:create'), async (req, res) => {
  const body = createExamSchema.parse(req.body);
  const exam = await prisma.exam.create({ data: { ...body, createdById: req.user!.id, status: 'DRAFT' } });
  await audit(req, 'EXAM_CREATED', 'Exam', exam.id, { title: exam.title });
  return ok(res, await examDetail(req, exam.id), 201);
});

examsRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  await loadManagedExam(req, id);
  return ok(res, await examDetail(req, id));
});

examsRouter.patch('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  const body = updateExamSchema.parse(req.body);
  const settings = await getSettings();
  const level = editLevel(exam.status, await attemptCount(id), settings);

  const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => {
    const next = body[k];
    if (next === undefined) return false;
    const prev = exam[k as keyof Exam];
    return prev instanceof Date && next instanceof Date ? prev.getTime() !== next.getTime() : prev !== next;
  });

  if (level === 'NONE' && changed.length) {
    throw ApiError.conflict(`Exams that are ${exam.status.replace('_', ' ').toLowerCase()} cannot be modified.`, 'EXAM_LOCKED');
  }
  if (level === 'SAFE') {
    const allowed = safeFields(settings);
    const blocked = changed.filter((k) => !allowed.has(k));
    if (blocked.length) {
      throw ApiError.conflict(`Cannot change ${blocked.join(', ')} after the exam was approved or attempted. Move it back to draft first.`, 'EXAM_LOCKED');
    }
    if (body.endsAt && body.endsAt < exam.endsAt) throw ApiError.conflict('The exam window can only be extended at this stage', 'EXAM_LOCKED');
  }

  const merged = { startsAt: body.startsAt ?? exam.startsAt, endsAt: body.endsAt ?? exam.endsAt };
  if (merged.endsAt <= merged.startsAt) throw ApiError.badRequest('End time must be after start time');
  const passMarks = body.passMarks ?? exam.passMarks;
  if (exam.status !== 'DRAFT' && passMarks > exam.totalMarks) throw ApiError.badRequest('Pass marks cannot exceed total marks');

  if (!changed.length) return ok(res, await examDetail(req, id));
  const data = Object.fromEntries(changed.map((k) => [k, body[k]]));
  await prisma.$transaction(async (tx) => {
    await tx.exam.update({ where: { id }, data });
    const important = changed.filter((k) => (IMPORTANT_FIELDS as readonly string[]).includes(k));
    await audit(req, important.length ? 'EXAM_SETTINGS_CHANGED' : 'EXAM_UPDATED', 'Exam', id, {
      fields: changed,
      ...(important.length && {
        before: Object.fromEntries(important.map((k) => [k, exam[k as keyof Exam] as Prisma.JsonValue])),
        after: Object.fromEntries(important.map((k) => [k, (body[k] instanceof Date ? (body[k] as Date).toISOString() : body[k]) as Prisma.JsonValue])),
      }),
    }, tx);
  });
  return ok(res, await examDetail(req, id));
});

examsRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  if (exam.status !== 'DRAFT' && exam.status !== 'REJECTED') {
    throw ApiError.conflict('Only draft or rejected exams can be deleted. Archive or cancel it instead.', 'INVALID_STATE');
  }
  if ((await attemptCount(id)) > 0) throw ApiError.conflict('Exams with attempts cannot be deleted. Archive it instead.', 'EXAM_LOCKED');
  await prisma.$transaction(async (tx) => {
    await tx.exam.delete({ where: { id } });
    await audit(req, 'EXAM_DELETED', 'Exam', id, { title: exam.title }, tx);
  });
  return ok(res, { deleted: true });
});

// ---------- workflow (submit / withdraw / publish / unpublish / archive / restore) ----------
const reasonBody = z.object({ reason: z.string().trim().max(1000).optional().nullable() });
const facultyActions: Record<string, ExamAction> = {
  submit: 'SUBMIT', withdraw: 'WITHDRAW', publish: 'PUBLISH', unpublish: 'UNPUBLISH', archive: 'ARCHIVE', restore: 'RESTORE',
};

for (const [path, action] of Object.entries(facultyActions)) {
  examsRouter.post(`/:id/${path}`, async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { reason } = reasonBody.parse(req.body ?? {});
    await transitionExam(req, id, action, reason);
    return ok(res, await examDetail(req, id));
  });
}

// ---------- questions ----------
examsRouter.post('/:id/questions', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  await assertQuestionsEditable(exam);
  const body = questionSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    const last = await tx.question.aggregate({ where: { examId: id }, _max: { order: true } });
    await tx.question.create({
      data: {
        examId: id, type: body.type, text: body.text, marks: body.marks, explanation: body.explanation,
        order: (last._max.order ?? 0) + 1,
        options: { create: body.options.map((o, i) => ({ ...o, order: i + 1 })) },
      },
    });
    await recomputeTotalMarks(tx, id);
  });
  return ok(res, await examDetail(req, id), 201);
});

const questionParams = z.object({ id: uuid, questionId: uuid });

examsRouter.put('/:id/questions/:questionId', async (req, res) => {
  const { id, questionId } = questionParams.parse(req.params);
  const exam = await loadManagedExam(req, id);
  await assertQuestionsEditable(exam);
  const body = questionSchema.parse(req.body);
  const q = await prisma.question.findFirst({ where: { id: questionId, examId: id } });
  if (!q) throw ApiError.notFound('Question not found');
  await prisma.$transaction(async (tx) => {
    await tx.questionOption.deleteMany({ where: { questionId } });
    await tx.question.update({
      where: { id: questionId },
      data: {
        type: body.type, text: body.text, marks: body.marks, explanation: body.explanation,
        options: { create: body.options.map((o, i) => ({ ...o, order: i + 1 })) },
      },
    });
    await recomputeTotalMarks(tx, id);
  });
  return ok(res, await examDetail(req, id));
});

examsRouter.delete('/:id/questions/:questionId', async (req, res) => {
  const { id, questionId } = questionParams.parse(req.params);
  const exam = await loadManagedExam(req, id);
  await assertQuestionsEditable(exam);
  const q = await prisma.question.findFirst({ where: { id: questionId, examId: id } });
  if (!q) throw ApiError.notFound('Question not found');
  await prisma.$transaction(async (tx) => {
    await tx.question.delete({ where: { id: questionId } });
    const rest = await tx.question.findMany({ where: { examId: id }, orderBy: { order: 'asc' }, select: { id: true } });
    for (const [i, r] of rest.entries()) await tx.question.update({ where: { id: r.id }, data: { order: i + 1 } });
    await recomputeTotalMarks(tx, id);
  });
  return ok(res, await examDetail(req, id));
});

const reorderSchema = z.object({ questionIds: z.array(uuid).min(1).max(500) });

examsRouter.put('/:id/questions-order', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  await assertQuestionsEditable(exam);
  const { questionIds } = reorderSchema.parse(req.body);
  const existing = await prisma.question.findMany({ where: { examId: id }, select: { id: true } });
  const sameMembers = existing.length === questionIds.length && new Set(questionIds).size === questionIds.length
    && existing.every((q) => questionIds.includes(q.id));
  if (!sameMembers) throw ApiError.badRequest('The new order must list every question of the exam exactly once');
  await prisma.$transaction(questionIds.map((qid, i) => prisma.question.update({ where: { id: qid }, data: { order: i + 1 } })));
  return ok(res, await examDetail(req, id));
});

// ---------- submissions & results ----------
const attemptsQuery = paginationSchema.extend({
  search: searchQuery,
  status: z.enum(['IN_PROGRESS', 'SUBMITTED', 'PENDING_REVIEW', 'GRADED']).optional(),
});

examsRouter.get('/:id/attempts', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  const q = attemptsQuery.parse(req.query);
  const where: Prisma.ExamAttemptWhereInput = { examId: id };
  if (q.status === 'IN_PROGRESS' || q.status === 'SUBMITTED') where.status = q.status;
  if (q.status === 'PENDING_REVIEW' || q.status === 'GRADED') where.result = { status: q.status };
  if (q.search) {
    where.student = {
      OR: [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { studentProfile: { rollNumber: { contains: q.search, mode: 'insensitive' } } },
      ],
    };
  }
  const [items, total] = await Promise.all([
    prisma.examAttempt.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      ...skipTake(q),
      include: {
        result: true,
        student: { select: { id: true, name: true, email: true, studentProfile: { select: { rollNumber: true, department: true } } } },
      },
    }),
    prisma.examAttempt.count({ where }),
  ]);
  const now = new Date();
  return paginated(res, items.map((a) => ({ ...a, released: !!a.result && isResultReleased(exam, a.result, now) })), total, q.page, q.pageSize);
});

examsRouter.get('/:id/stats', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  const [results, questions, inProgress, participants] = await Promise.all([
    prisma.result.findMany({ where: { examId: id }, select: { percentage: true, totalScore: true, passed: true, status: true, publishedAt: true } }),
    prisma.question.findMany({ where: { examId: id }, orderBy: { order: 'asc' }, select: { id: true, order: true, text: true, type: true } }),
    prisma.examAttempt.count({ where: { examId: id, status: 'IN_PROGRESS' } }),
    prisma.examAttempt.findMany({ where: { examId: id }, distinct: ['studentId'], select: { studentId: true } }),
  ]);
  // Aggregate per-question counts in SQL rather than loading every answer row.
  const answerCounts = await prisma.$queryRaw<{ questionId: string; answered: bigint; correct: bigint }[]>`
    SELECT sa."questionId",
           COUNT(*) FILTER (WHERE cardinality(sa."selectedOptionIds") > 0 OR length(trim(coalesce(sa."textAnswer", ''))) > 0) AS answered,
           COUNT(*) FILTER (WHERE sa."isCorrect" IS TRUE) AS correct
    FROM "SubmittedAnswer" sa
    JOIN "ExamAttempt" a ON a."id" = sa."attemptId"
    WHERE a."examId" = ${id} AND a."status" = 'SUBMITTED'
    GROUP BY sa."questionId"`;
  const countsBy = new Map(answerCounts.map((c) => [c.questionId, { answered: Number(c.answered), correct: Number(c.correct) }]));

  const now = new Date();
  const graded = results.filter((r) => r.status === 'GRADED');
  const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}`, count: 0 }));
  for (const r of graded) buckets[Math.min(9, Math.floor(r.percentage / 10))]!.count++;
  const avg = graded.length ? graded.reduce((s, r) => s + r.percentage, 0) / graded.length : 0;
  return ok(res, {
    totalMarks: exam.totalMarks,
    submissions: results.length,
    participants: participants.length,
    inProgress,
    pendingReview: results.length - graded.length,
    released: results.filter((r) => isResultReleased(exam, r, now)).length,
    awaitingPublication: graded.filter((r) => !isResultReleased(exam, r, now)).length,
    averagePercentage: round2(avg),
    highestScore: graded.length ? Math.max(...graded.map((r) => r.totalScore)) : 0,
    lowestScore: graded.length ? Math.min(...graded.map((r) => r.totalScore)) : 0,
    passRate: graded.length ? round2((graded.filter((r) => r.passed).length / graded.length) * 100) : 0,
    distribution: buckets,
    questionStats: questions.map((q) => {
      const { answered, correct } = countsBy.get(q.id) ?? { answered: 0, correct: 0 };
      return {
        questionId: q.id, order: q.order, text: q.text.slice(0, 80), type: q.type, answered,
        correctRate: q.type === 'DESCRIPTIVE' || !answered ? null : round2((correct / answered) * 100),
      };
    }),
  });
});

/** Publishing results requires `result:publish` (admins; faculty only when the policy allows it). */
examsRouter.post('/:id/results/publish', async (req, res) => {
  const { id } = idParam.parse(req.params);
  await loadManagedExam(req, id);
  return ok(res, await publishExamResults(req, id));
});

examsRouter.get('/:id/results/export', authorizePermission('report:export'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const exam = await loadManagedExam(req, id);
  const attempts = await prisma.examAttempt.findMany({
    where: { examId: id, status: 'SUBMITTED' },
    orderBy: [{ student: { name: 'asc' } }, { attemptNumber: 'asc' }],
    include: { result: true, student: { select: { name: true, email: true, studentProfile: { select: { rollNumber: true, department: true } } } } },
  });
  const now = new Date();
  const csv = toCsv(
    ['Student', 'Email', 'Roll Number', 'Department', 'Attempt', 'Submitted At', 'Submission', 'Score', 'Max Score', 'Percentage', 'Status', 'Result', 'Published', 'Correct', 'Incorrect', 'Unanswered'],
    attempts.map((a) => [
      a.student.name, a.student.email, a.student.studentProfile?.rollNumber, a.student.studentProfile?.department,
      a.attemptNumber, a.submittedAt?.toISOString(), a.submissionType, a.result?.totalScore, a.result?.maxScore,
      a.result?.percentage, a.result?.status,
      a.result?.status === 'GRADED' ? (a.result.passed ? 'PASS' : 'FAIL') : 'PENDING',
      a.result && isResultReleased(exam, a.result, now) ? 'YES' : 'NO',
      a.result?.correctCount, a.result?.incorrectCount, a.result?.unansweredCount,
    ]),
  );
  await audit(req, 'RESULTS_EXPORTED', 'Exam', id, { rows: attempts.length });
  const safeName = exam.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'exam';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-results.csv"`);
  res.send(csv);
});

// ---------- attempt review & manual grading ----------
async function loadManagedAttempt(req: Request, attemptId: string) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, select: { id: true, examId: true, status: true, studentId: true } });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const exam = await loadManagedExam(req, attempt.examId);
  return { attempt, exam };
}

examsRouter.get('/attempts/:attemptId', async (req, res) => {
  const { attemptId } = z.object({ attemptId: uuid }).parse(req.params);
  await loadManagedAttempt(req, attemptId);
  const attempt = await prisma.examAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      result: {
        include: {
          publishedBy: { select: { name: true } },
          revisions: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true, role: true } } } },
        },
      },
      answers: { include: { gradedBy: { select: { name: true } } } },
      student: { select: { id: true, name: true, email: true, studentProfile: { select: { rollNumber: true, department: true } } } },
      exam: { include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } } },
    },
  });
  const answerBy = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const { exam, answers: _answers, ...rest } = attempt;
  return ok(res, {
    ...rest,
    released: !!attempt.result && isResultReleased(exam, attempt.result),
    exam: {
      id: exam.id, title: exam.title, subject: exam.subject, status: exam.status, totalMarks: exam.totalMarks, passMarks: exam.passMarks,
      negativeMarking: exam.negativeMarking, negativeMarkRatio: exam.negativeMarkRatio, resultRelease: exam.resultRelease,
    },
    questions: exam.questions.map((q) => ({ ...q, answer: answerBy.get(q.id) ?? null })),
  });
});

const gradeSchemas = {
  params: z.object({ attemptId: uuid, questionId: uuid }),
  body: z.object({
    marks: z.coerce.number().min(0, 'Marks cannot be negative'),
    feedback: z.string().trim().max(2000).optional().nullable(),
    // Required when the change is a correction (result already visible to the student).
    reason: z.string().trim().max(1000).optional().nullable(),
  }),
};

examsRouter.put('/attempts/:attemptId/answers/:questionId/grade', validateRequest(gradeSchemas), async (req, res) => {
  const { params, body } = getValidated(res, gradeSchemas);
  await loadManagedAttempt(req, params.attemptId);
  await assertPermission(req, 'attempt:grade');
  return ok(res, await applyMark(req, { attemptId: params.attemptId, questionId: params.questionId, ...body }, 'GRADE'));
});

// ---------- faculty dashboard ----------
export const facultyRouter = Router();
facultyRouter.use(authorizeRoles('FACULTY', 'ADMIN'));

facultyRouter.get('/dashboard', async (req, res) => {
  const now = new Date();
  const own: Prisma.ExamWhereInput = req.user!.role === 'FACULTY' ? { createdById: req.user!.id } : {};
  const [totalExams, drafts, pendingApproval, rejected, live, scheduled, submissions, pendingReview, recentAttempts, exams] = await Promise.all([
    prisma.exam.count({ where: own }),
    prisma.exam.count({ where: { ...own, status: 'DRAFT' } }),
    prisma.exam.count({ where: { ...own, status: 'PENDING_APPROVAL' } }),
    prisma.exam.count({ where: { ...own, status: 'REJECTED' } }),
    prisma.exam.findMany({
      where: { ...own, status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gte: now } },
      include: { _count: { select: { attempts: true } } },
      orderBy: { endsAt: 'asc' },
      take: 5,
    }),
    prisma.exam.findMany({ where: { ...own, status: 'PUBLISHED', startsAt: { gt: now } }, orderBy: { startsAt: 'asc' }, take: 5 }),
    prisma.examAttempt.count({ where: { status: 'SUBMITTED', exam: own } }),
    prisma.result.count({ where: { status: 'PENDING_REVIEW', exam: own } }),
    prisma.examAttempt.findMany({
      where: { status: 'SUBMITTED', exam: own },
      orderBy: { submittedAt: 'desc' },
      take: 8,
      include: { student: { select: { name: true } }, exam: { select: { id: true, title: true } }, result: { select: { status: true, percentage: true } } },
    }),
    prisma.exam.findMany({
      where: { ...own, status: { in: ['PUBLISHED', 'ARCHIVED'] } },
      orderBy: { startsAt: 'desc' },
      take: 8,
      select: { id: true, title: true, results: { where: { status: 'GRADED' }, select: { percentage: true, passed: true } } },
    }),
  ]);
  return ok(res, {
    stats: { totalExams, drafts, pendingApproval, rejected, liveCount: live.length, scheduledCount: scheduled.length, submissions, pendingReview },
    liveExams: live.map(({ _count, ...e }) => ({ ...e, attemptCount: _count.attempts })),
    scheduledExams: scheduled,
    recentSubmissions: recentAttempts,
    examPerformance: exams.reverse().map((e) => ({
      examId: e.id,
      title: e.title,
      average: e.results.length ? round2(e.results.reduce((s, r) => s + r.percentage, 0) / e.results.length) : 0,
      passRate: e.results.length ? round2((e.results.filter((r) => r.passed).length / e.results.length) * 100) : 0,
      submissions: e.results.length,
    })),
  });
});

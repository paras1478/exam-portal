import { Prisma, type SubmissionType } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { notifyUsers } from '../lib/notify.js';
import { gradeAttempt } from './grading.js';

type Tx = Prisma.TransactionClient;

export const graceMs = () => env.SUBMISSION_GRACE_SECONDS * 1000;

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Starts a new attempt, or returns the student's current in-progress attempt (refresh / reconnect recovery).
 * The deadline is fixed server-side at creation and never extended by the client.
 */
export async function startAttempt(examId: string, studentId: string, now = new Date()) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam || exam.status !== 'PUBLISHED') throw ApiError.notFound('Exam not found');

  const existing = await prisma.examAttempt.findFirst({ where: { examId, studentId, status: 'IN_PROGRESS' } });
  if (existing) {
    if (now.getTime() <= existing.deadlineAt.getTime()) return { attempt: existing, resumed: true };
    await finalizeAttempt(existing.id, 'AUTO_TIMEOUT', now);
  }

  if (now < exam.startsAt) throw ApiError.conflict('This exam has not started yet', 'EXAM_NOT_STARTED');
  if (now > exam.endsAt) throw ApiError.conflict('This exam has ended', 'EXAM_ENDED');

  const used = await prisma.examAttempt.count({ where: { examId, studentId } });
  if (used >= exam.maxAttempts) throw ApiError.conflict('You have used all permitted attempts for this exam', 'ATTEMPT_LIMIT');

  const deadlineAt = new Date(Math.min(now.getTime() + exam.durationMinutes * 60_000, exam.endsAt.getTime()));
  try {
    const attempt = await prisma.examAttempt.create({
      data: { examId, studentId, attemptNumber: used + 1, startedAt: now, deadlineAt },
    });
    return { attempt, resumed: false };
  } catch (e) {
    // A concurrent request created the attempt first (partial unique index / attemptNumber uniqueness).
    if (!isUniqueViolation(e)) throw e;
    const winner = await prisma.examAttempt.findFirst({ where: { examId, studentId, status: 'IN_PROGRESS' } });
    if (winner) return { attempt: winner, resumed: true };
    throw ApiError.conflict('You have used all permitted attempts for this exam', 'ATTEMPT_LIMIT');
  }
}

async function loadOwnedAttempt(attemptId: string, studentId: string) {
  const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
  // 404 rather than 403 so attempt ids of other students cannot be probed.
  if (!attempt || attempt.studentId !== studentId) throw ApiError.notFound('Attempt not found');
  return attempt;
}

/** Student-facing attempt payload. Never includes correct answers or explanations. */
export async function getAttemptForStudent(attemptId: string, studentId: string, now = new Date()) {
  let attempt = await loadOwnedAttempt(attemptId, studentId);
  if (attempt.status === 'IN_PROGRESS' && now.getTime() > attempt.deadlineAt.getTime() + graceMs()) {
    await finalizeAttempt(attempt.id, 'AUTO_TIMEOUT', now);
    attempt = await loadOwnedAttempt(attemptId, studentId);
  }

  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: attempt.examId },
    select: {
      id: true, title: true, subject: true, instructions: true, durationMinutes: true,
      totalMarks: true, passMarks: true, negativeMarking: true, negativeMarkRatio: true,
    },
  });

  const base = {
    attempt: {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      submittedAt: attempt.submittedAt,
      submissionType: attempt.submissionType,
    },
    exam,
    serverNow: now,
  };
  if (attempt.status !== 'IN_PROGRESS') return { ...base, questions: [], answers: [] };

  const [questions, answers] = await Promise.all([
    prisma.question.findMany({
      where: { examId: attempt.examId },
      orderBy: { order: 'asc' },
      select: {
        id: true, type: true, text: true, marks: true, order: true,
        options: { orderBy: { order: 'asc' }, select: { id: true, text: true } },
      },
    }),
    prisma.submittedAnswer.findMany({
      where: { attemptId },
      select: { questionId: true, selectedOptionIds: true, textAnswer: true, markedForReview: true },
    }),
  ]);
  return { ...base, questions, answers };
}

export interface AnswerInput {
  questionId: string;
  selectedOptionIds?: string[];
  textAnswer?: string | null;
  markedForReview?: boolean;
}

/**
 * Persists one or more answers. A row without a selection still records that the question was visited.
 * Writes after the deadline (plus a small grace period for in-flight requests) are rejected.
 */
export async function saveAnswers(attemptId: string, studentId: string, inputs: AnswerInput[], now = new Date()) {
  const attempt = await loadOwnedAttempt(attemptId, studentId);
  if (attempt.status !== 'IN_PROGRESS') throw ApiError.conflict('This attempt has already been submitted', 'ATTEMPT_CLOSED');
  if (now.getTime() > attempt.deadlineAt.getTime() + graceMs()) {
    await finalizeAttempt(attempt.id, 'AUTO_TIMEOUT', now);
    throw ApiError.conflict('Time is up. Your attempt has been submitted automatically.', 'TIME_UP');
  }
  const { status: examStatus } = await prisma.exam.findUniqueOrThrow({ where: { id: attempt.examId }, select: { status: true } });
  if (examStatus === 'CANCELLED') {
    await finalizeAttempt(attempt.id, 'AUTO_TIMEOUT', now);
    throw ApiError.conflict('This exam has been cancelled.', 'EXAM_CANCELLED');
  }

  const questions = await prisma.question.findMany({
    where: { examId: attempt.examId, id: { in: inputs.map((i) => i.questionId) } },
    select: { id: true, type: true, options: { select: { id: true } } },
  });
  const qMap = new Map(questions.map((q) => [q.id, q]));

  for (const input of inputs) {
    const q = qMap.get(input.questionId);
    if (!q) throw ApiError.badRequest('Question does not belong to this exam');
    if (input.selectedOptionIds) {
      if (q.type === 'DESCRIPTIVE' && input.selectedOptionIds.length) throw ApiError.badRequest('Descriptive questions take a text answer');
      const valid = new Set(q.options.map((o) => o.id));
      if (input.selectedOptionIds.some((id) => !valid.has(id))) throw ApiError.badRequest('Invalid option selected');
      if ((q.type === 'MCQ' || q.type === 'TRUE_FALSE') && input.selectedOptionIds.length > 1) {
        throw ApiError.badRequest('Only one option may be selected for this question');
      }
    }
    if (input.textAnswer && q.type !== 'DESCRIPTIVE') throw ApiError.badRequest('Text answers are only accepted for descriptive questions');
  }

  await prisma.$transaction(async (tx) => {
    // Re-check under a row lock so a concurrent submission cannot interleave with the write.
    const locked = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "ExamAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
    if (locked[0]?.status !== 'IN_PROGRESS') throw ApiError.conflict('This attempt has already been submitted', 'ATTEMPT_CLOSED');

    for (const input of inputs) {
      const data = {
        ...(input.selectedOptionIds !== undefined && { selectedOptionIds: [...new Set(input.selectedOptionIds)] }),
        ...(input.textAnswer !== undefined && { textAnswer: input.textAnswer }),
        ...(input.markedForReview !== undefined && { markedForReview: input.markedForReview }),
      };
      await tx.submittedAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: input.questionId } },
        create: { attemptId, questionId: input.questionId, ...data },
        update: data,
      });
    }
  });
  return { savedAt: now, deadlineAt: attempt.deadlineAt };
}

/** Grades an attempt from its stored answers and writes per-answer marks plus the Result row. */
async function gradeAndStore(tx: Tx, attemptId: string) {
  const attempt = await tx.examAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      exam: { include: { questions: { include: { options: { select: { id: true, isCorrect: true } } } } } },
      answers: true,
    },
  });
  const { exam } = attempt;
  const summary = gradeAttempt(
    exam.questions,
    attempt.answers.map((a) => ({
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      textAnswer: a.textAnswer,
      manualMarks: a.gradedAt ? a.marksAwarded : null,
      overrideMarks: a.overrideMarks,
    })),
    exam,
  );

  const answerByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const questionType = new Map(exam.questions.map((q) => [q.id, q.type]));
  for (const g of summary.perQuestion) {
    const ans = answerByQuestion.get(g.questionId);
    // Descriptive marks are written by the grader; overrides are mirrored into marksAwarded for display.
    if (!ans || (questionType.get(g.questionId) === 'DESCRIPTIVE' && g.outcome !== 'OVERRIDDEN')) continue;
    await tx.submittedAnswer.update({ where: { id: ans.id }, data: { marksAwarded: g.marksAwarded, isCorrect: g.isCorrect } });
  }

  const data = {
    objectiveScore: summary.objectiveScore,
    descriptiveScore: summary.descriptiveScore,
    totalScore: summary.totalScore,
    maxScore: summary.maxScore,
    percentage: summary.percentage,
    passed: summary.passed,
    correctCount: summary.correctCount,
    incorrectCount: summary.incorrectCount,
    unansweredCount: summary.unansweredCount,
    pendingReviewCount: summary.pendingReviewCount,
    status: summary.status,
    gradedAt: summary.status === 'GRADED' ? new Date() : null,
  } as const;
  return tx.result.upsert({
    where: { attemptId },
    create: { attemptId, examId: exam.id, studentId: attempt.studentId, ...data },
    update: data,
  });
}

/**
 * Closes an attempt and grades it exactly once. The conditional status update acts as the lock:
 * a concurrent or repeated submission matches zero rows and simply returns the existing result.
 */
export async function finalizeAttempt(attemptId: string, type: SubmissionType, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { deadlineAt: true } });
    const submittedAt = type === 'AUTO_TIMEOUT' && now > attempt.deadlineAt ? attempt.deadlineAt : now;
    const { count } = await tx.examAttempt.updateMany({
      where: { id: attemptId, status: 'IN_PROGRESS' },
      data: { status: 'SUBMITTED', submittedAt, submissionType: type },
    });
    if (count === 0) {
      return { result: await tx.result.findUnique({ where: { attemptId } }), alreadySubmitted: true };
    }
    return { result: await gradeAndStore(tx, attemptId), alreadySubmitted: false };
  });
  return outcome;
}

export async function submitAttempt(attemptId: string, studentId: string, now = new Date()) {
  const attempt = await loadOwnedAttempt(attemptId, studentId);
  // Submissions arriving after the deadline (e.g. the client timer hitting zero) count as automatic.
  const pastDeadline = now.getTime() > attempt.deadlineAt.getTime();
  const { alreadySubmitted } = await finalizeAttempt(attemptId, pastDeadline ? 'AUTO_TIMEOUT' : 'MANUAL', now);
  const fresh = await prisma.examAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { exam: { select: { id: true, title: true, createdById: true } }, _count: { select: { answers: true } } },
  });
  if (!alreadySubmitted) {
    await notifyUsers([studentId], {
      type: 'EXAM',
      title: 'Submission received',
      message: `Your attempt for "${fresh.exam.title}" was submitted successfully.`,
      link: `/student/results/${attemptId}`,
    });
  }
  return {
    receipt: {
      attemptId: fresh.id,
      examId: fresh.exam.id,
      examTitle: fresh.exam.title,
      attemptNumber: fresh.attemptNumber,
      submittedAt: fresh.submittedAt,
      submissionType: fresh.submissionType,
      status: fresh.status,
    },
    alreadySubmitted,
  };
}

/** Re-grades after faculty marks a descriptive answer. */
export async function regradeAttempt(attemptId: string) {
  return prisma.$transaction((tx) => gradeAndStore(tx, attemptId));
}

/** Auto-submits attempts whose deadline has passed (students who closed the tab, lost power, etc.). */
export async function sweepExpiredAttempts(now = new Date()) {
  const expired = await prisma.examAttempt.findMany({
    where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(now.getTime() - graceMs()) } },
    select: { id: true },
    take: 200,
  });
  for (const { id } of expired) {
    try {
      await finalizeAttempt(id, 'AUTO_TIMEOUT', now);
    } catch (err) {
      console.error('[sweeper] failed to finalize attempt', id, err);
    }
  }
  return expired.length;
}

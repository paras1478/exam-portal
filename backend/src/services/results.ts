import type { Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyUsers } from '../lib/notify.js';
import { mailTemplates } from '../lib/mailer.js';
import { assertPermission, hasPermission } from '../middleware/auth.js';
import { isResultReleased } from './examRules.js';
import { regradeAttempt } from './attempts.js';
import { round2 } from './grading.js';

/** Loads a result the actor may see: any result with `result:read_all`, otherwise results of their own exams. */
export async function loadAccessibleResult(req: Request, resultId: string) {
  const result = await prisma.result.findUnique({ where: { id: resultId }, include: { exam: true } });
  if (!result) throw ApiError.notFound('Result not found');
  const canReadAll = await hasPermission(req, 'result:read_all');
  if (!canReadAll && !(result.exam.createdById === req.user!.id && (await hasPermission(req, 'result:read_own_exams')))) {
    throw ApiError.notFound('Result not found');
  }
  return result;
}

/** Verifies and publishes one result. Repeated publication is rejected rather than re-notifying. */
export async function publishResult(req: Request, resultId: string) {
  const result = await loadAccessibleResult(req, resultId);
  await assertPermission(req, 'result:publish');
  if (result.exam.status === 'CANCELLED') throw ApiError.conflict('Results of a cancelled exam cannot be published', 'EXAM_CANCELLED');
  if (result.status !== 'GRADED') throw ApiError.conflict('Finish grading every descriptive answer before publishing', 'NOT_GRADED');
  if (result.publishedAt) throw ApiError.conflict('This result has already been published', 'ALREADY_PUBLISHED');

  const publishedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.result.updateMany({
      where: { id: resultId, publishedAt: null, status: 'GRADED' },
      data: { publishedAt, publishedById: req.user!.id },
    });
    if (count === 0) throw ApiError.conflict('This result has already been published', 'ALREADY_PUBLISHED');
    await audit(req, 'RESULT_PUBLISHED', 'Result', resultId, { examId: result.examId, studentId: result.studentId, totalScore: result.totalScore }, tx);
  });
  await notifyUsers([result.studentId], {
    type: 'RESULT', title: 'Result published', message: `Your result for "${result.exam.title}" is now available.`, link: `/student/results/${result.attemptId}`,
  });
  return { publishedAt };
}

/**
 * Publishes every graded, unpublished result of an exam and marks the exam's results as published.
 * Calling it again only publishes results finalised since the last call.
 */
export async function publishExamResults(req: Request, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw ApiError.notFound('Exam not found');
  if (exam.createdById !== req.user!.id && !(await hasPermission(req, 'result:read_all'))) throw ApiError.notFound('Exam not found');
  await assertPermission(req, 'result:publish');
  if (exam.status !== 'PUBLISHED' && exam.status !== 'ARCHIVED') {
    throw ApiError.conflict('Results can only be published for published or archived exams', 'INVALID_STATE');
  }

  const pending = await prisma.result.findMany({
    where: { examId, status: 'GRADED', publishedAt: null },
    select: { id: true, attemptId: true, student: { select: { id: true, email: true, name: true } } },
  });
  if (pending.length === 0 && exam.resultsPublishedAt) {
    throw ApiError.conflict('There are no newly graded results to publish', 'NOTHING_TO_PUBLISH');
  }
  const publishedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.exam.update({ where: { id: examId }, data: { resultsPublishedAt: publishedAt } });
    await tx.result.updateMany({ where: { id: { in: pending.map((p) => p.id) }, publishedAt: null }, data: { publishedAt, publishedById: req.user!.id } });
    await audit(req, 'RESULTS_PUBLISHED', 'Exam', examId, { title: exam.title, published: pending.length }, tx);
  });

  for (const p of pending) {
    await notifyUsers([p.student.id], {
      type: 'RESULT', title: 'Result published', message: `Your result for "${exam.title}" is now available.`, link: `/student/results/${p.attemptId}`,
    });
    void mailTemplates.resultsPublished(p.student.email, p.student.name, exam.title);
  }
  const pendingReview = await prisma.result.count({ where: { examId, status: 'PENDING_REVIEW' } });
  return { resultsPublishedAt: publishedAt, notified: pending.length, pendingReview };
}

interface MarkChange {
  attemptId: string;
  questionId: string;
  marks: number;
  feedback?: string | null;
  reason?: string | null;
}

/**
 * Applies a manual mark and re-grades the attempt.
 *  - Faculty grading of a descriptive answer before release is a normal GRADE.
 *  - Any change to a result that students can already see — and any change to an objective answer —
 *    is a CORRECTION: it needs `result:correct` and a reason, and is recorded as a revision.
 */
export async function applyMark(req: Request, change: MarkChange, mode: 'GRADE' | 'CORRECTION') {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: change.attemptId },
    include: { exam: true, result: true },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.status !== 'SUBMITTED' || !attempt.result) throw ApiError.conflict('Only submitted attempts can be graded');
  if (attempt.exam.status === 'CANCELLED') throw ApiError.conflict('Results of a cancelled exam cannot be changed', 'EXAM_CANCELLED');

  const question = await prisma.question.findFirst({ where: { id: change.questionId, examId: attempt.examId } });
  if (!question) throw ApiError.notFound('Question not found');
  if (change.marks < 0 || change.marks > question.marks) throw ApiError.badRequest(`Marks must be between 0 and ${question.marks}`);

  const answer = await prisma.submittedAnswer.findUnique({ where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } } });
  const released = isResultReleased(attempt.exam, attempt.result);
  // An answer that already carries a correction can only be changed by another correction;
  // otherwise the override would silently mask the new grade.
  const effectiveMode =
    mode === 'CORRECTION' || released || question.type !== 'DESCRIPTIVE' || answer?.overrideMarks != null ? 'CORRECTION' : 'GRADE';
  if (effectiveMode === 'CORRECTION') {
    await assertPermission(req, 'result:correct');
    if (!change.reason?.trim()) throw ApiError.badRequest('A reason is required to correct a result', { fieldErrors: { reason: ['A reason is required to correct a result'] } });
  } else {
    await assertPermission(req, 'attempt:grade');
  }

  if (effectiveMode === 'GRADE' && !answer?.textAnswer?.trim()) {
    throw ApiError.badRequest('This question was not answered, so it scores 0 automatically');
  }
  const previousMarks = answer?.overrideMarks ?? answer?.marksAwarded ?? 0;
  const previousTotal = attempt.result.totalScore;

  const now = new Date();
  if (effectiveMode === 'GRADE') {
    await prisma.submittedAnswer.update({
      where: { id: answer!.id },
      data: { marksAwarded: change.marks, feedback: change.feedback ?? null, gradedById: req.user!.id, gradedAt: now },
    });
  } else {
    await prisma.submittedAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
      create: { attemptId: attempt.id, questionId: question.id, overrideMarks: change.marks, feedback: change.feedback ?? null, gradedById: req.user!.id, gradedAt: now },
      update: { overrideMarks: change.marks, ...(change.feedback !== undefined && { feedback: change.feedback }), gradedById: req.user!.id, gradedAt: now },
    });
  }

  const result = await regradeAttempt(attempt.id);
  await prisma.resultRevision.create({
    data: {
      resultId: result.id, questionId: question.id, kind: effectiveMode, reason: change.reason?.trim() || null,
      previousMarks: round2(previousMarks), newMarks: change.marks, previousTotalScore: previousTotal, newTotalScore: result.totalScore, actorId: req.user!.id,
    },
  });
  await audit(req, effectiveMode === 'GRADE' ? 'ANSWER_GRADED' : 'RESULT_CORRECTED', 'Result', result.id, {
    attemptId: attempt.id, questionId: question.id, previousMarks, newMarks: change.marks,
    previousTotal, newTotal: result.totalScore, reason: change.reason?.trim() || null,
  });

  if (released) {
    await notifyUsers([attempt.studentId], {
      type: 'RESULT', title: 'Result updated', message: `Your result for "${attempt.exam.title}" was corrected.`, link: `/student/results/${attempt.id}`,
    });
  } else if (attempt.result.status === 'PENDING_REVIEW' && result.status === 'GRADED') {
    await notifyUsers([attempt.studentId], {
      type: 'RESULT', title: 'Evaluation complete', message: `Your attempt for "${attempt.exam.title}" has been fully evaluated.`, link: `/student/results/${attempt.id}`,
    });
  }
  return result;
}

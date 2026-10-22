import type { Request } from 'express';
import type { Exam, ExamStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyUsers } from '../lib/notify.js';
import { mailTemplates } from '../lib/mailer.js';
import { hasPermission } from '../middleware/auth.js';
import { getSettings, type SystemSettings } from './settings.js';
import { finalizeAttempt } from './attempts.js';
import type { Permission } from './permissions.js';

export type ExamAction = 'SUBMIT' | 'WITHDRAW' | 'APPROVE' | 'REJECT' | 'PUBLISH' | 'UNPUBLISH' | 'CANCEL' | 'ARCHIVE' | 'RESTORE';

interface Rule {
  from: (s: SystemSettings) => ExamStatus[];
  permission: Permission;
  /** Faculty may act on their own exams; these actions are reserved for reviewers regardless of ownership. */
  reviewerOnly?: boolean;
  reasonRequired?: boolean;
}

/**
 * The exam state machine. Every status change in the system goes through `transitionExam`, so no API
 * can skip a step (e.g. publish without approval when approval is required).
 *
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──publish──▶ PUBLISHED
 *     ▲ ▲                  │  └─reject─▶ REJECTED ──submit──┘(resubmit)       │
 *     │ └────withdraw──────┴───────────── APPROVED                            │
 *     └───────────────────────unpublish (no attempts)─────────────────────────┘
 *   cancel: PENDING_APPROVAL | APPROVED | PUBLISHED → CANCELLED (reason required)
 *   archive: DRAFT | REJECTED | CANCELLED | PUBLISHED(ended) → ARCHIVED;  restore → previous status
 *   Without the approval requirement, DRAFT → PUBLISHED directly.
 */
export const RULES: Record<ExamAction, Rule> = {
  SUBMIT: { from: () => ['DRAFT', 'REJECTED'], permission: 'exam:submit' },
  WITHDRAW: { from: () => ['PENDING_APPROVAL', 'APPROVED'], permission: 'exam:submit' },
  APPROVE: { from: () => ['PENDING_APPROVAL'], permission: 'exam:approve', reviewerOnly: true },
  REJECT: { from: () => ['PENDING_APPROVAL'], permission: 'exam:approve', reviewerOnly: true, reasonRequired: true },
  PUBLISH: { from: (s) => (s.requireExamApproval ? ['APPROVED'] : ['DRAFT', 'APPROVED']), permission: 'exam:publish' },
  UNPUBLISH: { from: () => ['PUBLISHED'], permission: 'exam:publish' },
  CANCEL: { from: () => ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHED'], permission: 'exam:cancel', reviewerOnly: true, reasonRequired: true },
  ARCHIVE: { from: () => ['DRAFT', 'REJECTED', 'CANCELLED', 'PUBLISHED'], permission: 'exam:archive' },
  RESTORE: { from: () => ['ARCHIVED'], permission: 'exam:archive' },
};

const ACTION_LABEL: Record<ExamAction, string> = {
  SUBMIT: 'submitted for approval', WITHDRAW: 'withdrawn', APPROVE: 'approved', REJECT: 'rejected', PUBLISH: 'published',
  UNPUBLISH: 'unpublished', CANCEL: 'cancelled', ARCHIVE: 'archived', RESTORE: 'restored',
};

/** Problems that prevent an exam from being submitted, approved or published. */
export async function readinessProblems(exam: Exam, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const questions = await db.question.findMany({ where: { examId: exam.id }, include: { options: true } });
  const problems: string[] = [];
  if (questions.length === 0) problems.push('Add at least one question');
  if (exam.passMarks > exam.totalMarks) problems.push('Pass marks cannot exceed total marks');
  if (exam.endsAt <= new Date()) problems.push('The availability window has already ended');
  if (exam.negativeMarking && exam.negativeMarkRatio <= 0) problems.push('Set a negative marking ratio or disable negative marking');
  questions.forEach((q, i) => {
    if (q.type !== 'DESCRIPTIVE' && !q.options.some((o) => o.isCorrect)) problems.push(`Question ${i + 1} has no correct option`);
  });
  return problems;
}

async function targetStatus(action: ExamAction, exam: Exam): Promise<ExamStatus> {
  switch (action) {
    case 'SUBMIT': return 'PENDING_APPROVAL';
    case 'WITHDRAW': return 'DRAFT';
    case 'APPROVE': return 'APPROVED';
    case 'REJECT': return 'REJECTED';
    case 'PUBLISH': return 'PUBLISHED';
    case 'UNPUBLISH': return 'DRAFT';
    case 'CANCEL': return 'CANCELLED';
    case 'ARCHIVE': return 'ARCHIVED';
    case 'RESTORE': {
      const last = await prisma.examStatusChange.findFirst({ where: { examId: exam.id, action: 'ARCHIVE' }, orderBy: { createdAt: 'desc' } });
      const previous = last?.fromStatus ?? (exam.publishedAt ? 'PUBLISHED' : 'DRAFT');
      // Anything that was mid-review returns to draft; published/cancelled exams return as they were.
      return previous === 'PUBLISHED' || previous === 'CANCELLED' ? previous : 'DRAFT';
    }
  }
}

/** Loads an exam the actor may manage: own exams for faculty, any exam with `exam:manage_any`. */
export async function loadManagedExam(req: Request, id: string) {
  const exam = await prisma.exam.findUnique({ where: { id } });
  if (!exam) throw ApiError.notFound('Exam not found');
  if (exam.createdById !== req.user!.id && !(await hasPermission(req, 'exam:manage_any'))) throw ApiError.notFound('Exam not found');
  return exam;
}

export async function transitionExam(req: Request, examId: string, action: ExamAction, reason?: string | null) {
  const rule = RULES[action];
  const settings = await getSettings();
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw ApiError.notFound('Exam not found');

  const isOwner = exam.createdById === req.user!.id;
  const canManageAny = await hasPermission(req, 'exam:manage_any');
  if (!isOwner && !canManageAny) throw ApiError.notFound('Exam not found'); // don't disclose other faculty's exams
  if (!(await hasPermission(req, rule.permission))) {
    await audit(req, `EXAM_${action}`, 'Exam', examId, { reason: 'missing permission', permission: rule.permission }, undefined, 'DENIED');
    throw ApiError.forbidden();
  }

  const reject = async (message: string, code = 'INVALID_TRANSITION', details?: unknown) => {
    await audit(req, `EXAM_${action}`, 'Exam', examId, { from: exam.status, error: message }, undefined, 'FAILURE');
    const err = new ApiError(code === 'NOT_READY' ? 400 : 409, message, code, details);
    throw err;
  };

  if (action === 'SUBMIT' && !settings.requireExamApproval) {
    await reject('Approval is not required. Publish the exam directly.', 'APPROVAL_NOT_REQUIRED');
  }
  if (!rule.from(settings).includes(exam.status)) {
    const hint = action === 'PUBLISH' && settings.requireExamApproval && exam.status !== 'PUBLISHED' ? ' Exams must be approved by an administrator first.' : '';
    await reject(`Cannot ${action.toLowerCase()} an exam that is ${exam.status.replace('_', ' ').toLowerCase()}.${hint}`);
  }
  if (rule.reasonRequired && !reason?.trim()) await reject('A reason is required for this action', 'REASON_REQUIRED');

  if (action === 'SUBMIT' || action === 'APPROVE' || action === 'PUBLISH') {
    const problems = await readinessProblems(exam);
    if (problems.length) await reject('Exam is not ready', 'NOT_READY', { problems });
  }
  const attemptCount = await prisma.examAttempt.count({ where: { examId } });
  if (action === 'UNPUBLISH' && attemptCount > 0) {
    await reject('Students have already attempted this exam; archive or cancel it instead.', 'EXAM_LOCKED');
  }
  if (action === 'ARCHIVE' && exam.status === 'PUBLISHED' && exam.endsAt > new Date()) {
    await reject('Only completed exams can be archived. Cancel the exam to stop it early.');
  }

  const to = await targetStatus(action, exam);
  const now = new Date();
  const data: Prisma.ExamUncheckedUpdateManyInput = { status: to };
  switch (action) {
    case 'SUBMIT': Object.assign(data, { submittedForApprovalAt: now, reviewNote: null }); break;
    case 'WITHDRAW': Object.assign(data, { approvedAt: null, approvedById: null }); break;
    case 'APPROVE': Object.assign(data, { approvedAt: now, approvedById: req.user!.id, reviewNote: reason?.trim() || null }); break;
    case 'REJECT': Object.assign(data, { approvedAt: null, approvedById: null, reviewNote: reason!.trim() }); break;
    case 'PUBLISH': Object.assign(data, { publishedAt: now }); break;
    case 'UNPUBLISH': Object.assign(data, { publishedAt: null, approvedAt: null, approvedById: null }); break;
    case 'CANCEL': Object.assign(data, { cancelledAt: now, reviewNote: reason!.trim() }); break;
  }

  await prisma.$transaction(async (tx) => {
    // Conditional update: a concurrent or repeated request sees zero rows and fails cleanly.
    const { count } = await tx.exam.updateMany({ where: { id: examId, status: exam.status }, data });
    if (count === 0) throw ApiError.conflict('The exam was changed by someone else. Refresh and try again.', 'STALE_STATE');
    await tx.examStatusChange.create({
      data: { examId, fromStatus: exam.status, toStatus: to, action, reason: reason?.trim() || null, actorId: req.user!.id },
    });
    await audit(req, `EXAM_${action}`, 'Exam', examId, { title: exam.title, from: exam.status, to, reason: reason?.trim() || null }, tx);
  });

  await afterTransition(req, exam, action, reason ?? null);
  return to;
}

/**
 * Actions the current user could take on this exam right now (readiness is checked when acting).
 * Used by the UI to decide which buttons to show; the server re-checks everything in transitionExam.
 */
export async function availableActions(req: Request, exam: Exam, attemptCount: number): Promise<ExamAction[]> {
  const settings = await getSettings();
  const isOwner = exam.createdById === req.user!.id;
  const canManageAny = await hasPermission(req, 'exam:manage_any');
  if (!isOwner && !canManageAny) return [];
  const out: ExamAction[] = [];
  for (const action of Object.keys(RULES) as ExamAction[]) {
    const rule = RULES[action];
    if (!(await hasPermission(req, rule.permission))) continue;
    if (!rule.from(settings).includes(exam.status)) continue;
    if (action === 'SUBMIT' && !settings.requireExamApproval) continue;
    if (action === 'UNPUBLISH' && attemptCount > 0) continue;
    if (action === 'ARCHIVE' && exam.status === 'PUBLISHED' && exam.endsAt > new Date()) continue;
    out.push(action);
  }
  return out;
}

async function afterTransition(req: Request, exam: Exam, action: ExamAction, reason: string | null) {
  const link = `/faculty/exams/${exam.id}`;
  if (action === 'SUBMIT') {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    await notifyUsers(admins.map((a) => a.id), { type: 'EXAM', title: 'Exam awaiting approval', message: `"${exam.title}" was submitted by ${req.user!.name}.`, link: `/admin/exams/${exam.id}` });
  }
  if ((action === 'APPROVE' || action === 'REJECT' || action === 'CANCEL') && exam.createdById !== req.user!.id) {
    await notifyUsers([exam.createdById], {
      type: 'EXAM',
      title: `Exam ${ACTION_LABEL[action]}`,
      message: `"${exam.title}" was ${ACTION_LABEL[action]}${reason ? `: ${reason}` : '.'}`,
      link,
    });
  }
  if (action === 'PUBLISH') {
    const students = await prisma.user.findMany({ where: { role: 'STUDENT', status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true, name: true } });
    await notifyUsers(students.map((s) => s.id), {
      type: 'EXAM', title: 'New exam scheduled', message: `"${exam.title}" (${exam.subject}) opens ${exam.startsAt.toISOString()}.`, link: `/student/exams/${exam.id}`,
    });
    for (const s of students) void mailTemplates.examScheduled(s.email, s.name, exam.title, exam.startsAt, exam.durationMinutes);
    if (exam.createdById !== req.user!.id) {
      await notifyUsers([exam.createdById], { type: 'EXAM', title: 'Exam published', message: `"${exam.title}" is now published.`, link });
    }
  }
  if (action === 'CANCEL' && exam.status === 'PUBLISHED') {
    // Stop running attempts immediately; their results are never released for a cancelled exam.
    const running = await prisma.examAttempt.findMany({ where: { examId: exam.id, status: 'IN_PROGRESS' }, select: { id: true } });
    for (const a of running) await finalizeAttempt(a.id, 'AUTO_TIMEOUT');
    const participants = await prisma.examAttempt.findMany({ where: { examId: exam.id }, distinct: ['studentId'], select: { studentId: true } });
    await notifyUsers(participants.map((p) => p.studentId), {
      type: 'EXAM', title: 'Exam cancelled', message: `"${exam.title}" has been cancelled${reason ? `: ${reason}` : '.'}`,
    });
  }
}

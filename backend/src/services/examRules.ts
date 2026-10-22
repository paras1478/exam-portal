import type { Exam, ExamStatus, Result } from '@prisma/client';
import type { SystemSettings } from './settings.js';

export type ExamPhase =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SCHEDULED'
  | 'LIVE'
  | 'ENDED'
  | 'CANCELLED'
  | 'ARCHIVED';

/** Display phase: workflow status, or for published exams where "now" falls in the window. */
export function examPhase(exam: Pick<Exam, 'status' | 'startsAt' | 'endsAt'>, now = new Date()): ExamPhase {
  if (exam.status !== 'PUBLISHED') return exam.status;
  if (now < exam.startsAt) return 'SCHEDULED';
  if (now <= exam.endsAt) return 'LIVE';
  return 'ENDED';
}

type ReleaseExam = Pick<Exam, 'status' | 'resultRelease' | 'resultsPublishedAt' | 'endsAt'>;
type ReleaseResult = Pick<Result, 'status' | 'publishedAt'>;

/**
 * Whether a student may see their score. A result must be fully graded, the exam must not be cancelled,
 * and it must be released: individually published, published for the whole exam, or released
 * automatically by the exam's visibility setting (IMMEDIATE / AFTER_END).
 */
export function isResultReleased(exam: ReleaseExam, result: ReleaseResult, now = new Date()) {
  if (result.status !== 'GRADED' || exam.status === 'CANCELLED') return false;
  if (result.publishedAt || exam.resultsPublishedAt) return true;
  if (exam.resultRelease === 'IMMEDIATE') return true;
  if (exam.resultRelease === 'AFTER_END') return now > exam.endsAt;
  return false;
}

/**
 * Whether correct answers/explanations may be shown. Beyond the release rule, answers stay hidden
 * while the student could still use them in another attempt during an open window.
 */
export function canRevealAnswers(exam: ReleaseExam & Pick<Exam, 'maxAttempts'>, result: ReleaseResult, attemptsUsed: number, now = new Date()) {
  if (!isResultReleased(exam, result, now)) return false;
  const windowOpen = now <= exam.endsAt;
  return !(windowOpen && attemptsUsed < exam.maxAttempts);
}

export type EditLevel = 'FULL' | 'SAFE' | 'NONE';

/**
 * How much of an exam may be edited.
 *  FULL — everything, including questions (drafts, rejected exams, unapproved & unattempted published exams).
 *  SAFE — only presentation fields and extending the window: content that was approved or has been attempted is frozen.
 *  NONE — under review, cancelled or archived.
 */
export function editLevel(status: ExamStatus, attemptCount: number, settings: Pick<SystemSettings, 'requireExamApproval'>): EditLevel {
  switch (status) {
    case 'DRAFT':
    case 'REJECTED':
      return 'FULL';
    case 'APPROVED':
      return 'SAFE';
    case 'PUBLISHED':
      return attemptCount > 0 || settings.requireExamApproval ? 'SAFE' : 'FULL';
    default:
      return 'NONE';
  }
}

/** Fields accepted at the SAFE level. `resultRelease` is only free when no approval is involved. */
export function safeFields(settings: Pick<SystemSettings, 'requireExamApproval'>) {
  const fields = new Set(['title', 'description', 'instructions', 'endsAt']);
  if (!settings.requireExamApproval) fields.add('resultRelease');
  return fields;
}

export const STUDENT_VISIBLE_STATUSES: ExamStatus[] = ['PUBLISHED'];

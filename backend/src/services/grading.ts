import type { QuestionType } from '@prisma/client';

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  marks: number;
  options: { id: string; isCorrect: boolean }[];
}

export interface GradableAnswer {
  questionId: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
  /** Manually awarded marks for a descriptive answer; null/undefined while ungraded. */
  manualMarks?: number | null;
  /** Marks set by an authorised correction; replaces automatic grading for that question. */
  overrideMarks?: number | null;
}

export interface GradingConfig {
  negativeMarking: boolean;
  negativeMarkRatio: number;
  passMarks: number;
}

export type Outcome = 'CORRECT' | 'INCORRECT' | 'UNANSWERED' | 'PENDING_REVIEW' | 'GRADED' | 'OVERRIDDEN';

export interface QuestionGrade {
  questionId: string;
  outcome: Outcome;
  marksAwarded: number | null;
  isCorrect: boolean | null;
}

export interface GradeSummary {
  perQuestion: QuestionGrade[];
  objectiveScore: number;
  descriptiveScore: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  pendingReviewCount: number;
  status: 'GRADED' | 'PENDING_REVIEW';
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function isAnswered(type: QuestionType, a: GradableAnswer | undefined) {
  if (!a) return false;
  return type === 'DESCRIPTIVE' ? !!a.textAnswer?.trim() : a.selectedOptionIds.length > 0;
}

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Grades an attempt deterministically from the exam configuration.
 *  - MCQ / TRUE_FALSE: the single selected option must be correct.
 *  - MULTI_SELECT: the selected set must exactly equal the set of correct options (no partial credit).
 *  - Wrong objective answers lose `marks * negativeMarkRatio` only when negative marking is enabled.
 *  - Unanswered questions score 0.
 *  - Descriptive answers stay PENDING_REVIEW until faculty awards marks.
 *  - An authorised override (correction) replaces the automatic marks for that question.
 *  - The total is floored at 0; pass/fail is only decided once nothing is pending review.
 */
export function gradeAttempt(questions: GradableQuestion[], answers: GradableAnswer[], cfg: GradingConfig): GradeSummary {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const perQuestion: QuestionGrade[] = [];
  let objectiveScore = 0;
  let descriptiveScore = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let pendingReviewCount = 0;
  let maxScore = 0;

  for (const q of questions) {
    maxScore += q.marks;
    const a = byQuestion.get(q.id);

    if (a?.overrideMarks !== null && a?.overrideMarks !== undefined) {
      const m = Math.min(Math.max(a.overrideMarks, 0), q.marks);
      if (q.type === 'DESCRIPTIVE') descriptiveScore += m;
      else objectiveScore += m;
      perQuestion.push({ questionId: q.id, outcome: 'OVERRIDDEN', marksAwarded: m, isCorrect: q.type === 'DESCRIPTIVE' ? null : m === q.marks });
      continue;
    }

    if (!isAnswered(q.type, a)) {
      unansweredCount++;
      perQuestion.push({ questionId: q.id, outcome: 'UNANSWERED', marksAwarded: 0, isCorrect: null });
      continue;
    }

    if (q.type === 'DESCRIPTIVE') {
      if (a!.manualMarks === null || a!.manualMarks === undefined) {
        pendingReviewCount++;
        perQuestion.push({ questionId: q.id, outcome: 'PENDING_REVIEW', marksAwarded: null, isCorrect: null });
      } else {
        const m = Math.min(Math.max(a!.manualMarks, 0), q.marks);
        descriptiveScore += m;
        perQuestion.push({ questionId: q.id, outcome: 'GRADED', marksAwarded: m, isCorrect: null });
      }
      continue;
    }

    const correctIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
    const correct = sameSet(a!.selectedOptionIds, correctIds);
    if (correct) {
      correctCount++;
      objectiveScore += q.marks;
      perQuestion.push({ questionId: q.id, outcome: 'CORRECT', marksAwarded: q.marks, isCorrect: true });
    } else {
      incorrectCount++;
      const penalty = cfg.negativeMarking ? round2(q.marks * cfg.negativeMarkRatio) : 0;
      objectiveScore -= penalty;
      perQuestion.push({ questionId: q.id, outcome: 'INCORRECT', marksAwarded: -penalty, isCorrect: false });
    }
  }

  const totalScore = round2(Math.max(0, objectiveScore + descriptiveScore));
  maxScore = round2(maxScore);
  const status = pendingReviewCount > 0 ? 'PENDING_REVIEW' : 'GRADED';
  return {
    perQuestion,
    objectiveScore: round2(objectiveScore),
    descriptiveScore: round2(descriptiveScore),
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? round2((totalScore / maxScore) * 100) : 0,
    passed: status === 'GRADED' && totalScore >= cfg.passMarks,
    correctCount,
    incorrectCount,
    unansweredCount,
    pendingReviewCount,
    status,
  };
}

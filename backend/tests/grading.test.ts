import { describe, expect, it } from 'vitest';
import { gradeAttempt, type GradableQuestion } from '../src/services/grading.js';

const questions: GradableQuestion[] = [
  { id: 'q1', type: 'MCQ', marks: 2, options: [{ id: 'a', isCorrect: true }, { id: 'b', isCorrect: false }] },
  { id: 'q2', type: 'TRUE_FALSE', marks: 1, options: [{ id: 't', isCorrect: false }, { id: 'f', isCorrect: true }] },
  { id: 'q3', type: 'MULTI_SELECT', marks: 4, options: [{ id: 'w', isCorrect: true }, { id: 'x', isCorrect: true }, { id: 'y', isCorrect: false }] },
  { id: 'q4', type: 'DESCRIPTIVE', marks: 5, options: [] },
];
const noNeg = { negativeMarking: false, negativeMarkRatio: 0, passMarks: 6 };

describe('gradeAttempt', () => {
  it('awards full marks for all-correct objective answers and leaves descriptive pending', () => {
    const r = gradeAttempt(
      questions,
      [
        { questionId: 'q1', selectedOptionIds: ['a'], textAnswer: null },
        { questionId: 'q2', selectedOptionIds: ['f'], textAnswer: null },
        { questionId: 'q3', selectedOptionIds: ['x', 'w'], textAnswer: null },
        { questionId: 'q4', selectedOptionIds: [], textAnswer: 'An essay' },
      ],
      noNeg,
    );
    expect(r.objectiveScore).toBe(7);
    expect(r.correctCount).toBe(3);
    expect(r.pendingReviewCount).toBe(1);
    expect(r.status).toBe('PENDING_REVIEW');
    expect(r.passed).toBe(false); // undecided until review completes
    expect(r.maxScore).toBe(12);
  });

  it('gives no partial credit for multi-select', () => {
    const r = gradeAttempt(questions, [{ questionId: 'q3', selectedOptionIds: ['w'], textAnswer: null }], noNeg);
    expect(r.perQuestion.find((p) => p.questionId === 'q3')!.outcome).toBe('INCORRECT');
    expect(r.totalScore).toBe(0);
  });

  it('applies negative marking only when enabled and floors the total at zero', () => {
    const answers = [
      { questionId: 'q1', selectedOptionIds: ['b'], textAnswer: null },
      { questionId: 'q2', selectedOptionIds: ['t'], textAnswer: null },
    ];
    expect(gradeAttempt(questions, answers, noNeg).objectiveScore).toBe(0);
    const neg = gradeAttempt(questions, answers, { negativeMarking: true, negativeMarkRatio: 0.25, passMarks: 6 });
    expect(neg.objectiveScore).toBe(-0.75);
    expect(neg.totalScore).toBe(0);
    expect(neg.incorrectCount).toBe(2);
  });

  it('counts unanswered questions without penalty', () => {
    const r = gradeAttempt(questions, [], { negativeMarking: true, negativeMarkRatio: 0.5, passMarks: 6 });
    expect(r.unansweredCount).toBe(4);
    expect(r.totalScore).toBe(0);
    expect(r.status).toBe('GRADED');
  });

  it('includes manual descriptive marks, clamped to the question maximum, and decides pass/fail', () => {
    const r = gradeAttempt(
      questions,
      [
        { questionId: 'q1', selectedOptionIds: ['a'], textAnswer: null },
        { questionId: 'q4', selectedOptionIds: [], textAnswer: 'Essay', manualMarks: 9 },
      ],
      noNeg,
    );
    expect(r.descriptiveScore).toBe(5);
    expect(r.totalScore).toBe(7);
    expect(r.status).toBe('GRADED');
    expect(r.passed).toBe(true);
    expect(r.percentage).toBeCloseTo(58.33, 2);
  });

  it('treats whitespace-only descriptive answers as unanswered', () => {
    const r = gradeAttempt(questions, [{ questionId: 'q4', selectedOptionIds: [], textAnswer: '   ' }], noNeg);
    expect(r.unansweredCount).toBe(4);
    expect(r.pendingReviewCount).toBe(0);
  });
});

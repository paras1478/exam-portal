import { beforeEach, describe, expect, it } from 'vitest';
import { client, createExam, createUser, prisma, resetDb } from './helpers.js';
import { finalizeAttempt, sweepExpiredAttempts } from '../src/services/attempts.js';

beforeEach(resetDb);

async function setup(examOpts: Parameters<typeof createExam>[1] = {}) {
  const faculty = await createUser('FACULTY');
  const student = await createUser('STUDENT');
  const exam = await createExam(faculty.id, examOpts);
  const api = await client(student.email);
  return { faculty, student, exam, api };
}

async function expireAttempt(attemptId: string, secondsAgo = 120) {
  await prisma.examAttempt.update({ where: { id: attemptId }, data: { deadlineAt: new Date(Date.now() - secondsAgo * 1000) } });
}

describe('exam timing (server-authoritative)', () => {
  it('sets the deadline on the server, capped by the exam window', async () => {
    const { exam, api } = await setup({ durationMinutes: 60, endsAt: new Date(Date.now() + 10 * 60_000) });
    const res = await api.post(`/api/student/exams/${exam.id}/attempts`);
    expect(res.status).toBe(201);
    const deadline = new Date(res.body.data.deadlineAt).getTime();
    expect(Math.abs(deadline - exam.endsAt.getTime())).toBeLessThan(1000);
  });

  it('refuses to start before the window opens or after it closes', async () => {
    const early = await setup({ startsAt: new Date(Date.now() + 3600_000), endsAt: new Date(Date.now() + 7200_000) });
    expect((await early.api.post(`/api/student/exams/${early.exam.id}/attempts`)).body.error.code).toBe('EXAM_NOT_STARTED');
    const late = await setup({ startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) });
    expect((await late.api.post(`/api/student/exams/${late.exam.id}/attempts`)).body.error.code).toBe('EXAM_ENDED');
  });

  it('resumes the same attempt after a refresh instead of creating a new one', async () => {
    const { exam, api } = await setup();
    const first = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const second = await api.post(`/api/student/exams/${exam.id}/attempts`);
    expect(second.status).toBe(200);
    expect(second.body.data.resumed).toBe(true);
    expect(second.body.data.attemptId).toBe(first.body.data.attemptId);
  });

  it('creates only one attempt under concurrent start requests', async () => {
    const { exam, api } = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => api.post(`/api/student/exams/${exam.id}/attempts`)));
    const ids = new Set(results.map((r) => r.body.data?.attemptId));
    expect(ids.size).toBe(1);
    expect(await prisma.examAttempt.count({ where: { examId: exam.id } })).toBe(1);
  });

  it('rejects answers after the deadline and auto-submits the attempt', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const attemptId = body.data.attemptId;
    await api.put(`/api/student/attempts/${attemptId}/answers`, { answers: [{ questionId: exam.questions[0]!.id, selectedOptionIds: [exam.questions[0]!.options[0]!.id] }] });
    await expireAttempt(attemptId);

    const late = await api.put(`/api/student/attempts/${attemptId}/answers`, { answers: [{ questionId: exam.questions[1]!.id, selectedOptionIds: [exam.questions[1]!.options[1]!.id] }] });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('TIME_UP');

    const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { result: true } });
    expect(attempt.status).toBe('SUBMITTED');
    expect(attempt.submissionType).toBe('AUTO_TIMEOUT');
    expect(attempt.submittedAt!.getTime()).toBe(attempt.deadlineAt.getTime());
    expect(attempt.result!.correctCount).toBe(1); // only the answer saved in time counts
  });

  it('accepts autosaves within the grace period for in-flight requests', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await expireAttempt(body.data.attemptId, 3);
    const res = await api.put(`/api/student/attempts/${body.data.attemptId}/answers`, { answers: [{ questionId: exam.questions[0]!.id, selectedOptionIds: [] }] });
    expect(res.status).toBe(200);
  });

  it('records a submission arriving just after the deadline as automatic', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await expireAttempt(body.data.attemptId, 2); // within the grace period, as when the client timer hits zero
    const res = await api.post(`/api/student/attempts/${body.data.attemptId}/submit`);
    expect(res.body.data.receipt.submissionType).toBe('AUTO_TIMEOUT');
  });

  it('sweeps abandoned attempts whose deadline has passed', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await expireAttempt(body.data.attemptId);
    expect(await sweepExpiredAttempts()).toBe(1);
    const result = await prisma.result.findUnique({ where: { attemptId: body.data.attemptId } });
    expect(result).toBeTruthy();
    expect(await sweepExpiredAttempts()).toBe(0);
  });

  it('enforces the attempt limit', async () => {
    const { exam, api } = await setup({ maxAttempts: 1 });
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await api.post(`/api/student/attempts/${body.data.attemptId}/submit`);
    const again = await api.post(`/api/student/exams/${exam.id}/attempts`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ATTEMPT_LIMIT');
  });
});

describe('answer persistence', () => {
  it('persists answers, review flags and visited state across reloads', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const id = body.data.attemptId;
    const [q1, q2, , q4] = exam.questions;
    await api.put(`/api/student/attempts/${id}/answers`, {
      answers: [
        { questionId: q1!.id, selectedOptionIds: [q1!.options[1]!.id], markedForReview: true },
        { questionId: q2!.id, selectedOptionIds: [] },
        { questionId: q4!.id, textAnswer: 'Draft essay' },
      ],
    });
    // Change an answer: last write wins.
    await api.put(`/api/student/attempts/${id}/answers`, { answers: [{ questionId: q1!.id, selectedOptionIds: [q1!.options[0]!.id] }] });

    const state = await api.get(`/api/student/attempts/${id}`);
    expect(state.status).toBe(200);
    const answers = Object.fromEntries(state.body.data.answers.map((a: { questionId: string }) => [a.questionId, a]));
    expect(answers[q1!.id].selectedOptionIds).toEqual([q1!.options[0]!.id]);
    expect(answers[q1!.id].markedForReview).toBe(true);
    expect(answers[q2!.id].selectedOptionIds).toEqual([]); // visited, not answered
    expect(answers[q4!.id].textAnswer).toBe('Draft essay');
  });

  it('never exposes correct answers in the attempt payload', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const state = await api.get(`/api/student/attempts/${body.data.attemptId}`);
    const raw = JSON.stringify(state.body);
    expect(raw).not.toContain('isCorrect');
    expect(raw).not.toContain('explanation');
  });

  it('validates options against the question', async () => {
    const { exam, api } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const [q1, , q3] = exam.questions;
    const foreign = await api.put(`/api/student/attempts/${body.data.attemptId}/answers`, { answers: [{ questionId: q1!.id, selectedOptionIds: [q3!.options[0]!.id] }] });
    expect(foreign.status).toBe(400);
    const tooMany = await api.put(`/api/student/attempts/${body.data.attemptId}/answers`, { answers: [{ questionId: q1!.id, selectedOptionIds: q1!.options.slice(0, 2).map((o) => o.id) }] });
    expect(tooMany.status).toBe(400);
  });
});

describe('submission and grading', () => {
  it('grades on submit and handles duplicate/concurrent submissions idempotently', async () => {
    const { exam, api } = await setup({ negativeMarking: true, negativeMarkRatio: 0.5, passMarks: 3 });
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const id = body.data.attemptId;
    const [q1, q2, q3] = exam.questions;
    await api.put(`/api/student/attempts/${id}/answers`, {
      answers: [
        { questionId: q1!.id, selectedOptionIds: [q1!.options[0]!.id] }, // correct +2
        { questionId: q2!.id, selectedOptionIds: [q2!.options[0]!.id] }, // wrong -0.5
        { questionId: q3!.id, selectedOptionIds: [q3!.options[0]!.id, q3!.options[1]!.id] }, // correct +3
      ],
    });

    const submissions = await Promise.all(Array.from({ length: 4 }, () => api.post(`/api/student/attempts/${id}/submit`)));
    expect(submissions.every((s) => s.status === 200)).toBe(true);
    expect(submissions.filter((s) => s.body.data.alreadySubmitted === false)).toHaveLength(1);
    expect(await prisma.result.count({ where: { attemptId: id } })).toBe(1);

    const result = await prisma.result.findUniqueOrThrow({ where: { attemptId: id } });
    expect(result.objectiveScore).toBe(4.5);
    expect(result.correctCount).toBe(2);
    expect(result.incorrectCount).toBe(1);
    expect(result.unansweredCount).toBe(1);
    expect(result.status).toBe('GRADED'); // descriptive unanswered → nothing to review

    expect((await api.put(`/api/student/attempts/${id}/answers`, { answers: [{ questionId: q1!.id, selectedOptionIds: [] }] })).body.error.code).toBe('ATTEMPT_CLOSED');
  });

  it('finalizeAttempt is idempotent when called directly', async () => {
    const { exam, student } = await setup();
    const attempt = await prisma.examAttempt.create({ data: { examId: exam.id, studentId: student.id, attemptNumber: 1, deadlineAt: new Date(Date.now() + 60_000) } });
    const [a, b] = await Promise.all([finalizeAttempt(attempt.id, 'MANUAL'), finalizeAttempt(attempt.id, 'AUTO_TIMEOUT')]);
    expect([a.alreadySubmitted, b.alreadySubmitted].sort()).toEqual([false, true]);
    expect(await prisma.result.count()).toBe(1);
  });

  it('keeps results pending until descriptive answers are graded by faculty', async () => {
    const { exam, api, faculty } = await setup();
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    const id = body.data.attemptId;
    const essay = exam.questions[3]!;
    await api.put(`/api/student/attempts/${id}/answers`, { answers: [{ questionId: essay.id, textAnswer: 'My essay' }] });
    await api.post(`/api/student/attempts/${id}/submit`);

    const pending = await api.get(`/api/student/results/${id}`);
    expect(pending.body.data.resultStatus).toBe('PENDING_REVIEW');
    expect(pending.body.data.result).toBeNull();

    const facultyApi = await client(faculty.email);
    expect((await facultyApi.put(`/api/exams/attempts/${id}/answers/${essay.id}/grade`, { marks: 99 })).status).toBe(400);
    const graded = await facultyApi.put(`/api/exams/attempts/${id}/answers/${essay.id}/grade`, { marks: 3.5, feedback: 'Good' });
    expect(graded.status).toBe(200);
    expect(graded.body.data.status).toBe('GRADED');
    expect(graded.body.data.totalScore).toBe(3.5);

    const released = await api.get(`/api/student/results/${id}`);
    expect(released.body.data.result.totalScore).toBe(3.5);
  });

  it('withholds scores and correct answers until the configured release', async () => {
    const { exam, api, faculty } = await setup({ resultRelease: 'MANUAL' });
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await api.post(`/api/student/attempts/${body.data.attemptId}/submit`);

    const hidden = await api.get(`/api/student/results/${body.data.attemptId}`);
    expect(hidden.body.data.released).toBe(false);
    expect(hidden.body.data.result).toBeNull();
    expect(JSON.stringify(hidden.body)).not.toContain('"isCorrect":true');

    // Faculty may not publish results unless the policy allows it; an administrator can.
    const facultyApi = await client(faculty.email);
    expect((await facultyApi.post(`/api/exams/${exam.id}/results/publish`)).status).toBe(403);
    const admin = await createUser('ADMIN');
    const adminApi = await client(admin.email);
    expect((await adminApi.patch(`/api/admin/exams/${exam.id}/results/publish`)).status).toBe(200);
    const shown = await api.get(`/api/student/results/${body.data.attemptId}`);
    expect(shown.body.data.released).toBe(true);
    expect(shown.body.data.answersRevealed).toBe(true);
    expect(shown.body.data.questions[0].options.some((o: { isCorrect?: boolean }) => o.isCorrect)).toBe(true);
  });

  it('hides correct answers while the student still has attempts left in an open window', async () => {
    const { exam, api } = await setup({ resultRelease: 'IMMEDIATE', maxAttempts: 2 });
    const { body } = await api.post(`/api/student/exams/${exam.id}/attempts`);
    await api.post(`/api/student/attempts/${body.data.attemptId}/submit`);
    const res = await api.get(`/api/student/results/${body.data.attemptId}`);
    expect(res.body.data.released).toBe(true);
    expect(res.body.data.answersRevealed).toBe(false);
  });
});

describe('exam integrity for faculty edits', () => {
  it('locks questions and grading rules once attempts exist', async () => {
    const { exam, api, faculty } = await setup();
    await api.post(`/api/student/exams/${exam.id}/attempts`);
    const facultyApi = await client(faculty.email);
    expect((await facultyApi.patch(`/api/exams/${exam.id}`, { durationMinutes: 5 })).body.error.code).toBe('EXAM_LOCKED');
    expect((await facultyApi.delete(`/api/exams/${exam.id}/questions/${exam.questions[0]!.id}`)).body.error.code).toBe('EXAM_LOCKED');
    expect((await facultyApi.post(`/api/exams/${exam.id}/questions`, { type: 'DESCRIPTIVE', text: 'New', marks: 1 })).body.error.code).toBe('EXAM_LOCKED');
    expect((await facultyApi.delete(`/api/exams/${exam.id}`)).status).toBe(409);
    // Safe edits are still allowed.
    expect((await facultyApi.patch(`/api/exams/${exam.id}`, { instructions: 'Updated' })).status).toBe(200);
  });

  it('validates a draft before publishing', async () => {
    const faculty = await createUser('FACULTY');
    const api = await client(faculty.email);
    const created = await api.post('/api/exams', {
      title: 'Empty', subject: 'Testing', durationMinutes: 10, passMarks: 1,
      startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const fail = await api.post(`/api/exams/${id}/submit`);
    expect(fail.status).toBe(400);
    expect(fail.body.error.details.problems).toContain('Add at least one question');

    const badQ = await api.post(`/api/exams/${id}/questions`, { type: 'MCQ', text: 'Q', marks: 2, options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] });
    expect(badQ.status).toBe(400);
    const goodQ = await api.post(`/api/exams/${id}/questions`, { type: 'MCQ', text: 'Q', marks: 2, options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }] });
    expect(goodQ.body.data.totalMarks).toBe(2);
    // Approval is required by default: publishing a draft directly is an invalid transition.
    expect((await api.post(`/api/exams/${id}/publish`)).body.error.code).toBe('INVALID_TRANSITION');
    expect((await api.post(`/api/exams/${id}/submit`)).body.data.status).toBe('PENDING_APPROVAL');
  });
});

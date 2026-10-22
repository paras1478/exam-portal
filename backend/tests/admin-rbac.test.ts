import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, client, createExam, createUser, PASSWORD, prisma, resetDb, setSetting } from './helpers.js';

beforeEach(resetDb);

const validExam = () => ({
  title: 'Workflow Exam', subject: 'Testing', durationMinutes: 30, passMarks: 1,
  startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), resultRelease: 'MANUAL',
});
const mcq = { type: 'MCQ', text: 'Pick A', marks: 2, options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] };

async function draftWithQuestion(api: Awaited<ReturnType<typeof client>>) {
  const created = await api.post('/api/exams', validExam());
  expect(created.status).toBe(201);
  await api.post(`/api/exams/${created.body.data.id}/questions`, mcq);
  return created.body.data.id as string;
}

describe('1. unauthenticated access', () => {
  it.each([
    ['get', '/api/admin/dashboard/stats'],
    ['get', '/api/admin/users'],
    ['get', '/api/admin/settings'],
    ['get', '/api/admin/audit-logs'],
    ['get', '/api/admin/reports/results'],
  ])('%s %s → 401', async (_m, path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  it('rejects state-changing admin calls without a session', async () => {
    const api = await client(); // has a CSRF token but no session
    expect((await api.patch('/api/admin/exams/00000000-0000-4000-8000-000000000000/approve')).status).toBe(401);
    expect((await api.patch('/api/admin/settings', { requireExamApproval: false })).status).toBe(401);
  });
});

describe('2 & 4. students cannot reach admin or faculty functions', () => {
  it('returns 403 for every admin and faculty area and records the denial', async () => {
    const faculty = await createUser('FACULTY');
    const student = await createUser('STUDENT');
    const exam = await createExam(faculty.id, { status: 'PENDING_APPROVAL' });
    const api = await client(student.email);

    for (const path of ['/api/admin/dashboard/stats', '/api/admin/users', '/api/admin/results', '/api/exams', '/api/faculty/dashboard']) {
      expect((await api.get(path)).status).toBe(403);
    }
    expect((await api.patch(`/api/admin/exams/${exam.id}/approve`)).status).toBe(403);
    expect((await api.patch(`/api/admin/exams/${exam.id}/publish`)).status).toBe(403);
    expect((await api.post(`/api/exams/${exam.id}/publish`)).status).toBe(403);
    expect((await api.patch('/api/admin/settings', { requireExamApproval: false })).status).toBe(403);

    const denied = await prisma.auditLog.findMany({ where: { action: 'ACCESS_DENIED', actorId: student.id } });
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((d) => d.outcome === 'DENIED' && d.actorRole === 'STUDENT')).toBe(true);
  });
});

describe('3. privilege escalation', () => {
  it('a faculty member cannot make themselves admin by any route', async () => {
    const faculty = await createUser('FACULTY');
    const api = await client(faculty.email);
    expect((await api.patch(`/api/admin/users/${faculty.id}/role`, { role: 'ADMIN' })).status).toBe(403);
    const me = await api.patch('/api/auth/me', { name: 'Still Faculty', role: 'ADMIN', status: 'ACTIVE' });
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('FACULTY');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: faculty.id } })).role).toBe('FACULTY');
  });

  it('admins cannot change their own role or status and the profile endpoint rejects mass assignment', async () => {
    const admin = await createUser('ADMIN');
    await createUser('ADMIN'); // a second admin, so the last-admin rule is not what blocks this
    const api = await client(admin.email);
    expect((await api.patch(`/api/admin/users/${admin.id}/role`, { role: 'STUDENT' })).status).toBe(403);
    expect((await api.patch(`/api/admin/users/${admin.id}/status`, { status: 'SUSPENDED' })).status).toBe(403);
    expect((await api.delete(`/api/admin/users/${admin.id}`)).status).toBe(403);

    const target = await createUser('STUDENT');
    const sneaky = await api.patch(`/api/admin/users/${target.id}`, { name: 'Renamed', role: 'ADMIN' });
    expect(sneaky.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('STUDENT');
  });

  it('admins cannot create administrator accounts directly', async () => {
    const admin = await createUser('ADMIN');
    const api = await client(admin.email);
    const res = await api.post('/api/admin/users', { name: 'New Admin', email: 'na@test.dev', password: 'Secret123', role: 'ADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('5 & 9. examination approval workflow', () => {
  it('runs draft → pending → rejected → resubmitted → approved → published → cancelled', async () => {
    const faculty = await createUser('FACULTY');
    const admin = await createUser('ADMIN');
    const student = await createUser('STUDENT');
    const fApi = await client(faculty.email);
    const aApi = await client(admin.email);
    const sApi = await client(student.email);

    const id = await draftWithQuestion(fApi);
    expect((await sApi.get(`/api/student/exams/${id}`)).status).toBe(404); // drafts are invisible

    expect((await fApi.post(`/api/exams/${id}/submit`)).body.data.status).toBe('PENDING_APPROVAL');
    // Content is frozen while under review.
    expect((await fApi.post(`/api/exams/${id}/questions`, mcq)).body.error.code).toBe('EXAM_LOCKED');
    // Faculty cannot approve, even their own exam.
    expect((await fApi.patch(`/api/admin/exams/${id}/approve`)).status).toBe(403);

    expect((await aApi.patch(`/api/admin/exams/${id}/reject`, {})).status).toBe(400); // reason required
    const rejected = await aApi.patch(`/api/admin/exams/${id}/reject`, { reason: 'Add more questions' });
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.reviewNote).toBe('Add more questions');

    await fApi.post(`/api/exams/${id}/questions`, mcq); // rejected exams are editable again
    expect((await fApi.post(`/api/exams/${id}/submit`)).body.data.status).toBe('PENDING_APPROVAL');
    const approved = await aApi.patch(`/api/admin/exams/${id}/approve`, { reason: 'Looks good' });
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvedBy.id).toBe(admin.id);

    expect((await fApi.post(`/api/exams/${id}/publish`)).body.data.status).toBe('PUBLISHED');
    expect((await sApi.get(`/api/student/exams/${id}`)).status).toBe(200);
    const attempt = await sApi.post(`/api/student/exams/${id}/attempts`);
    expect(attempt.status).toBe(201);

    expect((await aApi.patch(`/api/admin/exams/${id}/cancel`, {})).status).toBe(400);
    expect((await aApi.patch(`/api/admin/exams/${id}/cancel`, { reason: 'Paper leaked' })).body.data.status).toBe('CANCELLED');
    // Running attempts are closed and further work is refused.
    const closed = await prisma.examAttempt.findUniqueOrThrow({ where: { id: attempt.body.data.attemptId } });
    expect(closed.status).toBe('SUBMITTED');
    expect((await sApi.post(`/api/student/exams/${id}/attempts`)).status).toBe(404);

    const history = await prisma.examStatusChange.findMany({ where: { examId: id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.action)).toEqual(['SUBMIT', 'REJECT', 'SUBMIT', 'APPROVE', 'PUBLISH', 'CANCEL']);
    expect(history.find((h) => h.action === 'REJECT')!.reason).toBe('Add more questions');
  });

  it('rejects invalid transitions', async () => {
    const faculty = await createUser('FACULTY');
    const admin = await createUser('ADMIN');
    const fApi = await client(faculty.email);
    const aApi = await client(admin.email);
    const id = await draftWithQuestion(fApi);

    expect((await aApi.patch(`/api/admin/exams/${id}/approve`)).body.error.code).toBe('INVALID_TRANSITION'); // not submitted
    expect((await fApi.post(`/api/exams/${id}/publish`)).body.error.code).toBe('INVALID_TRANSITION'); // approval required
    await fApi.post(`/api/exams/${id}/submit`);
    expect((await fApi.post(`/api/exams/${id}/publish`)).body.error.code).toBe('INVALID_TRANSITION'); // still pending
    expect((await fApi.post(`/api/exams/${id}/submit`)).body.error.code).toBe('INVALID_TRANSITION'); // duplicate submit
    await aApi.patch(`/api/admin/exams/${id}/approve`);
    expect((await aApi.patch(`/api/admin/exams/${id}/approve`)).body.error.code).toBe('INVALID_TRANSITION'); // duplicate approval
    await aApi.patch(`/api/admin/exams/${id}/publish`);
    expect((await aApi.patch(`/api/admin/exams/${id}/archive`)).status).toBe(409); // live exams cannot be archived

    const live = await createExam(faculty.id, { status: 'PUBLISHED' });
    await prisma.examAttempt.create({ data: { examId: live.id, studentId: (await createUser('STUDENT')).id, attemptNumber: 1, deadlineAt: new Date(Date.now() + 60_000) } });
    expect((await fApi.post(`/api/exams/${live.id}/unpublish`)).body.error.code).toBe('EXAM_LOCKED');

    const archived = await createExam(faculty.id, { status: 'ARCHIVED' });
    expect((await aApi.patch(`/api/admin/exams/${archived.id}/cancel`, { reason: 'x reason' })).body.error.code).toBe('INVALID_TRANSITION');

    const failures = await prisma.auditLog.count({ where: { outcome: 'FAILURE', action: { startsWith: 'EXAM_' } } });
    expect(failures).toBeGreaterThan(0);
  });

  it('handles concurrent approvals exactly once', async () => {
    const faculty = await createUser('FACULTY');
    const admin = await createUser('ADMIN');
    const fApi = await client(faculty.email);
    const aApi = await client(admin.email);
    const id = await draftWithQuestion(fApi);
    await fApi.post(`/api/exams/${id}/submit`);
    const results = await Promise.all([1, 2, 3].map(() => aApi.patch(`/api/admin/exams/${id}/approve`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.examStatusChange.count({ where: { examId: id, action: 'APPROVE' } })).toBe(1);
  });

  it('lets faculty publish directly when approval is not required', async () => {
    await setSetting('requireExamApproval', false);
    const faculty = await createUser('FACULTY');
    const fApi = await client(faculty.email);
    const id = await draftWithQuestion(fApi);
    expect((await fApi.post(`/api/exams/${id}/submit`)).body.error.code).toBe('APPROVAL_NOT_REQUIRED');
    expect((await fApi.post(`/api/exams/${id}/publish`)).body.data.status).toBe('PUBLISHED');
  });

  it('freezes approved content except for safe fields', async () => {
    const faculty = await createUser('FACULTY');
    const exam = await createExam(faculty.id, { status: 'APPROVED' });
    const fApi = await client(faculty.email);
    expect((await fApi.patch(`/api/exams/${exam.id}`, { durationMinutes: 99 })).body.error.code).toBe('EXAM_LOCKED');
    expect((await fApi.patch(`/api/exams/${exam.id}`, { instructions: 'Bring a calculator' })).status).toBe(200);
    expect((await fApi.post(`/api/exams/${exam.id}/withdraw`)).body.data.status).toBe('DRAFT');
    expect((await fApi.patch(`/api/exams/${exam.id}`, { durationMinutes: 99 })).status).toBe(200);
  });
});

describe('6 & 7. result publication and confidentiality', () => {
  async function submittedAttempt(release: 'MANUAL' | 'IMMEDIATE' = 'MANUAL') {
    const faculty = await createUser('FACULTY');
    const student = await createUser('STUDENT');
    const admin = await createUser('ADMIN');
    const exam = await createExam(faculty.id, { resultRelease: release, questions: [{ type: 'MCQ', marks: 2, options: [['A', true], ['B', false]] }] });
    const sApi = await client(student.email);
    const { body } = await sApi.post(`/api/student/exams/${exam.id}/attempts`);
    await sApi.put(`/api/student/attempts/${body.data.attemptId}/answers`, { answers: [{ questionId: exam.questions[0]!.id, selectedOptionIds: [exam.questions[0]!.options[0]!.id] }] });
    await sApi.post(`/api/student/attempts/${body.data.attemptId}/submit`);
    const result = await prisma.result.findUniqueOrThrow({ where: { attemptId: body.data.attemptId } });
    return { faculty, student, admin, exam, sApi, attemptId: body.data.attemptId as string, result };
  }

  it('keeps results hidden until an admin publishes them, and refuses repeated publication', async () => {
    const { admin, sApi, attemptId, result } = await submittedAttempt();
    const hidden = await sApi.get(`/api/student/results/${attemptId}`);
    expect(hidden.body.data.released).toBe(false);
    expect(hidden.body.data.result).toBeNull();
    expect(JSON.stringify(hidden.body)).not.toContain('"isCorrect":true');
    expect((await sApi.get('/api/student/results')).body.data[0].score).toBeNull();

    const aApi = await client(admin.email);
    const awaiting = await aApi.get('/api/admin/results?publication=awaiting');
    expect(awaiting.body.data.map((r: { id: string }) => r.id)).toContain(result.id);

    expect((await aApi.patch(`/api/admin/results/${result.id}/publish`)).status).toBe(200);
    expect((await aApi.patch(`/api/admin/results/${result.id}/publish`)).body.error.code).toBe('ALREADY_PUBLISHED');
    const shown = await sApi.get(`/api/student/results/${attemptId}`);
    expect(shown.body.data.released).toBe(true);
    expect(shown.body.data.result.totalScore).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'RESULT_PUBLISHED', entityId: result.id } })).toBe(1);
  });

  it('lets faculty publish results only when the policy allows it', async () => {
    const { faculty, exam } = await submittedAttempt();
    const fApi = await client(faculty.email);
    expect((await fApi.post(`/api/exams/${exam.id}/results/publish`)).status).toBe(403);
    await setSetting('facultyCanPublishResults', true);
    expect((await fApi.post(`/api/exams/${exam.id}/results/publish`)).status).toBe(200);
    expect((await fApi.post(`/api/exams/${exam.id}/results/publish`)).body.error.code).toBe('NOTHING_TO_PUBLISH');
  });

  it('prevents access to other students\' results and other faculty\'s submissions', async () => {
    const { attemptId, result } = await submittedAttempt();
    const otherStudent = await createUser('STUDENT');
    const otherFaculty = await createUser('FACULTY');
    expect((await (await client(otherStudent.email)).get(`/api/student/results/${attemptId}`)).status).toBe(404);
    const ofApi = await client(otherFaculty.email);
    expect((await ofApi.get(`/api/exams/attempts/${attemptId}`)).status).toBe(404);
    expect((await ofApi.get(`/api/admin/results/${result.id}`)).status).toBe(403);
  });

  it('requires a reason and permission to correct a published result, and records a revision', async () => {
    const { faculty, admin, exam, sApi, attemptId, result } = await submittedAttempt('IMMEDIATE');
    const q = exam.questions[0]!;
    // Already visible to the student → faculty cannot silently change it.
    const fApi = await client(faculty.email);
    expect((await fApi.put(`/api/exams/attempts/${attemptId}/answers/${q.id}/grade`, { marks: 1 })).status).toBe(403);

    const aApi = await client(admin.email);
    expect((await aApi.patch(`/api/admin/results/${result.id}/correct`, { questionId: q.id, marks: 1 })).status).toBe(400);
    expect((await aApi.patch(`/api/admin/results/${result.id}/correct`, { questionId: q.id, marks: 5, reason: 'Too many' })).status).toBe(400);
    const corrected = await aApi.patch(`/api/admin/results/${result.id}/correct`, { questionId: q.id, marks: 1, reason: 'Ambiguous wording' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.totalScore).toBe(1);

    const revisions = await prisma.resultRevision.findMany({ where: { resultId: result.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ kind: 'CORRECTION', reason: 'Ambiguous wording', previousTotalScore: 2, newTotalScore: 1 });
    expect((await sApi.get(`/api/student/results/${attemptId}`)).body.data.result.totalScore).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'RESULT_CORRECTED' } })).toBe(1);
  });
});

describe('corrections take precedence over later grading', () => {
  it('treats grading an already-corrected descriptive answer as a correction', async () => {
    const faculty = await createUser('FACULTY');
    const admin = await createUser('ADMIN');
    const student = await createUser('STUDENT');
    const exam = await createExam(faculty.id, { resultRelease: 'MANUAL', questions: [{ type: 'DESCRIPTIVE', marks: 5 }] });
    const sApi = await client(student.email);
    const { body } = await sApi.post(`/api/student/exams/${exam.id}/attempts`);
    const q = exam.questions[0]!;
    await sApi.put(`/api/student/attempts/${body.data.attemptId}/answers`, { answers: [{ questionId: q.id, textAnswer: 'Essay' }] });
    await sApi.post(`/api/student/attempts/${body.data.attemptId}/submit`);
    const result = await prisma.result.findUniqueOrThrow({ where: { attemptId: body.data.attemptId } });

    const aApi = await client(admin.email);
    expect((await aApi.patch(`/api/admin/results/${result.id}/correct`, { questionId: q.id, marks: 4, reason: 'Moderation' })).body.data.totalScore).toBe(4);
    // Faculty lacks result:correct, so they can no longer change this answer (their grade would be masked).
    const fApi = await client(faculty.email);
    expect((await fApi.put(`/api/exams/attempts/${body.data.attemptId}/answers/${q.id}/grade`, { marks: 1 })).status).toBe(403);
    expect((await prisma.result.findUniqueOrThrow({ where: { id: result.id } })).totalScore).toBe(4);
  });
});

describe('8. session revocation', () => {
  it('blocks a deactivated account immediately, including existing sessions', async () => {
    const admin = await createUser('ADMIN');
    const student = await createUser('STUDENT');
    const sApi = await client(student.email);
    expect((await sApi.get('/api/student/dashboard')).status).toBe(200);

    const aApi = await client(admin.email);
    expect((await aApi.patch(`/api/admin/users/${student.id}/status`, { status: 'INACTIVE', reason: 'Graduated' })).status).toBe(200);
    expect((await sApi.get('/api/student/dashboard')).status).toBe(401);
    const relogin = await (await client()).post('/api/auth/login', { email: student.email, password: PASSWORD });
    expect(relogin.status).toBe(403);
  });

  it('changing a password signs out other sessions but keeps the current one', async () => {
    const user = await createUser('STUDENT');
    const first = await client(user.email);
    const second = await client(user.email);
    expect((await first.post('/api/auth/me/password', { currentPassword: PASSWORD, newPassword: 'Changed123' })).status).toBe(200);
    expect((await first.get('/api/auth/me')).status).toBe(200);
    expect((await second.get('/api/auth/me')).status).toBe(401);
  });
});

describe('user deletion (retention policy)', () => {
  it('hard-deletes accounts without history and soft-deletes accounts with records', async () => {
    const admin = await createUser('ADMIN');
    const aApi = await client(admin.email);
    const fresh = await createUser('STUDENT');
    expect((await aApi.delete(`/api/admin/users/${fresh.id}`)).body.data.mode).toBe('HARD');
    expect(await prisma.user.findUnique({ where: { id: fresh.id } })).toBeNull();

    const faculty = await createUser('FACULTY');
    const withHistory = await createUser('STUDENT');
    const exam = await createExam(faculty.id);
    await prisma.examAttempt.create({ data: { examId: exam.id, studentId: withHistory.id, attemptNumber: 1, deadlineAt: new Date(Date.now() + 60_000) } });
    const soft = await aApi.delete(`/api/admin/users/${withHistory.id}`);
    expect(soft.body.data.mode).toBe('SOFT');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: withHistory.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect((await (await client()).post('/api/auth/login', { email: withHistory.email, password: PASSWORD })).status).toBe(401);
    expect((await aApi.get('/api/admin/users')).body.data.map((u: { id: string }) => u.id)).not.toContain(withHistory.id);
    expect(await prisma.auditLog.count({ where: { action: 'USER_DELETED' } })).toBe(2);
  });
});

describe('10. audit trail', () => {
  it('records critical actions with actor snapshots and is append-only', async () => {
    const admin = await createUser('ADMIN');
    const target = await createUser('STUDENT');
    const aApi = await client(admin.email);
    await aApi.patch(`/api/admin/users/${target.id}/role`, { role: 'FACULTY', reason: 'Hired as TA' });
    await aApi.patch(`/api/admin/users/${target.id}/status`, { status: 'SUSPENDED' });
    await aApi.patch('/api/admin/settings', { facultyCanPublishResults: true });

    const logs = await prisma.auditLog.findMany({ where: { actorId: admin.id }, orderBy: { createdAt: 'asc' } });
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['USER_ROLE_CHANGED', 'USER_STATUS_CHANGED', 'SETTINGS_UPDATED']));
    const roleLog = logs.find((l) => l.action === 'USER_ROLE_CHANGED')!;
    expect(roleLog).toMatchObject({ actorEmail: admin.email, actorRole: 'ADMIN', outcome: 'SUCCESS', entityId: target.id });
    expect(roleLog.metadata).toMatchObject({ from: 'STUDENT', to: 'FACULTY', reason: 'Hired as TA' });

    await expect(prisma.auditLog.update({ where: { id: roleLog.id }, data: { action: 'TAMPERED' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: roleLog.id } })).rejects.toThrow();
  });

  it('never stores credentials in audit metadata', async () => {
    const admin = await createUser('ADMIN');
    const target = await createUser('STUDENT');
    const aApi = await client(admin.email);
    await aApi.post(`/api/admin/users/${target.id}/reset-password`, { newPassword: 'Reset12345' });
    await aApi.post('/api/admin/users', { name: 'Fresh User', email: 'fresh@test.dev', password: 'Fresh12345', role: 'STUDENT' });
    const raw = JSON.stringify(await prisma.auditLog.findMany());
    expect(raw).not.toContain('Reset12345');
    expect(raw).not.toContain('Fresh12345');
    expect(raw).not.toMatch(/passwordHash/);
  });
});

describe('11. dashboard reflects live database data', () => {
  it('counts users, pending approvals and results awaiting publication from the database', async () => {
    const admin = await createUser('ADMIN');
    const faculty = await createUser('FACULTY');
    await createUser('STUDENT');
    await createUser('STUDENT');
    await createExam(faculty.id, { status: 'PENDING_APPROVAL' });
    const aApi = await client(admin.email);

    const before = (await aApi.get('/api/admin/dashboard/stats')).body.data;
    expect(before.stats).toMatchObject({ students: 2, faculty: 1, admins: 1, exams: 1, pendingApprovals: 1, awaitingPublication: 0 });
    expect(before.pendingApprovals).toHaveLength(1);

    await createUser('STUDENT');
    const after = (await aApi.get('/api/admin/dashboard/stats')).body.data;
    expect(after.stats.students).toBe(3);
  });
});

describe('system settings', () => {
  it('validates settings, rejects unknown keys and enforces the registration policy', async () => {
    const admin = await createUser('ADMIN');
    const faculty = await createUser('FACULTY');
    const aApi = await client(admin.email);
    expect((await (await client(faculty.email)).patch('/api/admin/settings', { allowStudentRegistration: false })).status).toBe(403);
    expect((await aApi.patch('/api/admin/settings', { superUserMode: true })).status).toBe(400);
    expect((await aApi.patch('/api/admin/settings', { institutionName: 'x' })).status).toBe(400);

    const updated = await aApi.patch('/api/admin/settings', { allowStudentRegistration: false, institutionName: 'Test University' });
    expect(updated.body.data.settings).toMatchObject({ allowStudentRegistration: false, institutionName: 'Test University' });
    const reg = await (await client()).post('/api/auth/register', { name: 'Late', email: 'late@test.dev', password: 'Secret123' });
    expect(reg.status).toBe(403);
    const pub = await request(app).get('/api/auth/public-settings');
    expect(pub.body.data).toEqual({ institutionName: 'Test University', allowStudentRegistration: false, supportEmail: '' });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { client, createExam, createUser, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('role-based access control', () => {
  it('keeps students out of faculty and admin APIs', async () => {
    const student = await createUser('STUDENT');
    const api = await client(student.email);
    expect((await api.get('/api/exams')).status).toBe(403);
    expect((await api.get('/api/faculty/dashboard')).status).toBe(403);
    expect((await api.get('/api/admin/users')).status).toBe(403);
    expect((await api.post('/api/exams', {})).status).toBe(403);
  });

  it('keeps faculty out of admin and student-only APIs', async () => {
    const faculty = await createUser('FACULTY');
    const api = await client(faculty.email);
    expect((await api.get('/api/admin/dashboard')).status).toBe(403);
    expect((await api.get('/api/student/dashboard')).status).toBe(403);
  });

  it("prevents faculty from managing another faculty member's exam", async () => {
    const owner = await createUser('FACULTY');
    const other = await createUser('FACULTY');
    const exam = await createExam(owner.id, { status: 'DRAFT' });
    const api = await client(other.email);
    expect((await api.get(`/api/exams/${exam.id}`)).status).toBe(404);
    expect((await api.patch(`/api/exams/${exam.id}`, { title: 'Hijacked' })).status).toBe(404);
    expect((await api.delete(`/api/exams/${exam.id}`)).status).toBe(404);
    const list = await api.get('/api/exams');
    expect(list.body.data).toHaveLength(0);
  });

  it('lets admins manage any exam', async () => {
    const owner = await createUser('FACULTY');
    const admin = await createUser('ADMIN');
    const exam = await createExam(owner.id, { status: 'DRAFT' });
    const api = await client(admin.email);
    expect((await api.get(`/api/exams/${exam.id}`)).status).toBe(200);
  });

  it("prevents students from reading another student's attempt or result", async () => {
    const faculty = await createUser('FACULTY');
    const alice = await createUser('STUDENT');
    const bob = await createUser('STUDENT');
    const exam = await createExam(faculty.id);
    const aliceApi = await client(alice.email);
    const { body } = await aliceApi.post(`/api/student/exams/${exam.id}/attempts`);
    const attemptId = body.data.attemptId;

    const bobApi = await client(bob.email);
    expect((await bobApi.get(`/api/student/attempts/${attemptId}`)).status).toBe(404);
    expect((await bobApi.put(`/api/student/attempts/${attemptId}/answers`, { answers: [{ questionId: exam.questions[0]!.id, selectedOptionIds: [] }] })).status).toBe(404);
    expect((await bobApi.post(`/api/student/attempts/${attemptId}/submit`)).status).toBe(404);
    await aliceApi.post(`/api/student/attempts/${attemptId}/submit`);
    expect((await bobApi.get(`/api/student/results/${attemptId}`)).status).toBe(404);
  });

  it('hides draft exams from students', async () => {
    const faculty = await createUser('FACULTY');
    const student = await createUser('STUDENT');
    const draft = await createExam(faculty.id, { status: 'DRAFT' });
    const api = await client(student.email);
    expect((await api.get(`/api/student/exams/${draft.id}`)).status).toBe(404);
    expect((await api.post(`/api/student/exams/${draft.id}/attempts`)).status).toBe(404);
  });

  it('only admins change roles and statuses, and the last admin cannot be demoted', async () => {
    const admin = await createUser('ADMIN');
    const student = await createUser('STUDENT');
    const api = await client(admin.email);
    const promoted = await api.patch(`/api/admin/users/${student.id}/role`, { role: 'FACULTY' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('FACULTY');
    expect(promoted.body.data.facultyProfile).toBeTruthy();
    expect((await api.patch(`/api/admin/users/${admin.id}/role`, { role: 'STUDENT' })).status).toBe(403);
    const logs = await prisma.auditLog.findMany({ where: { action: 'USER_ROLE_CHANGED' } });
    expect(logs).toHaveLength(1);
  });

  it('revokes existing sessions when the role changes', async () => {
    const admin = await createUser('ADMIN');
    const faculty = await createUser('FACULTY');
    const facultyApi = await client(faculty.email);
    expect((await facultyApi.get('/api/exams')).status).toBe(200);
    const adminApi = await client(admin.email);
    await adminApi.patch(`/api/admin/users/${faculty.id}/role`, { role: 'STUDENT' });
    expect((await facultyApi.get('/api/exams')).status).toBe(401);
    // After signing in again the new role applies.
    const relogged = await client(faculty.email);
    expect((await relogged.get('/api/exams')).status).toBe(403);
    expect((await relogged.get('/api/student/dashboard')).status).toBe(200);
  });
});

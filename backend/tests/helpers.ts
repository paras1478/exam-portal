import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Role, QuestionType } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

export const app = createApp();
export const PASSWORD = 'Passw0rd!';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog","Notification","Announcement","SystemSetting","ResultRevision","ExamStatusChange","Result","SubmittedAnswer","ExamAttempt","QuestionOption","Question","Exam","StudentProfile","FacultyProfile","User" CASCADE',
  );
}

let seq = 0;
/** Overrides a system setting for the current test (the table is truncated between tests). */
export async function setSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

export async function createUser(role: Role, overrides: { status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' } = {}) {
  seq++;
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}${seq}@test.dev`,
      name: `${role} ${seq}`,
      role,
      passwordHash,
      status: overrides.status ?? 'ACTIVE',
      ...(role === 'STUDENT' && { studentProfile: { create: {} } }),
      ...(role === 'FACULTY' && { facultyProfile: { create: {} } }),
    },
  });
}

/** A supertest agent that keeps cookies and sends the CSRF header automatically. */
export async function client(email?: string) {
  const agent = request.agent(app);
  const csrfRes = await agent.get('/api/auth/csrf');
  let csrf: string = csrfRes.body.data.csrfToken;

  const refreshCsrf = (res: request.Response) => {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const c = cookies.find((x) => x.startsWith('ef_csrf='));
    if (c) csrf = decodeURIComponent(c.split(';')[0]!.split('=')[1]!);
    return res;
  };

  const api = {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set('X-CSRF-Token', csrf).send(body ?? {}).then(refreshCsrf),
    put: (url: string, body?: object) => agent.put(url).set('X-CSRF-Token', csrf).send(body ?? {}).then(refreshCsrf),
    patch: (url: string, body?: object) => agent.patch(url).set('X-CSRF-Token', csrf).send(body ?? {}).then(refreshCsrf),
    delete: (url: string) => agent.delete(url).set('X-CSRF-Token', csrf).then(refreshCsrf),
  };
  if (email) {
    const res = await api.post('/api/auth/login', { email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  }
  return api;
}

type QSpec = { type: QuestionType; marks: number; options?: [string, boolean][] };

export const standardQuestions: QSpec[] = [
  { type: 'MCQ', marks: 2, options: [['A', true], ['B', false], ['C', false]] },
  { type: 'TRUE_FALSE', marks: 1, options: [['True', false], ['False', true]] },
  { type: 'MULTI_SELECT', marks: 3, options: [['W', true], ['X', true], ['Y', false]] },
  { type: 'DESCRIPTIVE', marks: 4 },
];

export async function createExam(
  facultyId: string,
  opts: Partial<{
    startsAt: Date; endsAt: Date; durationMinutes: number; maxAttempts: number; status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'CANCELLED' | 'ARCHIVED';
    negativeMarking: boolean; negativeMarkRatio: number; resultRelease: 'IMMEDIATE' | 'AFTER_END' | 'MANUAL'; passMarks: number;
    questions: QSpec[];
  }> = {},
) {
  const questions = opts.questions ?? standardQuestions;
  return prisma.exam.create({
    data: {
      title: 'Test Exam',
      subject: 'Testing',
      durationMinutes: opts.durationMinutes ?? 30,
      totalMarks: questions.reduce((s, q) => s + q.marks, 0),
      passMarks: opts.passMarks ?? 4,
      negativeMarking: opts.negativeMarking ?? false,
      negativeMarkRatio: opts.negativeMarkRatio ?? 0,
      maxAttempts: opts.maxAttempts ?? 1,
      startsAt: opts.startsAt ?? new Date(Date.now() - 60_000),
      endsAt: opts.endsAt ?? new Date(Date.now() + 24 * 3600_000),
      status: opts.status ?? 'PUBLISHED',
      resultRelease: opts.resultRelease ?? 'IMMEDIATE',
      createdById: facultyId,
      questions: {
        create: questions.map((q, i) => ({
          type: q.type, text: `Question ${i + 1}`, marks: q.marks, order: i + 1, explanation: 'Because.',
          options: { create: (q.options ?? []).map(([text, isCorrect], j) => ({ text, isCorrect, order: j + 1 })) },
        })),
      },
    },
    include: { questions: { orderBy: { order: 'asc' }, include: { options: { orderBy: { order: 'asc' } } } } },
  });
}

export { prisma };

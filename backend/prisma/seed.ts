/**
 * Development seed. Creates demo accounts, exams in every lifecycle phase, and graded attempts.
 * Refuses to run in production. Re-running wipes and recreates the demo data.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient, type QuestionType } from '@prisma/client';
import { finalizeAttempt } from '../src/services/attempts.js';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('The development seed must not run in production. Use `npm run create-admin` instead.');
  process.exit(1);
}

const DEMO_PASSWORD = { admin: 'Admin@12345', faculty: 'Faculty@12345', student: 'Student@12345' };
const hour = 3600_000;
const day = 24 * hour;

type Q = { type: QuestionType; text: string; marks: number; explanation?: string; options?: [string, boolean][] };

const javascriptQuestions: Q[] = [
  { type: 'MCQ', text: 'Which keyword declares a block-scoped variable that cannot be reassigned?', marks: 2, explanation: '`const` creates a block-scoped binding that cannot be reassigned.', options: [['var', false], ['let', false], ['const', true], ['static', false]] },
  { type: 'TRUE_FALSE', text: '`typeof null` evaluates to "object" in JavaScript.', marks: 1, explanation: 'A long-standing quirk of the language.', options: [['True', true], ['False', false]] },
  { type: 'MULTI_SELECT', text: 'Which of the following are primitive types in JavaScript?', marks: 3, explanation: 'Objects and arrays are reference types.', options: [['string', true], ['symbol', true], ['array', false], ['bigint', true], ['object', false]] },
  { type: 'MCQ', text: 'What does `Array.prototype.map` return?', marks: 2, options: [['The original array, mutated', false], ['A new array of transformed elements', true], ['A single accumulated value', false], ['undefined', false]] },
  { type: 'DESCRIPTIVE', text: 'Explain the difference between the event loop\'s microtask and macrotask queues, with an example.', marks: 5 },
];

const dbQuestions: Q[] = [
  { type: 'MCQ', text: 'Which normal form removes transitive dependencies?', marks: 2, options: [['1NF', false], ['2NF', false], ['3NF', true], ['BCNF', false]] },
  { type: 'TRUE_FALSE', text: 'A primary key column may contain NULL values.', marks: 1, options: [['True', false], ['False', true]] },
  { type: 'MULTI_SELECT', text: 'Which are ACID properties?', marks: 3, options: [['Atomicity', true], ['Consistency', true], ['Availability', false], ['Durability', true]] },
  { type: 'MCQ', text: 'Which SQL clause filters grouped rows?', marks: 2, options: [['WHERE', false], ['HAVING', true], ['ORDER BY', false], ['LIMIT', false]] },
];

const mathQuestions: Q[] = [
  { type: 'MCQ', text: 'What is the derivative of sin(x)?', marks: 2, options: [['cos(x)', true], ['-cos(x)', false], ['-sin(x)', false], ['tan(x)', false]] },
  { type: 'TRUE_FALSE', text: 'Every bounded monotonic sequence of real numbers converges.', marks: 2, options: [['True', true], ['False', false]] },
  { type: 'DESCRIPTIVE', text: 'Prove that the square root of 2 is irrational.', marks: 6 },
];

async function createExam(createdById: string, data: {
  title: string; subject: string; description: string; startsAt: Date; endsAt: Date; durationMinutes: number;
  passRatio: number; status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'ARCHIVED'; questions: Q[]; negativeMarking?: boolean;
  resultRelease?: 'IMMEDIATE' | 'AFTER_END' | 'MANUAL'; maxAttempts?: number; resultsPublished?: boolean;
  approverId?: string; reviewNote?: string;
}) {
  // Reconstruct a realistic workflow history for the target status.
  // Workflow timestamps must lie in the past even for exams that start in the future.
  const t0 = Math.min(data.startsAt.getTime() - 3 * day, Date.now() - 6 * hour);
  const approvedLike = ['APPROVED', 'PUBLISHED', 'ARCHIVED'].includes(data.status);
  const publishedLike = ['PUBLISHED', 'ARCHIVED'].includes(data.status);
  const steps: { action: string; from: string; to: string; actor: string; reason?: string; at: number }[] = [];
  if (data.status !== 'DRAFT') steps.push({ action: 'SUBMIT', from: 'DRAFT', to: 'PENDING_APPROVAL', actor: createdById, at: t0 });
  if (data.status === 'REJECTED') steps.push({ action: 'REJECT', from: 'PENDING_APPROVAL', to: 'REJECTED', actor: data.approverId!, reason: data.reviewNote, at: t0 + hour });
  if (approvedLike) steps.push({ action: 'APPROVE', from: 'PENDING_APPROVAL', to: 'APPROVED', actor: data.approverId!, reason: data.reviewNote, at: t0 + hour });
  if (publishedLike) steps.push({ action: 'PUBLISH', from: 'APPROVED', to: 'PUBLISHED', actor: createdById, at: t0 + 2 * hour });
  const totalMarks = data.questions.reduce((s, q) => s + q.marks, 0);
  return prisma.exam.create({
    data: {
      title: data.title, subject: data.subject, description: data.description,
      instructions: 'Read every question carefully.\nYour answers are saved automatically.\nThe exam submits itself when the timer reaches zero.',
      durationMinutes: data.durationMinutes, totalMarks, passMarks: Math.round(totalMarks * data.passRatio),
      negativeMarking: data.negativeMarking ?? false, negativeMarkRatio: data.negativeMarking ? 0.25 : 0,
      maxAttempts: data.maxAttempts ?? 1, startsAt: data.startsAt, endsAt: data.endsAt, status: data.status,
      resultRelease: data.resultRelease ?? 'AFTER_END',
      resultsPublishedAt: data.resultsPublished ? new Date() : null,
      publishedAt: publishedLike ? new Date(t0 + 2 * hour) : null,
      submittedForApprovalAt: data.status === 'DRAFT' ? null : new Date(t0),
      approvedAt: approvedLike ? new Date(t0 + hour) : null,
      approvedById: approvedLike ? data.approverId : null,
      reviewNote: data.reviewNote ?? null,
      createdById,
      statusChanges: {
        create: steps.map((st) => ({
          action: st.action, fromStatus: st.from as never, toStatus: st.to as never, actorId: st.actor, reason: st.reason ?? null, createdAt: new Date(st.at),
        })),
      },
      questions: {
        create: data.questions.map((q, i) => ({
          type: q.type, text: q.text, marks: q.marks, explanation: q.explanation, order: i + 1,
          options: { create: (q.options ?? []).map(([text, isCorrect], j) => ({ text, isCorrect, order: j + 1 })) },
        })),
      },
    },
    include: { questions: { include: { options: true }, orderBy: { order: 'asc' } } },
  });
}

async function main() {
  console.info('Clearing existing data…');
  // TRUNCATE (not DELETE): audit logs are append-only and reject row deletes by design.
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog","Notification","Announcement","SystemSetting","ResultRevision","ExamStatusChange","Result","SubmittedAnswer","ExamAttempt","QuestionOption","Question","Exam","StudentProfile","FacultyProfile","User" CASCADE',
  );

  const [adminHash, facultyHash, studentHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORD.admin, 12), bcrypt.hash(DEMO_PASSWORD.faculty, 12), bcrypt.hash(DEMO_PASSWORD.student, 12),
  ]);

  const admin = await prisma.user.create({ data: { name: 'Avery Admin', email: 'admin@examflow.dev', passwordHash: adminHash, role: 'ADMIN' } });
  const faculty = await prisma.user.create({
    data: { name: 'Dr. Priya Sharma', email: 'faculty@examflow.dev', passwordHash: facultyHash, role: 'FACULTY',
      facultyProfile: { create: { employeeId: 'FAC-1001', department: 'Computer Science', designation: 'Associate Professor' } } },
  });
  const faculty2 = await prisma.user.create({
    data: { name: 'Prof. Daniel Okafor', email: 'faculty2@examflow.dev', passwordHash: facultyHash, role: 'FACULTY',
      facultyProfile: { create: { employeeId: 'FAC-1002', department: 'Mathematics', designation: 'Professor' } } },
  });

  const studentNames = ['Aarav Patel', 'Maya Chen', 'Liam Johnson', 'Sofia Garcia', 'Noah Williams', 'Zara Ahmed', 'Ethan Brown', 'Isla Murphy'];
  const students = [];
  for (const [i, name] of studentNames.entries()) {
    students.push(await prisma.user.create({
      data: {
        name, email: i === 0 ? 'student@examflow.dev' : `student${i + 1}@examflow.dev`, passwordHash: studentHash, role: 'STUDENT',
        createdAt: new Date(Date.now() - (20 - i * 2) * day),
        studentProfile: { create: { rollNumber: `CS-2024-${String(i + 1).padStart(3, '0')}`, department: 'Computer Science', year: 2 + (i % 3) } },
      },
    }));
  }
  await prisma.user.create({
    data: { name: 'Suspended Sam', email: 'suspended@examflow.dev', passwordHash: studentHash, role: 'STUDENT', status: 'SUSPENDED', studentProfile: { create: {} } },
  });

  const now = Date.now();
  await createExam(faculty.id, {
    title: 'JavaScript Fundamentals', subject: 'Web Development', description: 'Core language concepts: scoping, types, arrays and the event loop.',
    startsAt: new Date(now - hour), endsAt: new Date(now + 7 * day), durationMinutes: 30, passRatio: 0.4, status: 'PUBLISHED',
    questions: javascriptQuestions, negativeMarking: true, resultRelease: 'IMMEDIATE', maxAttempts: 2, approverId: admin.id,
  });
  await createExam(faculty.id, {
    title: 'Advanced React Patterns', subject: 'Web Development', description: 'Hooks, context, rendering behaviour and performance.',
    startsAt: new Date(now + 2 * day), endsAt: new Date(now + 3 * day), durationMinutes: 45, passRatio: 0.5, status: 'PUBLISHED',
    questions: javascriptQuestions.slice(0, 4), approverId: admin.id,
  });
  const dbExam = await createExam(faculty.id, {
    title: 'Database Systems Midterm', subject: 'Databases', description: 'Normalisation, transactions and SQL.',
    startsAt: new Date(now - 10 * day), endsAt: new Date(now - 9 * day), durationMinutes: 40, passRatio: 0.5, status: 'PUBLISHED',
    questions: dbQuestions, resultRelease: 'MANUAL', resultsPublished: true, approverId: admin.id,
  });
  const mathExam = await createExam(faculty.id, {
    title: 'Calculus Quiz 1', subject: 'Mathematics', description: 'Limits, derivatives and proofs.',
    startsAt: new Date(now - 5 * day), endsAt: new Date(now - 4 * day), durationMinutes: 30, passRatio: 0.5, status: 'PUBLISHED',
    // MANUAL release, not yet published: these results populate the admin verification queue.
    questions: mathQuestions, resultRelease: 'MANUAL', approverId: admin.id,
  });
  await createExam(faculty.id, {
    title: 'Operating Systems Final (Draft)', subject: 'Operating Systems', description: 'Processes, scheduling and memory management.',
    startsAt: new Date(now + 14 * day), endsAt: new Date(now + 15 * day), durationMinutes: 90, passRatio: 0.4, status: 'DRAFT',
    questions: dbQuestions.slice(0, 2),
  });
  await createExam(faculty.id, {
    title: 'Computer Networks Midterm', subject: 'Networking', description: 'OSI model, TCP/IP and routing basics.',
    startsAt: new Date(now + 5 * day), endsAt: new Date(now + 6 * day), durationMinutes: 45, passRatio: 0.5, status: 'PENDING_APPROVAL',
    questions: dbQuestions,
  });
  await createExam(faculty2.id, {
    title: 'Linear Algebra Quiz', subject: 'Mathematics', description: 'Matrices, determinants and eigenvalues.',
    startsAt: new Date(now + 3 * day), endsAt: new Date(now + 4 * day), durationMinutes: 30, passRatio: 0.5, status: 'PENDING_APPROVAL',
    questions: mathQuestions.slice(0, 2),
  });
  await createExam(faculty2.id, {
    title: 'Probability Basics', subject: 'Mathematics', description: 'Random variables and distributions.',
    startsAt: new Date(now + 8 * day), endsAt: new Date(now + 9 * day), durationMinutes: 30, passRatio: 0.5, status: 'REJECTED',
    questions: mathQuestions.slice(0, 1), approverId: admin.id, reviewNote: 'Please add at least five questions and an explanation for each answer.',
  });
  await createExam(faculty.id, {
    title: 'Data Structures Quiz', subject: 'Computer Science', description: 'Stacks, queues, trees and hash tables.',
    startsAt: new Date(now + 10 * day), endsAt: new Date(now + 11 * day), durationMinutes: 40, passRatio: 0.5, status: 'APPROVED',
    questions: dbQuestions.slice(0, 3), approverId: admin.id, reviewNote: 'Approved. Publish when ready.',
  });

  // Simulated past attempts, graded by the real grading engine.
  for (const [si, student] of students.entries()) {
    for (const exam of [dbExam, mathExam]) {
      const startedAt = new Date(exam.startsAt.getTime() + (si + 1) * 60_000);
      const attempt = await prisma.examAttempt.create({
        data: { examId: exam.id, studentId: student.id, attemptNumber: 1, startedAt, deadlineAt: new Date(startedAt.getTime() + exam.durationMinutes * 60_000) },
      });
      for (const [qi, q] of exam.questions.entries()) {
        if ((si + qi) % 5 === 4) continue; // leave some unanswered
        const skill = (si % 4) / 4; // vary performance per student
        const correct = q.options.filter((o) => o.isCorrect).map((o) => o.id);
        const wrong = q.options.filter((o) => !o.isCorrect).map((o) => o.id);
        const answerCorrectly = (qi * 7 + si * 3) % 10 >= skill * 6;
        await prisma.submittedAnswer.create({
          data: {
            attemptId: attempt.id, questionId: q.id,
            selectedOptionIds: q.type === 'DESCRIPTIVE' ? [] : answerCorrectly || !wrong.length ? correct : [wrong[0]!],
            textAnswer: q.type === 'DESCRIPTIVE' ? 'Assume √2 = p/q in lowest terms. Then p² = 2q², so p is even; write p = 2k, giving q² = 2k², so q is even too — contradicting lowest terms.' : null,
          },
        });
      }
      await finalizeAttempt(attempt.id, 'MANUAL', new Date(startedAt.getTime() + 20 * 60_000));
    }
  }

  // Grade the descriptive answers for half the students so both pending and graded results exist.
  const descriptive = mathExam.questions.find((q) => q.type === 'DESCRIPTIVE')!;
  const toGrade = await prisma.submittedAnswer.findMany({ where: { questionId: descriptive.id }, take: 4 });
  const { regradeAttempt } = await import('../src/services/attempts.js');
  for (const [i, a] of toGrade.entries()) {
    await prisma.submittedAnswer.update({
      where: { id: a.id },
      data: { marksAwarded: 3 + i, feedback: 'Clear argument. State the lowest-terms assumption explicitly.', gradedById: faculty.id, gradedAt: new Date() },
    });
    await regradeAttempt(a.attemptId);
  }

  // The exam whose results were published as a whole also has each result marked published.
  await prisma.result.updateMany({ where: { examId: dbExam.id, status: 'GRADED' }, data: { publishedAt: new Date(), publishedById: admin.id } });

  await prisma.systemSetting.createMany({
    data: [
      { key: 'requireExamApproval', value: true, updatedById: admin.id },
      { key: 'facultyCanPublishResults', value: false, updatedById: admin.id },
      { key: 'allowStudentRegistration', value: true, updatedById: admin.id },
      { key: 'institutionName', value: 'ExamFlow University', updatedById: admin.id },
    ],
  });
  await prisma.announcement.create({
    data: { title: 'Welcome to the new semester', message: 'Exam schedules for this term are now available on your dashboard.', audience: 'STUDENT', recipients: students.length, createdById: admin.id },
  });

  await prisma.notification.createMany({
    data: students.map((s) => ({
      userId: s.id, type: 'ANNOUNCEMENT' as const, title: 'Welcome to the new semester',
      message: 'Exam schedules for this term are now available on your dashboard.\n— Avery Admin',
    })),
  });

  console.info('\nSeed complete. Demo accounts (development only):');
  console.info(`  Admin    admin@examflow.dev     / ${DEMO_PASSWORD.admin}`);
  console.info(`  Faculty  faculty@examflow.dev   / ${DEMO_PASSWORD.faculty}`);
  console.info(`  Student  student@examflow.dev   / ${DEMO_PASSWORD.student}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

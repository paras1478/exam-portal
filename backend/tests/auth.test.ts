import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, client, createUser, prisma, PASSWORD, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('authentication', () => {
  it('registers a student, sets an HTTP-only session cookie and never returns the password hash', async () => {
    const api = await client();
    const res = await api.post('/api/auth/register', { name: 'New Student', email: 'New@Test.dev', password: 'Secret123' });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('new@test.dev');
    expect(res.body.data.role).toBe('STUDENT');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('ef_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await api.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.studentProfile).toBeTruthy();
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'new@test.dev' } });
    expect(stored.passwordHash).not.toContain('Secret123');
  });

  it('ignores a role supplied by the client during registration', async () => {
    const api = await client();
    const res = await api.post('/api/auth/register', { name: 'Sneaky', email: 'sneaky@test.dev', password: 'Secret123', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('STUDENT');
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const api = await client();
    await api.post('/api/auth/register', { name: 'One', email: 'dup@test.dev', password: 'Secret123' });
    const dup = await api.post('/api/auth/register', { name: 'Two', email: 'dup@test.dev', password: 'Secret123' });
    expect(dup.status).toBe(409);
    const weak = await api.post('/api/auth/register', { name: 'Weak', email: 'weak@test.dev', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with valid credentials and rejects invalid ones with a generic message', async () => {
    const user = await createUser('STUDENT');
    const api = await client();
    const bad = await api.post('/api/auth/login', { email: user.email, password: 'wrong-password1' });
    expect(bad.status).toBe(401);
    const unknown = await api.post('/api/auth/login', { email: 'nobody@test.dev', password: 'wrong-password1' });
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const good = await api.post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(good.status).toBe(200);
  });

  it('blocks suspended accounts at login and on existing sessions', async () => {
    const suspended = await createUser('STUDENT', { status: 'SUSPENDED' });
    const api = await client();
    const res = await api.post('/api/auth/login', { email: suspended.email, password: PASSWORD });
    expect(res.status).toBe(403);

    const active = await createUser('STUDENT');
    const session = await client(active.email);
    await prisma.user.update({ where: { id: active.id }, data: { status: 'SUSPENDED' } });
    expect((await session.get('/api/auth/me')).status).toBe(403);
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const user = await createUser('STUDENT');
    const noCsrf = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');

    const api = await client(user.email);
    const forged = await api.agent.post('/api/auth/logout').set('X-CSRF-Token', 'forged');
    expect(forged.status).toBe(403);
  });

  it('rejects requests from disallowed origins', async () => {
    const api = await client();
    const res = await api.agent.post('/api/auth/logout').set('Origin', 'https://evil.example').set('X-CSRF-Token', 'x');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('returns 401 for unauthenticated and tampered sessions', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const res = await request(app).get('/api/auth/me').set('Cookie', 'ef_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('changes the password only with the correct current password', async () => {
    const user = await createUser('FACULTY');
    const api = await client(user.email);
    expect((await api.post('/api/auth/me/password', { currentPassword: 'nope1234', newPassword: 'NewPass123' })).status).toBe(400);
    expect((await api.post('/api/auth/me/password', { currentPassword: PASSWORD, newPassword: 'NewPass123' })).status).toBe(200);
    const fresh = await client();
    expect((await fresh.post('/api/auth/login', { email: user.email, password: 'NewPass123' })).status).toBe(200);
  });
});

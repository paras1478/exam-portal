# ExamFlow — Online Examination & Result Management System

A full-stack platform for running timed online examinations, grading them automatically (with manual review of descriptive answers), and publishing results — with dedicated workspaces for **students**, **faculty** and **administrators**.

| Layer     | Stack |
|-----------|-------|
| Frontend  | React 18 · Vite 7 · TypeScript · Tailwind CSS 4 · shadcn-style Radix components · TanStack Query · Framer Motion · Recharts · Sonner · Lucide |
| Backend   | Node.js · Express 5 · TypeScript · Zod · JWT (HTTP-only cookie) · bcrypt · Nodemailer |
| Database  | PostgreSQL · Prisma ORM 6 |
| Tests     | Vitest · Supertest (against a real PostgreSQL test database) |

---

## Features

**Students** — register/sign in, dashboard (stats, live & upcoming exams, performance and subject charts, notifications), exam catalogue with tabs/search/filters, distraction-free exam interface, result history, printable result sheets, profile & password management.

**Faculty** — create/edit/schedule/publish/archive exams; MCQ, multiple-select, true/false and descriptive questions with reordering; duration, pass marks, negative marking, attempt limits, availability windows and result-release policy; student preview; submissions with analytics; manual grading of descriptive answers; publish results; CSV export; announcements.

**Administrators** — admin control panel with live statistics, pending approvals and results awaiting publication; user management (create, edit, roles, activate/deactivate/suspend, password reset, retention-aware deletion, CSV export); exam approval workflow (approve/reject with reason, publish, cancel, archive); result verification, publication and audited corrections; reports and CSV exports; system settings; announcements; append-only audit log.

**Role-based access control** — permission-based authorization on every endpoint (`authorizePermission('exam:approve')`), ownership checks against IDOR, session revocation on role/status/password changes, policy settings (approval requirement, faculty result publication, registration). See **[docs/ADMIN_RBAC.md](docs/ADMIN_RBAC.md)** for the full model and workflows.

**Exam integrity**
- Deadlines are computed and enforced **on the server** (`deadline = min(start + duration, window end)`); the browser timer is display-only.
- Answers autosave in batches; unsaved answers are queued in `localStorage` and replayed after a refresh, crash or network drop.
- Late writes are rejected (a small configurable grace period covers in-flight requests) and expired attempts are auto-submitted — lazily on access and by a background sweeper every 30 s.
- Submission is idempotent: a conditional `UPDATE … WHERE status = 'IN_PROGRESS'` inside a transaction guarantees exactly-once grading, with a unique `Result.attemptId` as a backstop. A partial unique index prevents two concurrent in-progress attempts.
- Questions and grading rules lock as soon as any student starts an exam.
- Correct answers never appear in student APIs before the configured release — and stay hidden while the student could still use them in another attempt during an open window.

---

## Project structure

```
exam-portal/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # User, profiles, Exam, ExamStatusChange, Question, Option, Attempt, Answer, Result,
│   │   │                          # ResultRevision, Notification, Announcement, AuditLog, SystemSetting
│   │   ├── migrations/            # SQL migrations (partial unique index, CHECK constraints, append-only audit triggers)
│   │   └── seed.ts                # development-only demo data
│   ├── src/
│   │   ├── config/env.ts          # Zod-validated environment
│   │   ├── lib/                   # prisma, http helpers, jwt, audit, mailer, notifications, csv, pagination
│   │   ├── middleware/            # authenticateUser, authorizeRoles, authorizePermission, validateRequest, CSRF, errorHandler
│   │   ├── schemas/               # shared Zod schemas
│   │   ├── services/              # permissions, settings, exam workflow (state machine), results (publish/correct),
│   │   │                          # grading engine, attempt lifecycle, exam rules, announcements, users
│   │   ├── routes/                # auth, student, exams (faculty), admin, notifications, docs
│   │   ├── scripts/create-admin.ts  # one-time first-admin bootstrap (+ --recover)
│   │   ├── app.ts                 # Express app factory
│   │   └── index.ts               # server + expired-attempt sweeper
│   └── tests/                     # auth, permissions, admin RBAC & workflows, timing, persistence, grading, idempotency
├── frontend/
│   └── src/
│       ├── components/ui/         # Button, Card, Dialog, Select, Tabs, Table, …
│       ├── components/common/     # PageHeader, StatCard, EmptyState, ErrorState, ConfirmDialog, Pagination, …
│       ├── components/layout/     # AppShell (sidebar, notifications, theme toggle), route guards
│       ├── components/{student,exam,faculty,admin}/
│       ├── context/               # Auth, Theme
│       ├── hooks/                 # useDebounce, useNow, useOnlineStatus, …
│       ├── lib/                   # typed API client (CSRF-aware), types, utils
│       └── pages/{public,student,exam,faculty,admin,shared}/
├── docs/API.md                    # REST reference
├── docs/ADMIN_RBAC.md             # roles, permissions, workflows, audit, retention, admin bootstrap
└── docker-compose.yml             # optional local PostgreSQL
```

---

## Local setup

### Prerequisites
- Node.js **20+** (tested on 22)
- PostgreSQL **14+** (local install, or `docker compose up -d db`)

### 1. Database
Create two databases — one for development, one for tests:

```bash
# with a local PostgreSQL
createdb exam_portal
createdb exam_portal_test

# or with Docker (creates both)
docker compose up -d db
```

### 2. Backend
```bash
cd backend
npm install
cp .env.example .env            # then edit DATABASE_URL and JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # paste into JWT_SECRET
npx prisma migrate deploy       # apply migrations (use `npm run db:migrate` when changing the schema)
npm run db:seed                 # optional: demo data (refuses to run when NODE_ENV=production)
npm run dev                     # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env            # VITE_API_URL=/api (default)
npm run dev                     # http://localhost:5173 — proxies /api to the backend
```

### Demo accounts (created by the seed, development only)
| Role    | Email                  | Password        |
|---------|------------------------|-----------------|
| Admin   | admin@examflow.dev     | `Admin@12345`   |
| Faculty | faculty@examflow.dev   | `Faculty@12345` |
| Student | student@examflow.dev   | `Student@12345` |

The seed includes exams in every workflow state (draft, two pending approval, approved, rejected, published live/upcoming/ended), graded, pending-review and awaiting-publication results, system settings, an announcement and a suspended account. Approval is required by default and faculty cannot publish results until an admin enables it in **Admin → Settings**.

---

## Creating the first administrator (production)

Never run the seed in production. Create the first admin with the one-time bootstrap command; the password is read from a hidden prompt (or `INITIAL_ADMIN_PASSWORD` for automation), bcrypt-hashed and never logged:

```bash
cd backend
npm run create-admin -- --email admin@your-school.edu --name "Jane Admin"
# non-interactive: INITIAL_ADMIN_EMAIL=… INITIAL_ADMIN_NAME=… INITIAL_ADMIN_PASSWORD=… npm run create-admin
```

- The command **refuses to run once any administrator exists**, so it cannot be reused to mint extra admins. Further faculty accounts are created in **Admin → Users**; admin rights are granted there by changing an existing user's role (authenticated, authorised, audited, and the user's sessions are revoked).
- Locked out of every admin account? `npm run create-admin -- --recover --email existing-admin@your-school.edu` resets that admin's password and revokes its sessions (audited as `ADMIN_RECOVERED`).
- Public registration only ever creates student accounts and can be closed in **Admin → Settings**.

---

## Environment variables

**Backend** (`backend/.env`, validated at startup — the server refuses to boot with invalid values):

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` · `test` · `production` |
| `PORT` | API port (default 4000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | ≥ 32 random characters; the example value is rejected in production |
| `JWT_EXPIRES_IN_HOURS` | Session length (default 8) |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (also used for the CSRF origin check) |
| `APP_URL` | Public frontend URL used in email links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email delivery. Leave `SMTP_HOST` empty to log emails to the console instead |
| `SUBMISSION_GRACE_SECONDS` | Tolerance for in-flight autosaves after the deadline (default 10) |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (for client IPs in rate limiting/audit) |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_PASSWORD` | Optional input for the one-time `create-admin` bootstrap; remove after use |

Runtime policy (approval requirement, faculty result publication, registration, institution name) lives in the database as **system settings**, editable in **Admin → Settings**.

**Frontend** (`frontend/.env`): `VITE_API_URL` — API base path, `/api` when served same-origin.

### Email
Emails are sent for registration/account creation, newly published exams and published results. Configure any SMTP provider (SES, SendGrid, Mailgun, Postmark, Gmail app password…):

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=<your key>
MAIL_FROM="ExamFlow <no-reply@your-school.edu>"
```
Mail failures are logged and never break the request that triggered them.

---

## Testing

```bash
cd backend
cp .env .env.test   # then point DATABASE_URL at exam_portal_test and set NODE_ENV=test
DATABASE_URL=<test url> npx prisma migrate deploy
npm test
```

The test runner refuses to start unless `DATABASE_URL` in `.env.test` names a database containing "test", and it truncates tables between tests. Suites:

| File | Covers |
|------|--------|
| `tests/auth.test.ts` | registration, login, generic errors, HTTP-only cookie, CSRF & origin checks, suspended accounts, password change, client-supplied role ignored |
| `tests/permissions.test.ts` | role isolation, faculty ownership, cross-student attempt access, drafts hidden, last-admin protection, session revocation on role change |
| `tests/admin-rbac.test.ts` | the admin/RBAC acceptance criteria: unauthenticated 401s, student/faculty 403s, no self-escalation or mass assignment, approval workflow end-to-end, invalid and concurrent transitions, policy toggles, result hiding/publication/republication, corrections with revisions, cross-user isolation, deactivation and password-change session revocation, retention-aware deletion, audit records (append-only, no secrets), live dashboard counts, settings validation |
| `tests/attempts.test.ts` | server deadlines, window enforcement, resume, concurrent starts, late-save rejection, grace period, sweeper, attempt limits, answer persistence, no answer leakage, idempotent/concurrent submission, descriptive review, release rules, exam locking, publish validation |
| `tests/grading.test.ts` | grading engine: single/multi select, negative marking, unanswered, clamping, pass/fail |

Type checks: `npm run typecheck` (backend) and `npm run typecheck` (frontend).

---

## Production deployment

1. **Database** — provision PostgreSQL, then run `npx prisma migrate deploy` from `backend/` as part of each release.
2. **Backend** —
   ```bash
   cd backend && npm ci && npx prisma generate && npm run build
   NODE_ENV=production node dist/index.js
   ```
   Run it under a process manager (systemd, PM2) or in a container. Set `NODE_ENV=production`, a strong `JWT_SECRET`, `CORS_ORIGINS`, `APP_URL`, SMTP settings and `TRUST_PROXY=1` behind a proxy. In production cookies are `Secure` and `SameSite=Strict`, so the site **must** be served over HTTPS.
3. **Frontend** — `cd frontend && npm ci && npm run build`, then serve `frontend/dist` as static files.
4. **Same-origin routing (recommended)** — serve the SPA and proxy `/api` on one domain, which keeps cookies first-party and lets the SPA read the CSRF cookie. Example nginx:

   ```nginx
   server {
     listen 443 ssl http2;
     server_name exams.your-school.edu;
     root /srv/examflow/frontend/dist;

     location /api/ {
       proxy_pass http://127.0.0.1:4000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
     location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
     location / { try_files $uri /index.html; }
   }
   ```
5. **Scaling note** — the expired-attempt sweeper runs inside each API process; it is safe to run on multiple instances because finalisation is idempotent.

---

## Security summary

- bcrypt (cost 12) password hashing; constant-time-ish login (dummy hash for unknown emails) and generic error messages.
- JWT in an HTTP-only cookie (`Secure` + `SameSite=Strict` in production); the user, role and status are re-loaded from the database on every request, so suspensions and role changes apply immediately.
- CSRF: double-submit token (`ef_csrf` cookie ↔ `X-CSRF-Token` header, constant-time compare) plus an Origin allow-list for all state-changing requests.
- Rate limiting on login and registration; Helmet security headers; strict CORS with credentials.
- Zod validation for every body, query and route parameter; centralized error handler that never leaks stack traces.
- Server-side RBAC on every route, ownership checks for faculty, 404s (not 403s) for other users' attempts to prevent ID probing.
- Never trusts client-provided roles, marks, deadlines or submission state.
- Permission-based RBAC with ownership checks; denials are audited.
- `tokenVersion` session revocation on deactivation, role change, password change/reset and deletion.
- Append-only audit log (database trigger) for logins, failed logins, denials, account/role/status changes, password resets, settings, every exam transition, grading, result publication/correction and exports; credentials are scrubbed from metadata.
- CSV exports neutralise spreadsheet formula injection.

See [docs/API.md](docs/API.md) for the REST API reference (a machine-readable catalogue is served at `GET /api/docs`) and [docs/ADMIN_RBAC.md](docs/ADMIN_RBAC.md) for roles, permissions and workflows.

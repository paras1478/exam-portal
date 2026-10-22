# Admin Control Panel & Role-Based Access Control

This document describes how authorization works in ExamFlow, the examination and result workflows, and how administrators operate the system.

---

## 1. Roles

| Role | Workspace | Summary |
|------|-----------|---------|
| **ADMIN** | `/admin` | Manages accounts and roles, reviews and approves exams, cancels/archives exams, verifies, corrects and publishes results, manages settings and announcements, reads audit logs and reports. |
| **FACULTY** | `/faculty` | Creates and edits **their own** exams, submits them for approval, publishes approved exams, grades descriptive answers, views submissions of their own exams, exports their results, announces to students. Publishes results only when the policy allows it. |
| **STUDENT** | `/student` | Takes published exams inside their availability window, views their own history and results after release. |

Public registration always creates a **STUDENT**. There is no way to self-register as faculty or admin, and a role sent by the client is ignored.

## 2. Permissions

Permissions are defined in code (`backend/src/services/permissions.ts`) so they are versioned, reviewable and tested. Two of them are additionally switched by system settings.

| Permission | Admin | Faculty | Student |
|------------|:-----:|:-------:|:-------:|
| `admin:access`, `user:read`, `user:manage`, `user:delete`, `role:assign` | ✔ | | |
| `settings:read`, `settings:manage`, `audit:read`, `report:view` | ✔ | | |
| `report:export` | ✔ | ✔ (own exams) | |
| `announcement:send_all` | ✔ | | |
| `announcement:send_students` | ✔ | ✔ | |
| `exam:create`, `exam:submit`, `exam:publish`, `exam:archive` | ✔ | ✔ (own exams) | |
| `exam:manage_own` | | ✔ | |
| `exam:manage_any`, `exam:approve`, `exam:cancel` | ✔ | | |
| `attempt:grade` | ✔ | ✔ (own exams) | |
| `result:read_own_exams` | | ✔ | |
| `result:read_all`, `result:correct` | ✔ | | |
| `result:publish` | ✔ | only if **facultyCanPublishResults** | |
| `exam:take`, `result:read_self` | | | ✔ |

### Middleware

| Middleware | Purpose |
|------------|---------|
| `authenticateUser` | Verifies the HTTP-only session cookie, loads the user from the database, rejects deleted/disabled accounts and tokens whose `tokenVersion` no longer matches. |
| `authorizeRoles(...roles)` | Coarse role gate for a router (e.g. all of `/api/admin`). |
| `authorizePermission(...perms)` | Requires every listed permission, evaluated against the role **and the current policy settings**. |
| `assertPermission(req, perm)` | Same check inside a handler, for decisions that depend on the resource. |
| `validateRequest({ params, query, body })` | Zod validation; unknown body fields are stripped (or rejected on `.strict()` schemas) to prevent mass assignment. |
| `errorHandler` | Consistent `{ success: false, error: { code, message, details? } }` responses without stack traces. |

Status codes: **401** missing/invalid/revoked session · **403** authenticated but not permitted · **404** resource does not exist *or* belongs to someone else (other faculty's exams, other students' attempts — existence is not disclosed).

Every denial (`403`) is written to the audit log with outcome `DENIED`.

### Ownership (IDOR protection)

- Faculty can only load, edit, grade or export exams where `createdById` is their id; anything else returns 404.
- Students can only read their own attempts and results.
- Admin endpoints are additionally gated by explicit permissions, not just the role.

### Sessions

Each user row has a `tokenVersion` embedded in the JWT. It is incremented on **deactivation/suspension, role change, admin password reset, account deletion and password change**, which immediately invalidates every outstanding session. (Changing your own password re-issues a cookie for the current browser.)

---

## 3. Examination workflow

```
DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──publish──▶ PUBLISHED ──(window ends)──▶ archive ──▶ ARCHIVED
  ▲  ▲                 │   └──reject (reason)──▶ REJECTED ──edit & resubmit──┘                       │
  │  └─────withdraw────┴──────────────────────── APPROVED                                            │
  └───────────────────────────── unpublish (only without attempts) ──────────────────────────────────┘
cancel (reason required): PENDING_APPROVAL | APPROVED | PUBLISHED → CANCELLED
restore: ARCHIVED → previous status (PUBLISHED / CANCELLED, otherwise DRAFT)
```

- All transitions go through `services/examWorkflow.ts`. Each one checks the actor's permission and ownership, the current status, readiness (questions present, answer keys set, pass marks ≤ total, window not ended) and action-specific rules.
- Transitions are applied with a conditional update (`WHERE status = <expected>`) in a transaction, so concurrent or repeated requests cannot apply twice (`409 STALE_STATE` / `INVALID_TRANSITION`).
- Every transition is stored in `ExamStatusChange` (immutable, enforced by a database trigger) with the actor and reason, and audited.
- **Editing rules:** drafts and rejected exams are fully editable. Approved or published exams are frozen apart from title, description, instructions and *extending* the window — content changes require withdrawing back to draft, which requires re-approval. Exams under review, cancelled or archived cannot be edited.
- **Cancelling** a published exam closes all running attempts immediately; its results are never released.
- With **requireExamApproval = false**, faculty publish drafts directly (the submit step is disabled).

## 4. Result workflow

1. Objective questions are graded on the server at submission.
2. Faculty grade descriptive answers (marks are validated against the question maximum).
3. A result is **visible to the student** only when it is fully graded and released — individually published, published for the whole exam, or automatically released by the exam's setting (`IMMEDIATE`, or `AFTER_END` once the window closes). Cancelled exams never release results. Correct answers additionally stay hidden while the student still has attempts left in an open window.
4. Administrators verify and publish results one by one (`PATCH /api/admin/results/:id/publish`) or per exam. Publishing twice is rejected (`ALREADY_PUBLISHED` / `NOTHING_TO_PUBLISH`).
5. **Corrections** — any change to a result the student can already see, and any change to an objective answer, is a correction: it requires `result:correct` (admins) and a reason. The previous and new marks are stored in `ResultRevision`, the change is audited, and the student is notified.

## 5. System settings

| Key | Default | Effect |
|-----|---------|--------|
| `requireExamApproval` | `true` | Faculty must submit exams for admin approval before publishing. |
| `facultyCanPublishResults` | `false` | Grants faculty `result:publish` for their own exams. |
| `allowStudentRegistration` | `true` | Enables public student self-registration. |
| `institutionName` | `ExamFlow` | Shown on public pages. |
| `supportEmail` | empty | Shown when registration is closed. |

Settings are validated with Zod; unknown keys are rejected. Changes are audited with before/after values.

## 6. Audit log

`AuditLog` records actor (id plus email/role snapshots), action, outcome (`SUCCESS` · `FAILURE` · `DENIED`), target entity, IP address, timestamp and non-sensitive metadata. Keys that look like credentials (`password`, `token`, `secret`, `hash`, …) are stripped before writing. A database trigger makes the table **append-only** (UPDATE/DELETE are rejected, except the automatic nulling of `actorId` if a user row is ever hard-deleted).

Recorded actions include: logins (success, failure, blocked), access denials, account creation/update/status/role/password reset/deletion, settings changes, every exam transition and settings change, exam creation/deletion, grading, result publication and correction, exports, announcements and admin bootstrap/recovery.

## 7. Account deletion and retention

`DELETE /api/admin/users/:id`:
- Accounts **with history** (attempts, authored exams, gradings or audit activity) are **soft-deleted**: marked `deletedAt`, deactivated, sessions revoked, hidden from lists, unable to sign in. Academic records stay intact.
- Accounts **without any history** are deleted permanently.
- You cannot delete, demote or deactivate yourself, and the last active administrator is protected.

## 8. Creating the first administrator

```bash
cd backend
npm run create-admin -- --email admin@your-school.edu --name "Jane Admin"   # password via hidden prompt
# or non-interactively:
INITIAL_ADMIN_EMAIL=admin@your-school.edu INITIAL_ADMIN_NAME="Jane Admin" INITIAL_ADMIN_PASSWORD='…' npm run create-admin
```

- The password is bcrypt-hashed (cost 12) and never logged.
- **One-time:** the command refuses to run once any administrator exists (checked inside a serializable transaction). Further admins are created in the admin panel by promoting an existing account — an authenticated, authorised and audited action.
- **Locked out?** `npm run create-admin -- --recover --email existing-admin@your-school.edu` resets that admin's password, re-activates the account and revokes its sessions (audited as `ADMIN_RECOVERED`). It requires shell access to the server and an existing admin email.
- Remove `INITIAL_ADMIN_*` values from the environment after bootstrapping.

## 9. Admin panel pages

| Page | What you can do |
|------|-----------------|
| Dashboard | Live counts, pending approvals, results awaiting publication, activity charts, recent audit events |
| Users | Search/filter/sort/paginate; create student/faculty; edit; change role; activate/deactivate/suspend; reset password; delete; export CSV |
| Exam Approvals | Status tabs with counts; review an exam (settings, questions and answer key, history); approve/reject/publish/cancel/archive/restore |
| Results | Verification queue; per-result and per-exam publication; result detail with corrections and revision history; printable sheet |
| Reports | Result report by date range/subject; CSV exports (results, exam summary, exams, users, audit logs) |
| Announcements | Compose to everyone/students/faculty; history |
| Audit Logs | Search and filter by action/outcome/date; export |
| Settings | Approval and publication policy, registration, institution details |

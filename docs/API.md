# ExamFlow REST API

Base path: `/api`. A machine-readable endpoint list is available at `GET /api/docs`.

## Conventions

| Topic | Convention |
|-------|------------|
| Success | `{ "success": true, "data": …, "meta"?: { page, pageSize, total, totalPages } }` |
| Error | `{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details"?: { fieldErrors?, problems? } } }` |
| Auth | HTTP-only session cookie `ef_session`, set by login/register |
| CSRF | Every `POST/PUT/PATCH/DELETE` must send header `X-CSRF-Token` equal to the `ef_csrf` cookie (issued by `GET /auth/csrf`, login, register and logout). Requests from origins outside `CORS_ORIGINS` are rejected |
| Pagination | `?page=1&pageSize=10` (max 100) |
| IDs | UUIDs; invalid IDs return `400`, unknown or inaccessible ones `404` |

Status codes: `200` OK · `201` created · `400` validation · `401` not signed in · `403` forbidden / CSRF / disabled account · `404` not found · `409` business-rule conflict · `413` body too large · `429` rate limited · `500` unexpected.

Common `409` codes: `EMAIL_TAKEN`, `DUPLICATE`, `EXAM_NOT_STARTED`, `EXAM_ENDED`, `EXAM_CANCELLED`, `ATTEMPT_LIMIT`, `ATTEMPT_CLOSED`, `TIME_UP`, `EXAM_LOCKED`, `INVALID_TRANSITION`, `STALE_STATE`, `APPROVAL_NOT_REQUIRED`, `ALREADY_PUBLISHED`, `NOTHING_TO_PUBLISH`, `NOT_GRADED`, `LAST_ADMIN`, `USER_DELETED`. `400 NOT_READY` carries `details.problems`.

Authorization is permission-based — see [ADMIN_RBAC.md](ADMIN_RBAC.md). `401` means no/invalid/revoked session, `403` means not permitted, `404` hides resources that don't exist or belong to someone else.

---

## Auth & profile

| Method | Path | Access | Body / query |
|--------|------|--------|--------------|
| GET | `/auth/csrf` | public | — |
| POST | `/auth/register` | public (rate limited) | `{ name, email, password, rollNumber?, department?, year? }` → always a STUDENT; `403` when registration is closed |
| POST | `/auth/login` | public (rate limited) | `{ email, password }` |
| POST | `/auth/logout` | public | — |
| GET | `/auth/public-settings` | public | `{ institutionName, allowStudentRegistration, supportEmail }` |
| GET | `/auth/me` | signed in | user + `permissions[]` + `policy` |
| PATCH | `/auth/me` | signed in | `{ name?, student?: { department, year, phone }, faculty?: { department, designation, phone } }` |
| POST | `/auth/me/password` | signed in | `{ currentPassword, newPassword }` |

Passwords: 8–128 characters with at least one letter and one digit.

## Student (`STUDENT`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/student/dashboard` | stats, live/upcoming exams, performance, subject averages, recent results, notifications |
| GET | `/student/exams` | `tab=all|upcoming|active|completed`, `search`, `subject`, `sort=startsAt|-startsAt|title`, pagination |
| GET | `/student/subjects` | distinct subjects of published exams |
| GET | `/student/exams/:id` | details + own attempts; no questions |
| POST | `/student/exams/:id/attempts` | start (`201`) or resume the in-progress attempt (`200`) → `{ attemptId, resumed, deadlineAt }` |
| GET | `/student/attempts/:id` | `{ attempt, exam, serverNow, questions, answers }` — options never include `isCorrect`; expired attempts are finalised first |
| PUT | `/student/attempts/:id/answers` | `{ answers: [{ questionId, selectedOptionIds?, textAnswer?, markedForReview? }] }` (1–200). Omitted fields are left unchanged; sending only `questionId` records a visit |
| POST | `/student/attempts/:id/submit` | idempotent → `{ receipt, alreadySubmitted }` |
| GET | `/student/results` | history; scores are `null` until released |
| GET | `/student/results/:attemptId` | result sheet; `result` is `null` until released; `isCorrect`/`explanation` only when `answersRevealed` |

### Timing rules
- `deadlineAt = min(startedAt + durationMinutes, exam.endsAt)`, fixed at creation.
- Saves after `deadlineAt + SUBMISSION_GRACE_SECONDS` fail with `409 TIME_UP` and the attempt is auto-submitted.
- Submissions after `deadlineAt` are recorded as `AUTO_TIMEOUT`; `submittedAt` is capped at the deadline for automatic closures.

### Result release
A result is visible when it is fully graded **and** one of: results were published by faculty; release is `IMMEDIATE`; release is `AFTER_END` and the window has closed. Correct answers are additionally withheld while the window is open and the student has attempts left.

## Faculty & admin exam management (`FACULTY`, `ADMIN`)

Faculty only see and manage their own exams; admins manage all exams.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/faculty/dashboard` | stats, live/scheduled exams, recent submissions, per-exam performance |
| GET | `/exams` | `search`, `status`, `phase=SCHEDULED|LIVE|ENDED`, `sort`, pagination |
| POST | `/exams` | create draft: `{ title, subject, description?, instructions?, durationMinutes, passMarks, negativeMarking, negativeMarkRatio, maxAttempts, startsAt, endsAt, resultRelease }` |
| GET | `/exams/:id` | full exam with answer key, `phase`, `attemptCount`, `editLevel`, `editableFields`, `allowedActions`, `statusChanges`, `approvedBy`, `reviewNote` |
| PATCH | `/exams/:id` | partial update within `editableFields` (FULL for drafts/rejected; approved/attempted exams accept only title, description, instructions and an extended `endsAt`). Important setting changes are audited with before/after |
| DELETE | `/exams/:id` | only DRAFT/REJECTED without attempts |
| POST | `/exams/:id/submit` | DRAFT/REJECTED → PENDING_APPROVAL (validates readiness; `409 APPROVAL_NOT_REQUIRED` when approval is off) |
| POST | `/exams/:id/withdraw` | PENDING_APPROVAL/APPROVED → DRAFT |
| POST | `/exams/:id/publish` | APPROVED → PUBLISHED (or DRAFT → PUBLISHED when approval is off); notifies and emails students |
| POST | `/exams/:id/unpublish` | PUBLISHED → DRAFT, only without attempts (re-approval needed) |
| POST | `/exams/:id/archive` · `/restore` | archive drafts, rejected, cancelled or completed exams / bring back |
| POST | `/exams/:id/questions` | `{ type, text, marks, explanation?, options: [{ text, isCorrect }] }` |
| PUT | `/exams/:id/questions/:questionId` | same body |
| DELETE | `/exams/:id/questions/:questionId` | renumbers remaining questions |
| PUT | `/exams/:id/questions-order` | `{ questionIds: [...] }` — must list every question once |
| GET | `/exams/:id/attempts` | `search`, `status=IN_PROGRESS|SUBMITTED|PENDING_REVIEW|GRADED`, pagination |
| GET | `/exams/:id/stats` | participants, averages, pass rate, distribution, per-question correctness |
| POST | `/exams/:id/results/publish` | needs `result:publish` (admins; faculty only if `facultyCanPublishResults`); publishes graded, unpublished results; `409 NOTHING_TO_PUBLISH` on repeat |
| GET | `/exams/:id/results/export` | CSV download |
| GET | `/exams/attempts/:attemptId` | full attempt review with answer key |
| PUT | `/exams/attempts/:attemptId/answers/:questionId/grade` | `{ marks, feedback?, reason? }` for answered descriptive questions. If the result is already visible to the student it is a correction: requires `result:correct` and `reason` |

Question rules: MCQ — ≥2 options, exactly one correct; MULTI_SELECT — ≥2 options, ≥1 correct (exact match required, no partial credit); TRUE_FALSE — exactly two options, one correct; DESCRIPTIVE — no options, graded manually. All question changes keep `exam.totalMarks` in sync. Structural changes return `409 EXAM_LOCKED` once any attempt exists.

### Grading
Correct objective answer: full marks. Wrong: `−marks × negativeMarkRatio` when negative marking is enabled, else 0. Unanswered: 0. Total = max(0, objective + descriptive). Pass/fail is decided once no answer is pending review (`totalScore ≥ passMarks`).

## Admin (`ADMIN` role + per-route permission)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/dashboard/stats` | live counts incl. `pendingApprovals`, `awaitingPublication`; series; exam status; pending approval list; recent activity |
| GET | `/admin/users` | `search`, `role`, `status`, `includeDeleted`, `sort`, pagination |
| POST | `/admin/users` | `{ name, email, password, role: STUDENT|FACULTY, student?, faculty? }` |
| GET | `/admin/users/:id` | details, counts, recent activity |
| PATCH | `/admin/users/:id` | `{ name?, email?, student?, faculty? }` — strict: other keys → 400 |
| PATCH | `/admin/users/:id/status` | `{ status, reason? }` — leaving ACTIVE revokes sessions |
| PATCH | `/admin/users/:id/role` | `{ role, reason? }` — revokes sessions |
| POST | `/admin/users/:id/reset-password` | `{ newPassword }` — revokes sessions |
| DELETE | `/admin/users/:id` | `{ reason? }` → `{ mode: HARD | SOFT }` (soft when the account has records) |
| GET | `/admin/exams` | `search`, `status`, `phase`, `createdById`, `sort`, pagination; `meta.statusCounts` |
| GET | `/admin/exams/:id` | exam detail (as `/exams/:id`) |
| PATCH | `/admin/exams/:id/approve` | `{ reason? }` (approval note) |
| PATCH | `/admin/exams/:id/reject` | `{ reason }` required |
| PATCH | `/admin/exams/:id/publish` | approved → published |
| PATCH | `/admin/exams/:id/cancel` | `{ reason }` required; closes running attempts |
| PATCH | `/admin/exams/:id/archive` · `/restore` | |
| PATCH | `/admin/exams/:id/results/publish` | publish all graded results of the exam |
| GET | `/admin/results` | `search`, `examId`, `status`, `publication=awaiting|released`, pagination |
| GET | `/admin/results/:id` | answers, answer key, revisions, publication info |
| PATCH | `/admin/results/:id/publish` | verify & publish one result (`409 ALREADY_PUBLISHED`, `NOT_GRADED`) |
| PATCH | `/admin/results/:id/correct` | `{ questionId, marks, reason, feedback? }` — recorded in `ResultRevision` |
| GET | `/admin/reports/results` | `from`, `to`, `subject`, `examId` → per-exam rows, subject summary, totals |
| GET | `/admin/reports/export` | CSV: `type=results|exam-summary|exams|users|audit-logs` + filters |
| GET | `/admin/audit-logs` | `search`, `action`, `outcome`, `entityType`, `from`, `to`, pagination |
| GET | `/admin/settings` | settings + last-updated metadata |
| PATCH | `/admin/settings` | partial `{ requireExamApproval, facultyCanPublishResults, allowStudentRegistration, institutionName, supportEmail }`; unknown keys → 400 |
| POST | `/admin/announcements` | `{ title, message, audience: ALL|STUDENT|FACULTY }` |
| GET | `/admin/announcements` | `search`, `audience`, pagination |

Admins cannot change their own role/status or delete themselves, and the last active admin is protected. `/admin/users/export` remains as an alias of `reports/export?type=users`.

## Notifications (signed in)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/notifications` | `unreadOnly=true`, pagination; `meta.unreadCount` |
| GET | `/notifications/unread-count` | — |
| PATCH | `/notifications/:id/read` | — |
| POST | `/notifications/read-all` | — |
| DELETE | `/notifications/:id` | — |
| POST | `/notifications/announcements` | `FACULTY` (audience `STUDENT` only) or `ADMIN` (`ALL|STUDENT|FACULTY`): `{ title, message, audience }` |
| GET | `/notifications/announcements/mine` | own announcement history |

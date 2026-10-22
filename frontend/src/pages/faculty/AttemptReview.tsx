import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Clock, Eye, EyeOff, Flag, History, Lock, Mail, MinusCircle, PenLine, Save, ShieldAlert, XCircle } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AttemptReview as Review, ResultRevision } from '@/lib/types';
import { cn, formatDateTime, formatDuration, formatPercent, formatRelative, formatScore, initials, questionTypeLabel } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Progress, Skeleton, Textarea } from '@/components/ui/primitives';
import { ErrorState, PageHeader, ResultBadge } from '@/components/common';

type ReviewQuestion = Review['questions'][number];

export default function AttemptReview() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attempt-review', attemptId],
    queryFn: () => api.get<Review>(`/exams/attempts/${attemptId}`),
  });
  useDocumentTitle(data ? `Review · ${data.student.name}` : 'Review attempt');

  if (error) {
    return (
      <div>
        <PageHeader title="Review attempt" back={{ to: '/faculty/exams', label: 'All exams' }} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40 lg:col-span-2" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const r = data.result;
  const cancelled = data.exam.status === 'CANCELLED';
  const toGrade = data.questions.filter((q) => q.type === 'DESCRIPTIVE' && q.answer?.textAnswer?.trim() && !q.answer.gradedAt);
  const timeTaken = data.submittedAt ? (new Date(data.submittedAt).getTime() - new Date(data.startedAt).getTime()) / 1000 : null;
  const questionOrder = new Map(data.questions.map((q) => [q.id, q.order]));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: `/faculty/exams/${data.exam.id}/submissions`, label: 'Submissions' }}
        title={data.exam.title}
        description={`Attempt #${data.attemptNumber} · ${data.exam.subject}`}
        actions={
          toGrade.length > 0 &&
          !data.released &&
          !cancelled && (
            <Button
              variant="outline"
              onClick={() => document.getElementById(`q-${toGrade[0]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              <PenLine /> Next to grade ({toGrade.length})
            </Button>
          )
        }
      />

      {cancelled && (
        <div role="status" className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>This exam was cancelled. Its results cannot be changed or released.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-4 p-5">
            <Avatar className="h-12 w-12"><AvatarFallback>{initials(data.student.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 space-y-1 text-sm">
              <p className="text-base font-semibold">{data.student.name}</p>
              <p className="flex items-center gap-1.5 truncate text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {data.student.email}</p>
              {data.student.studentProfile?.rollNumber && <p className="text-muted-foreground">Roll no. {data.student.studentProfile.rollNumber}</p>}
              {data.student.studentProfile?.department && <p className="text-muted-foreground">{data.student.studentProfile.department}</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="grid gap-5 p-5 sm:grid-cols-2">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Started</dt><dd>{formatDateTime(data.startedAt)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Submitted</dt><dd>{data.submittedAt ? formatDateTime(data.submittedAt) : 'In progress'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Time taken</dt><dd className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{timeTaken === null ? '—' : formatDuration(timeTaken)}</dd></div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Submission</dt>
                <dd>{data.submissionType === 'AUTO_TIMEOUT' ? <Badge variant="warning">Auto-submitted at time-out</Badge> : data.submissionType === 'MANUAL' ? <Badge variant="muted">Submitted by student</Badge> : <Badge>In progress</Badge>}</dd>
              </div>
              {r && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Visibility</dt>
                  <dd className="text-right">
                    {data.released ? (
                      <Badge variant="success"><Eye className="h-3 w-3" /> Visible to student</Badge>
                    ) : (
                      <Badge variant="muted"><EyeOff className="h-3 w-3" /> Not released</Badge>
                    )}
                    {r.publishedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Published {formatDateTime(r.publishedAt)}{r.publishedBy ? ` by ${r.publishedBy.name}` : ''}
                      </p>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {r ? (
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Score</p>
                    <p className="text-3xl font-semibold tabular-nums">
                      {formatScore(r.totalScore)}<span className="text-base text-muted-foreground"> / {formatScore(r.maxScore)}</span>
                    </p>
                  </div>
                  <ResultBadge status={r.status} passed={r.passed} />
                </div>
                <Progress value={r.percentage} aria-label={`Score ${formatPercent(r.percentage)}`} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatPercent(r.percentage)}</span>
                  <span className="text-success">{r.correctCount} correct</span>
                  <span className="text-destructive">{r.incorrectCount} wrong</span>
                  <span>{r.unansweredCount} unanswered</span>
                  {r.pendingReviewCount > 0 && <span className="text-warning">{r.pendingReviewCount} to grade</span>}
                  <span>Pass at {formatScore(data.exam.passMarks)}</span>
                </div>
              </div>
            ) : (
              <p className="self-center text-sm text-muted-foreground">The student is still taking this exam. Results appear after submission.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {data.released && !cancelled && (
        <div role="status" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">This result is already visible to the student.</span>{' '}
            <span className="text-muted-foreground">Any change is a recorded correction that requires a reason, and the student is notified.</span>
          </p>
        </div>
      )}

      <div className="space-y-4">
        {data.questions.map((q) => (
          <QuestionReview
            key={q.id}
            q={q}
            attemptId={data.id}
            gradable={data.status === 'SUBMITTED' && !cancelled}
            released={data.released}
            negative={data.exam.negativeMarking}
          />
        ))}
      </div>

      {r && r.revisions.length > 0 && <RevisionHistory revisions={r.revisions} questionOrder={questionOrder} />}
    </div>
  );
}

function RevisionHistory({ revisions, questionOrder }: { revisions: ResultRevision[]; questionOrder: Map<string, number> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Grading &amp; correction history</CardTitle>
        <CardDescription>Every manual mark change is recorded permanently.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {revisions.map((rev) => (
            <li key={rev.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={rev.kind === 'CORRECTION' ? 'warning' : 'default'}>{rev.kind === 'CORRECTION' ? 'Correction' : 'Graded'}</Badge>
                {rev.questionId && <span className="font-medium">Question {questionOrder.get(rev.questionId) ?? '?'}</span>}
                <span className="tabular-nums text-muted-foreground">
                  {formatScore(rev.previousMarks)} → <span className="font-semibold text-foreground">{formatScore(rev.newMarks)}</span> marks · total{' '}
                  {formatScore(rev.previousTotalScore)} → {formatScore(rev.newTotalScore)}
                </span>
              </div>
              {rev.reason && <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2">{rev.reason}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {rev.actor ? `${rev.actor.name} (${rev.actor.role.toLowerCase()})` : 'Unknown'} ·{' '}
                <time dateTime={rev.createdAt} title={formatDateTime(rev.createdAt)}>{formatRelative(rev.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function QuestionReview({ q, attemptId, gradable, released, negative }: { q: ReviewQuestion; attemptId: string; gradable: boolean; released: boolean; negative: boolean }) {
  const a = q.answer;
  const selected = new Set(a?.selectedOptionIds ?? []);
  const answered = q.type === 'DESCRIPTIVE' ? !!a?.textAnswer?.trim() : selected.size > 0;
  const corrected = a?.overrideMarks !== null && a?.overrideMarks !== undefined;

  let status: { label: string; icon: typeof CheckCircle2; cls: string };
  if (corrected) status = { label: 'Corrected', icon: ShieldAlert, cls: 'text-warning' };
  else if (!answered) status = { label: 'Unanswered', icon: MinusCircle, cls: 'text-muted-foreground' };
  else if (q.type === 'DESCRIPTIVE') status = a?.gradedAt ? { label: 'Graded', icon: CheckCircle2, cls: 'text-success' } : { label: 'Needs grading', icon: PenLine, cls: 'text-warning' };
  else if (a?.isCorrect) status = { label: 'Correct', icon: CheckCircle2, cls: 'text-success' };
  else if (a?.isCorrect === false) status = { label: 'Incorrect', icon: XCircle, cls: 'text-destructive' };
  else status = { label: 'Not graded yet', icon: Circle, cls: 'text-muted-foreground' };

  const shownMarks = corrected ? a!.overrideMarks : a?.marksAwarded;

  return (
    <Card id={`q-${q.id}`} className={cn(q.type === 'DESCRIPTIVE' && answered && !a?.gradedAt && 'border-warning/40')}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">Question {q.order}</CardTitle>
          <Badge variant="violet">{questionTypeLabel[q.type]}</Badge>
          {a?.markedForReview && <Badge variant="warning"><Flag className="h-3 w-3" /> Marked for review</Badge>}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={cn('inline-flex items-center gap-1 font-medium', status.cls)}><status.icon className="h-4 w-4" /> {status.label}</span>
          <span className="tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{shownMarks === null || shownMarks === undefined ? (answered ? '—' : '0') : formatScore(shownMarks)}</span> / {formatScore(q.marks)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap leading-relaxed">{q.text}</p>

        {q.type !== 'DESCRIPTIVE' ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => {
              const picked = selected.has(o.id);
              return (
                <li
                  key={o.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                    o.isCorrect ? 'border-success/50 bg-success/10' : picked ? 'border-destructive/50 bg-destructive/10' : 'border-border',
                  )}
                >
                  {o.isCorrect ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : picked ? <XCircle className="h-4 w-4 shrink-0 text-destructive" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="flex-1 break-words">{o.text}</span>
                  {picked && <Badge variant={o.isCorrect ? 'success' : 'destructive'}>Selected</Badge>}
                  {!picked && o.isCorrect && <span className="text-xs text-success">Answer</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-border bg-background/40 p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Student answer</p>
            {answered ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{a!.textAnswer}</p> : <p className="text-sm italic text-muted-foreground">No answer — scored 0 automatically.</p>}
          </div>
        )}

        {corrected && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            Corrected to <span className="font-semibold">{formatScore(a!.overrideMarks)}</span> marks
            {a!.gradedBy ? ` by ${a!.gradedBy.name}` : ''}{a!.gradedAt ? ` · ${formatDateTime(a!.gradedAt)}` : ''}. See the correction history below.
          </p>
        )}
        {q.type !== 'DESCRIPTIVE' && !corrected && answered && a?.isCorrect === false && negative && (a.marksAwarded ?? 0) < 0 && (
          <p className="text-xs text-muted-foreground">Negative marking applied: {formatScore(a.marksAwarded)}.</p>
        )}
        {q.explanation && <p className="border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground">{q.explanation}</p>}

        {/* Objective answers are graded automatically; only administrators can correct them (Admin → Results). */}
        {q.type === 'DESCRIPTIVE' && answered && gradable && !corrected && <GradeForm q={q} attemptId={attemptId} released={released} />}
      </CardContent>
    </Card>
  );
}

function GradeForm({ q, attemptId, released }: { q: ReviewQuestion; attemptId: string; released: boolean }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const a = q.answer!;
  const correction = released;
  const blocked = correction && !can('result:correct');
  const [marks, setMarks] = useState<string>(a.gradedAt && a.marksAwarded !== null ? String(a.marksAwarded) : '');
  const [feedback, setFeedback] = useState(a.feedback ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<{ marks?: string; reason?: string }>({});

  useEffect(() => {
    setMarks(a.gradedAt && a.marksAwarded !== null ? String(a.marksAwarded) : '');
    setFeedback(a.feedback ?? '');
    setReason('');
  }, [a.gradedAt, a.marksAwarded, a.feedback]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    const value = Number(marks);
    const next: typeof err = {};
    if (marks.trim() === '' || Number.isNaN(value)) next.marks = 'Enter the marks to award';
    else if (value < 0 || value > q.marks) next.marks = `Marks must be between 0 and ${formatScore(q.marks)}`;
    if (correction && reason.trim().length < 3) next.reason = 'Explain why this published result is being corrected';
    setErr(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await api.put(`/exams/attempts/${attemptId}/answers/${q.id}/grade`, {
        marks: value,
        feedback: feedback.trim() || null,
        ...(correction && { reason: reason.trim() }),
      });
      toast.success(correction ? `Question ${q.order} corrected` : `Question ${q.order} graded`);
      await qc.invalidateQueries({ queryKey: ['attempt-review', attemptId] });
      qc.invalidateQueries({ queryKey: ['exam-attempts'] });
      qc.invalidateQueries({ queryKey: ['exam-stats'] });
      qc.invalidateQueries({ queryKey: ['faculty-dashboard'] });
    } catch (error) {
      if (error instanceof ApiRequestError && error.field('reason')) setErr({ reason: error.field('reason') });
      else toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const id = `grade-${q.id}`;
  return (
    <form
      onSubmit={submit}
      className={cn('space-y-3 rounded-xl border p-4', blocked ? 'border-border bg-muted/40' : correction ? 'border-warning/40 bg-warning/5' : 'border-primary/30 bg-primary/5')}
      noValidate
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {blocked && <Lock className="h-3.5 w-3.5" />}
          {correction ? 'Correct published grade' : a.gradedAt ? 'Update grade' : 'Grade this answer'}
        </p>
        {a.gradedAt && (
          <p className="text-xs text-muted-foreground">
            Graded{a.gradedBy ? ` by ${a.gradedBy.name}` : ''} · {formatDateTime(a.gradedAt)}
          </p>
        )}
      </div>
      {blocked && (
        <p className="text-sm text-muted-foreground" role="note">
          This result is already visible to the student; corrections are made by an administrator.
        </p>
      )}
      <fieldset disabled={blocked} className="space-y-3 disabled:opacity-60">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-marks`} className="text-sm font-medium">Marks (max {formatScore(q.marks)})</label>
            <Input
              id={`${id}-marks`}
              type="number"
              min={0}
              max={q.marks}
              step="0.5"
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              aria-invalid={!!err.marks || undefined}
              aria-describedby={err.marks ? `${id}-marks-err` : undefined}
            />
            {err.marks && <p id={`${id}-marks-err`} className="text-xs text-destructive" role="alert">{err.marks}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-fb`} className="text-sm font-medium">Feedback (visible to the student once released)</label>
            <Textarea id={`${id}-fb`} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} />
          </div>
        </div>
        {correction && !blocked && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              Reason for correction<span className="ml-0.5 text-destructive" aria-hidden>*</span>
            </label>
            <Textarea
              id={`${id}-reason`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Re-marked after the student's review request"
              aria-invalid={!!err.reason || undefined}
              aria-describedby={err.reason ? `${id}-reason-err` : undefined}
            />
            {err.reason && <p id={`${id}-reason-err`} className="text-xs text-destructive" role="alert">{err.reason}</p>}
          </div>
        )}
        {!blocked && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={saving}>
              <Save /> {correction ? 'Save correction' : a.gradedAt ? 'Update grade' : 'Save grade'}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Circle, History, PenLine, Printer, Send, XCircle } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AdminResultDetail as Detail, Question, ReviewAnswer } from '@/lib/types';
import { cn, formatDateTime, formatPercent, formatScore, questionTypeLabel } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ConfirmDialog, ErrorState, Field, PageHeader, ResultBadge } from '@/components/common';

type QuestionWithAnswer = Question & { answer: ReviewAnswer | null };

function effectiveMarks(a: ReviewAnswer | null) {
  if (!a) return 0;
  return a.overrideMarks ?? a.marksAwarded;
}

function CorrectionDialog({ result, question, onOpenChange }: { result: Detail; question: QuestionWithAnswer | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [marks, setMarks] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState<{ marks?: string; reason?: string }>({});
  useEffect(() => {
    const current = effectiveMarks(question?.answer ?? null);
    setMarks(current === null || current === undefined ? '' : String(Math.max(0, current)));
    setReason('');
    setFeedback(question?.answer?.feedback ?? '');
    setErrors({});
  }, [question]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/results/${result.id}/correct`, {
        questionId: question!.id,
        marks: Number(marks),
        reason: reason.trim(),
        feedback: feedback.trim() || null,
      }),
    onSuccess: () => {
      toast.success(result.released ? 'Result corrected — the student has been notified' : 'Marks corrected');
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && (e.field('reason') || e.field('marks'))) {
        setErrors({ reason: e.field('reason'), marks: e.field('marks') });
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(marks);
    const next: typeof errors = {};
    if (marks === '' || Number.isNaN(m) || m < 0 || m > (question?.marks ?? 0)) next.marks = `Enter marks between 0 and ${question?.marks}`;
    if (reason.trim().length < 3) next.reason = 'A reason of at least 3 characters is required';
    setErrors(next);
    if (!Object.keys(next).length) mutation.mutate();
  };

  return (
    <Dialog open={!!question} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct marks — Q{question?.order}</DialogTitle>
          <DialogDescription>
            The new marks replace the automatic or manual grade for this question and the result is recalculated. Every correction is kept in
            the revision history and the audit log.
          </DialogDescription>
        </DialogHeader>
        {result.released && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> This result is already visible to the student. They will be notified of the change.
          </p>
        )}
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label={`Marks (0 – ${question?.marks ?? 0})`} htmlFor="corr-marks" error={errors.marks} required>
            <Input id="corr-marks" type="number" step="0.25" min={0} max={question?.marks} value={marks} onChange={(e) => setMarks(e.target.value)} aria-invalid={!!errors.marks || undefined} />
          </Field>
          <Field label="Reason for correction" htmlFor="corr-reason" error={errors.reason} required>
            <Textarea id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} aria-invalid={!!errors.reason || undefined} placeholder="e.g. Question wording was ambiguous; both answers accepted." />
          </Field>
          <Field label="Feedback to the student (optional)" htmlFor="corr-feedback">
            <Textarea id="corr-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending}>Save correction</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminResultDetail() {
  const { resultId = '' } = useParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data: r, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'result', resultId],
    queryFn: () => api.get<Detail>(`/admin/results/${resultId}`),
  });
  useDocumentTitle(r ? `Result: ${r.student.name}` : 'Result');
  const [correcting, setCorrecting] = useState<QuestionWithAnswer | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const publish = useMutation({
    mutationFn: () => api.patch(`/admin/results/${resultId}/publish`),
    onSuccess: () => {
      toast.success('Result verified and published');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) {
    return (
      <>
        <PageHeader title="Result" back={{ to: '/admin/results', label: 'Results' }} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }
  if (isLoading || !r) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const canPublish = can('result:publish') && r.status === 'GRADED' && !r.released && r.exam.status !== 'CANCELLED';
  const canCorrect = can('result:correct') && r.exam.status !== 'CANCELLED';
  const questionOrder = new Map(r.questions.map((q) => [q.id, q.order]));

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ to: '/admin/results', label: 'Results' }}
          title={r.student.name}
          description={<>{r.exam.title} · {r.exam.subject} · attempt {r.attempt.attemptNumber}</>}
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
              <Button variant="outline" asChild><Link to={`/admin/exams/${r.exam.id}`}>View exam</Link></Button>
              {canPublish && <Button onClick={() => setPublishOpen(true)}><Send /> Verify & publish</Button>}
            </>
          }
        />
      </div>

      <div className="print-area space-y-6">
        <div className="hidden print:block">
          <h1 className="text-xl font-semibold">Result sheet — {r.exam.title}</h1>
          <p className="text-sm">{r.student.name} · {r.student.email}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="p-5 md:col-span-2">
            <p className="text-sm text-muted-foreground">Score</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {formatScore(r.totalScore)}<span className="text-xl text-muted-foreground"> / {formatScore(r.maxScore)}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ResultBadge status={r.status} passed={r.passed} />
              {r.status === 'GRADED' && <Badge variant="outline">{formatPercent(r.percentage)}</Badge>}
              {r.exam.status === 'CANCELLED' ? (
                <Badge variant="destructive">Exam cancelled</Badge>
              ) : r.released ? (
                <Badge variant="success">Visible to student</Badge>
              ) : (
                <Badge variant="warning">Hidden from student</Badge>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Pass mark {r.exam.passMarks} · {r.correctCount} correct · {r.incorrectCount} incorrect · {r.unansweredCount} unanswered
              {r.pendingReviewCount > 0 && <> · {r.pendingReviewCount} awaiting faculty grading</>}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Student</p>
            <p className="mt-1 font-medium">{r.student.name}</p>
            <p className="text-xs text-muted-foreground">{r.student.email}</p>
            {r.student.studentProfile?.rollNumber && <p className="mt-1 font-mono text-xs">{r.student.studentProfile.rollNumber}</p>}
          </Card>
          <Card className="p-5 text-sm">
            <p className="text-muted-foreground">Timeline</p>
            <p className="mt-1">Started {formatDateTime(r.attempt.startedAt)}</p>
            <p>Submitted {formatDateTime(r.attempt.submittedAt)}{r.attempt.submissionType === 'AUTO_TIMEOUT' && ' (auto)'}</p>
            <p className="mt-1 text-muted-foreground">
              {r.publishedAt ? <>Published {formatDateTime(r.publishedAt)}{r.publishedBy && <> by {r.publishedBy.name}</>}</> : r.exam.resultsPublishedAt ? <>Exam results published {formatDateTime(r.exam.resultsPublishedAt)}</> : 'Not published'}
            </p>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Answers</CardTitle>
            <CardDescription>The student’s responses against the answer key.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {r.questions.map((q) => {
                const a = q.answer;
                const marks = effectiveMarks(a);
                const answered = q.type === 'DESCRIPTIVE' ? !!a?.textAnswer?.trim() : !!a?.selectedOptionIds.length;
                return (
                  <li key={q.id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Q{q.order}</span>
                      <Badge variant="muted">{questionTypeLabel[q.type]}</Badge>
                      {!answered && <Badge variant="outline">Unanswered</Badge>}
                      {a?.overrideMarks !== null && a?.overrideMarks !== undefined && <Badge variant="violet">Corrected</Badge>}
                      <span className="ml-auto text-sm tabular-nums">
                        {marks === null || marks === undefined ? <span className="text-warning">Pending grading</span> : <>{formatScore(marks)} / {q.marks}</>}
                      </span>
                      {canCorrect && (
                        <Button size="sm" variant="outline" className="no-print" onClick={() => setCorrecting(q)}>
                          <PenLine /> Correct marks
                        </Button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{q.text}</p>
                    {q.options.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {q.options.map((o) => {
                          const chosen = a?.selectedOptionIds.includes(o.id);
                          return (
                            <li
                              key={o.id}
                              className={cn(
                                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                                o.isCorrect ? 'border-success/40 bg-success/10' : chosen ? 'border-destructive/40 bg-destructive/10' : 'border-border',
                              )}
                            >
                              {chosen ? (
                                o.isCorrect ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Chosen, correct" /> : <XCircle className="h-4 w-4 text-destructive" aria-label="Chosen, incorrect" />
                              ) : (
                                <Circle className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                              )}
                              <span className="flex-1">{o.text}</span>
                              {o.isCorrect && <span className="text-xs text-success">Correct answer</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {q.type === 'DESCRIPTIVE' && (
                      <p className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-background/40 p-3 text-sm">
                        {a?.textAnswer?.trim() || <span className="text-muted-foreground">No answer given.</span>}
                      </p>
                    )}
                    {(a?.feedback || a?.gradedBy) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {a?.feedback && <>Feedback: “{a.feedback}” </>}
                        {a?.gradedBy && <>— graded by {a.gradedBy.name}{a.gradedAt && `, ${formatDateTime(a.gradedAt)}`}</>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Revision history</CardTitle>
            <CardDescription>Manual gradings and corrections that changed this result.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No manual changes — this result is exactly as graded automatically.</p>
            ) : (
              <ul className="divide-y divide-border">
                {r.revisions.map((rev) => (
                  <li key={rev.id} className="py-3 text-sm first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={rev.kind === 'CORRECTION' ? 'warning' : 'default'}>{rev.kind === 'CORRECTION' ? 'Correction' : 'Grading'}</Badge>
                      {rev.questionId && <span className="font-medium">Q{questionOrder.get(rev.questionId) ?? '?'}</span>}
                      <span className="tabular-nums text-muted-foreground">
                        marks {formatScore(rev.previousMarks)} → {formatScore(rev.newMarks)} · total {formatScore(rev.previousTotalScore)} → {formatScore(rev.newTotalScore)}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rev.actor ? `${rev.actor.name} (${rev.actor.role.toLowerCase()})` : 'Former user'}
                      {rev.reason && <> — “{rev.reason}”</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <CorrectionDialog result={r} question={correcting} onOpenChange={(o) => !o && setCorrecting(null)} />
      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Verify and publish this result?"
        description={<>{r.student.name} will see a score of {formatScore(r.totalScore)} / {formatScore(r.maxScore)} and is notified. Later changes will count as corrections.</>}
        confirmLabel="Publish result"
        onConfirm={() => publish.mutateAsync()}
      />
    </>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, Ban, CheckCircle2, CircleDot, Clock, FileBarChart, History, Info, ListChecks, MessageSquareWarning,
  Pencil, Send, User as UserIcon, XCircle, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ExamDetail, ExamStatusChange } from '@/lib/types';
import { cn, formatDateTime, formatMinutes, formatRelative, phaseLabel, questionTypeLabel } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, PhaseBadge } from '@/components/common';
import { ACTION_COPY, ADMIN_EXAM_ACTIONS, ExamActionDialog, type AdminExamAction } from '@/components/admin/examActions';

const ACTION_ICON: Record<AdminExamAction, LucideIcon> = {
  APPROVE: CheckCircle2, REJECT: XCircle, PUBLISH: Send, CANCEL: Ban, ARCHIVE: Archive, RESTORE: ArchiveRestore,
};

const releaseLabel = { IMMEDIATE: 'Immediately after grading', AFTER_END: 'After the window closes', MANUAL: 'When published manually' } as const;

const timelineLabel: Record<ExamStatusChange['action'], string> = {
  SUBMIT: 'Submitted for approval', WITHDRAW: 'Withdrawn to draft', APPROVE: 'Approved', REJECT: 'Rejected', PUBLISH: 'Published',
  UNPUBLISH: 'Unpublished', CANCEL: 'Cancelled', ARCHIVE: 'Archived', RESTORE: 'Restored',
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function AdminExamReview() {
  const { examId = '' } = useParams();
  const { data: exam, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'exam', examId],
    queryFn: () => api.get<ExamDetail>(`/admin/exams/${examId}`),
  });
  useDocumentTitle(exam ? `Review: ${exam.title}` : 'Review exam');
  const [action, setAction] = useState<AdminExamAction | null>(null);

  if (error) {
    return (
      <>
        <PageHeader title="Review exam" back={{ to: '/admin/exams', label: 'Exam approvals' }} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }
  if (isLoading || !exam) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const actions = ADMIN_EXAM_ACTIONS.filter((a) => exam.allowedActions.includes(a));
  const note = exam.reviewNote;
  const noteTone = exam.status === 'REJECTED' || exam.status === 'CANCELLED' ? 'destructive' : 'info';
  const correctCount = (q: ExamDetail['questions'][number]) => q.options.filter((o) => o.isCorrect).length;

  return (
    <>
      <PageHeader
        back={{ to: '/admin/exams', label: 'Exam approvals' }}
        title={exam.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={exam.phase} />
            <span>{exam.subject}</span>
            <span aria-hidden>·</span>
            <span>by {exam.createdBy.name}</span>
            {exam.submittedForApprovalAt && exam.status === 'PENDING_APPROVAL' && (
              <>
                <span aria-hidden>·</span>
                <span>submitted {formatRelative(exam.submittedForApprovalAt)}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/faculty/exams/${exam.id}`}><Pencil /> Open in editor</Link>
            </Button>
            {['PUBLISHED', 'ARCHIVED', 'CANCELLED'].includes(exam.status) && (
              <Button variant="outline" asChild>
                <Link to={`/faculty/exams/${exam.id}/submissions`}><FileBarChart /> Submissions</Link>
              </Button>
            )}
          </>
        }
      />

      {note && (
        <div
          role="note"
          className={cn(
            'mb-6 flex items-start gap-3 rounded-2xl border p-4 text-sm',
            noteTone === 'destructive' ? 'border-destructive/30 bg-destructive/8' : 'border-primary/30 bg-primary/8',
          )}
        >
          <MessageSquareWarning className={cn('mt-0.5 h-5 w-5 shrink-0', noteTone === 'destructive' ? 'text-destructive' : 'text-primary')} />
          <div>
            <p className="font-medium">
              {exam.status === 'REJECTED' ? 'Rejection reason' : exam.status === 'CANCELLED' ? 'Cancellation reason' : 'Reviewer note'}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{note}</p>
          </div>
        </div>
      )}

      {/* Decision bar */}
      <Card className="mb-6 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {exam.status === 'PENDING_APPROVAL' ? 'This exam is waiting for your decision' : `Status: ${phaseLabel[exam.phase]}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {actions.length
                ? 'Every decision is recorded in the workflow history and the audit log.'
                : 'No administrative actions are available for this exam in its current state.'}
            </p>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => {
                const Icon = ACTION_ICON[a];
                const variant = a === 'APPROVE' ? 'success' : a === 'REJECT' || a === 'CANCEL' ? 'destructive' : a === 'PUBLISH' ? 'default' : 'outline';
                return (
                  <Button key={a} variant={variant} onClick={() => setAction(a)}>
                    <Icon /> {ACTION_COPY[a].confirm}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Settings</CardTitle>
              {exam.description && <CardDescription>{exam.description}</CardDescription>}
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Opens" value={formatDateTime(exam.startsAt)} />
                <Fact label="Closes" value={formatDateTime(exam.endsAt)} />
                <Fact label="Duration" value={formatMinutes(exam.durationMinutes)} />
                <Fact label="Total marks" value={exam.totalMarks} />
                <Fact label="Pass marks" value={`${exam.passMarks}${exam.totalMarks ? ` (${Math.round((exam.passMarks / exam.totalMarks) * 100)}%)` : ''}`} />
                <Fact label="Attempts allowed" value={exam.maxAttempts} />
                <Fact label="Negative marking" value={exam.negativeMarking ? `Yes, −${Math.round(exam.negativeMarkRatio * 100)}% per wrong answer` : 'No'} />
                <Fact label="Result release" value={releaseLabel[exam.resultRelease]} />
                <Fact label="Attempts so far" value={exam.attemptCount} />
              </dl>
              {exam.instructions && (
                <div className="mt-4">
                  <p className="mb-1 text-sm font-medium">Instructions</p>
                  <p className="whitespace-pre-wrap rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground">{exam.instructions}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" /> Questions & answer key</CardTitle>
              <CardDescription>{exam.questions.length} questions · {exam.totalMarks} marks. Correct options are highlighted.</CardDescription>
            </CardHeader>
            <CardContent>
              {exam.questions.length === 0 ? (
                <EmptyState icon={ListChecks} title="No questions yet" description="This exam cannot be approved until it has questions." />
              ) : (
                <ol className="space-y-4">
                  {exam.questions.map((q, i) => (
                    <li key={q.id} className="rounded-xl border border-border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">Q{i + 1}</span>
                        <Badge variant="muted">{questionTypeLabel[q.type]}</Badge>
                        <Badge variant="outline">{q.marks} mark{q.marks === 1 ? '' : 's'}</Badge>
                        {q.type !== 'DESCRIPTIVE' && correctCount(q) === 0 && <Badge variant="destructive">No correct option</Badge>}
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{q.text}</p>
                      {q.options.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {q.options.map((o, j) => (
                            <li
                              key={o.id}
                              className={cn(
                                'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                                o.isCorrect ? 'border-success/40 bg-success/10' : 'border-border',
                              )}
                            >
                              <span className="w-5 shrink-0 font-medium text-muted-foreground">{String.fromCharCode(65 + j)}.</span>
                              <span className="flex-1">{o.text}</span>
                              {o.isCorrect && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct answer" />}
                            </li>
                          ))}
                        </ul>
                      )}
                      {q.type === 'DESCRIPTIVE' && <p className="mt-2 text-xs text-muted-foreground">Graded manually by faculty.</p>}
                      {q.explanation && (
                        <p className="mt-3 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Explanation: </span>{q.explanation}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserIcon className="h-4 w-4 text-primary" /> Ownership</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Faculty:</span> {exam.createdBy.name}</p>
              <p><span className="text-muted-foreground">Created:</span> {formatDateTime(exam.createdAt)}</p>
              {exam.submittedForApprovalAt && <p><span className="text-muted-foreground">Submitted:</span> {formatDateTime(exam.submittedForApprovalAt)}</p>}
              {exam.approvedBy && exam.approvedAt && (
                <p><span className="text-muted-foreground">Approved by:</span> {exam.approvedBy.name}, {formatDateTime(exam.approvedAt)}</p>
              )}
              {exam.publishedAt && <p><span className="text-muted-foreground">Published:</span> {formatDateTime(exam.publishedAt)}</p>}
              {exam.cancelledAt && <p><span className="text-muted-foreground">Cancelled:</span> {formatDateTime(exam.cancelledAt)}</p>}
              <p>
                <span className="text-muted-foreground">Approval policy:</span>{' '}
                {exam.requiresApproval ? 'Approval required before publishing' : 'Faculty may publish directly'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Workflow history</CardTitle>
              <CardDescription>Every status change, newest first</CardDescription>
            </CardHeader>
            <CardContent>
              {exam.statusChanges.length === 0 ? (
                <p className="text-sm text-muted-foreground">No workflow activity yet — the exam has not been submitted.</p>
              ) : (
                <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-px before:bg-border">
                  {exam.statusChanges.map((c) => (
                    <li key={c.id} className="relative pl-6">
                      <CircleDot
                        className={cn(
                          'absolute left-0 top-0.5 h-[15px] w-[15px] bg-card-solid',
                          c.action === 'REJECT' || c.action === 'CANCEL' ? 'text-destructive' : c.action === 'APPROVE' || c.action === 'PUBLISH' ? 'text-success' : 'text-primary',
                        )}
                        aria-hidden
                      />
                      <p className="text-sm font-medium">{timelineLabel[c.action]}</p>
                      <p className="text-xs text-muted-foreground">
                        {phaseLabel[c.fromStatus as keyof typeof phaseLabel] ?? c.fromStatus} → {phaseLabel[c.toStatus as keyof typeof phaseLabel] ?? c.toStatus}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" /> {formatDateTime(c.createdAt)} · {c.actor ? `${c.actor.name} (${c.actor.role.toLowerCase()})` : 'Former user'}
                      </p>
                      {c.reason && <p className="mt-1 rounded-lg bg-muted/60 p-2 text-xs">“{c.reason}”</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ExamActionDialog
        target={action ? { examId: exam.id, title: exam.title, action } : null}
        onOpenChange={(o) => !o && setAction(null)}
      />
    </>
  );
}

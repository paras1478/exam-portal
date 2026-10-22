import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, BarChart3, Ban, CheckCircle2, Circle, Clock, Eye, EyeOff, FileQuestion, History, Info, ListChecks, Lock,
  Pencil, Plus, Send, Settings2, ShieldCheck, Trash2, Undo2, XCircle, type LucideIcon,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { ExamDetail, ExamInput, Question, QuestionInput } from '@/lib/types';
import { cn, formatDateTime, formatScore, questionTypeLabel } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/overlays';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, PhaseBadge } from '@/components/common';
import { ExamSettingsForm } from '@/components/faculty/ExamSettingsForm';
import { QuestionDialog } from '@/components/faculty/QuestionDialog';
import { ExamPreview } from '@/components/faculty/ExamPreview';
import { actionLabel, facultyActions, useExamActions, type ExamAction } from '@/components/faculty/useExamActions';
import { ExamHistory } from '@/components/faculty/ExamHistory';

const actionIcon: Record<ExamAction, LucideIcon> = {
  submit: ShieldCheck, withdraw: Undo2, publish: Send, unpublish: EyeOff, archive: Archive, restore: ArchiveRestore, delete: Trash2,
};
/** Forward actions get the gradient button; the rest are outlined. */
const PRIMARY: ExamAction[] = ['submit', 'publish'];

export default function ExamEditor() {
  const { examId } = useParams();
  const isNew = !examId;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = isNew ? 'settings' : (params.get('tab') ?? 'questions');

  const { data: exam, isLoading, error, refetch } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get<ExamDetail>(`/exams/${examId}`),
    enabled: !isNew,
  });
  useDocumentTitle(isNew ? 'New exam' : (exam?.title ?? 'Edit exam'));
  const { request, dialogs } = useExamActions();
  const { user } = useAuth();
  const requireApproval = exam?.requiresApproval ?? user?.policy.requireExamApproval ?? true;

  const saveSettings = async (input: Partial<ExamInput>) => {
    try {
      if (isNew) {
        const created = await api.post<ExamDetail>('/exams', input);
        qc.setQueryData(['exam', created.id], created);
        qc.invalidateQueries({ queryKey: ['exams'] });
        toast.success('Exam created — now add your questions');
        navigate(`/faculty/exams/${created.id}?tab=questions`, { replace: true });
      } else {
        const updated = await api.patch<ExamDetail>(`/exams/${examId}`, input);
        qc.setQueryData(['exam', examId], updated);
        qc.invalidateQueries({ queryKey: ['exams'] });
        toast.success('Settings saved');
      }
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  if (!isNew && error) {
    return (
      <div>
        <PageHeader title="Exam" back={{ to: '/faculty/exams', label: 'All exams' }} />
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!isNew && (isLoading || !exam)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const target = exam ? { id: exam.id, title: exam.title } : null;
  const actions = exam ? facultyActions(exam.allowedActions) : [];
  const canDelete = !!exam && (exam.status === 'DRAFT' || exam.status === 'REJECTED') && exam.attemptCount === 0;

  return (
    <div>
      <PageHeader
        back={{ to: '/faculty/exams', label: 'All exams' }}
        title={isNew ? 'Create exam' : exam!.title}
        description={
          isNew ? (
            'Configure the basics and schedule. You can add questions right after.'
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <PhaseBadge phase={exam!.phase} />
              <Badge variant="muted">{exam!.subject}</Badge>
              <span>{exam!.questions.length} questions · {formatScore(exam!.totalMarks)} marks · {exam!.attemptCount} attempts</span>
              {exam!.locked && <Badge variant="warning"><Lock className="h-3 w-3" /> Locked</Badge>}
            </span>
          )
        }
        actions={
          exam &&
          target && (
            <>
              {(exam.status === 'PUBLISHED' || exam.status === 'ARCHIVED' || exam.status === 'CANCELLED') && (
                <Button variant="outline" asChild>
                  <Link to={`/faculty/exams/${exam.id}/submissions`}><BarChart3 /> Submissions</Link>
                </Button>
              )}
              {canDelete && (
                <Tooltip content="Delete exam">
                  <Button variant="ghost" size="icon" onClick={() => request('delete', target)} aria-label="Delete exam" className="text-destructive">
                    <Trash2 />
                  </Button>
                </Tooltip>
              )}
              {actions.map((a) => {
                const Icon = actionIcon[a];
                return (
                  <Button key={a} variant={PRIMARY.includes(a) ? 'default' : 'outline'} onClick={() => request(a, target)}>
                    <Icon /> {a === 'submit' && exam.status === 'REJECTED' ? 'Resubmit for approval' : actionLabel[a]}
                  </Button>
                );
              })}
            </>
          )
        }
      />

      {exam && <StatusBanner exam={exam} requireApproval={requireApproval} />}

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="settings"><Settings2 /> Settings</TabsTrigger>
          <TabsTrigger value="questions" disabled={isNew}><ListChecks /> Questions{exam ? ` (${exam.questions.length})` : ''}</TabsTrigger>
          <TabsTrigger value="preview" disabled={isNew}><Eye /> Preview</TabsTrigger>
          <TabsTrigger value="history" disabled={isNew}><History /> History</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <ExamSettingsForm exam={exam} onSubmit={saveSettings} />
        </TabsContent>
        {exam && (
          <>
            <TabsContent value="questions">
              <QuestionsPanel exam={exam} />
            </TabsContent>
            <TabsContent value="preview">
              <ExamPreview exam={exam} />
            </TabsContent>
            <TabsContent value="history">
              <ExamHistory exam={exam} />
            </TabsContent>
          </>
        )}
      </Tabs>
      {dialogs}
    </div>
  );
}

function lockReason(exam: ExamDetail) {
  switch (exam.status) {
    case 'PENDING_APPROVAL': return 'Locked while awaiting approval — withdraw to edit';
    case 'APPROVED': return 'Locked after approval — withdraw to draft to edit';
    case 'PUBLISHED': return exam.attemptCount > 0 ? 'Locked — students have attempted this exam' : 'Locked after approval — unpublish to draft to edit';
    case 'CANCELLED': return 'Cancelled exams are read-only';
    case 'ARCHIVED': return 'Archived — restore to make changes';
    default: return 'Questions are locked';
  }
}

type Tone = 'info' | 'warning' | 'success' | 'destructive' | 'muted';
const toneClass: Record<Tone, string> = {
  info: 'border-primary/30 bg-primary/10 [&>svg]:text-primary',
  warning: 'border-warning/40 bg-warning/10 [&>svg]:text-warning',
  success: 'border-success/40 bg-success/10 [&>svg]:text-success',
  destructive: 'border-destructive/40 bg-destructive/10 [&>svg]:text-destructive',
  muted: 'border-border bg-muted/60 [&>svg]:text-muted-foreground',
};

function Banner({ tone, icon: Icon, title, children }: { tone: Tone; icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div role="status" className={cn('mb-6 flex gap-3 rounded-xl border p-4 text-sm', toneClass[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

function StatusBanner({ exam, requireApproval }: { exam: ExamDetail; requireApproval: boolean }) {
  switch (exam.status) {
    case 'DRAFT':
      return requireApproval ? (
        <Banner tone="info" icon={Info} title="Publishing requires administrator approval">
          When your questions are ready, submit the exam for review. Once an administrator approves it you can publish it.
        </Banner>
      ) : null;
    case 'PENDING_APPROVAL':
      return (
        <Banner tone="warning" icon={Clock} title="Awaiting administrator review">
          Submitted {formatDateTime(exam.submittedForApprovalAt)}. The exam is read-only while under review — withdraw it to make changes.
        </Banner>
      );
    case 'APPROVED':
      return (
        <Banner tone="success" icon={ShieldCheck} title={`Approved${exam.approvedBy ? ` by ${exam.approvedBy.name}` : ''} — publish when ready`}>
          {exam.reviewNote && <p className="mb-1 italic">&ldquo;{exam.reviewNote}&rdquo;</p>}
          Approved content is frozen. Withdraw to draft to change questions or grading rules; it will then need approval again.
        </Banner>
      );
    case 'REJECTED':
      return (
        <Banner tone="destructive" icon={XCircle} title="Changes requested by the reviewer">
          <p className="rounded-lg border border-destructive/30 bg-background/60 p-3 text-foreground">{exam.reviewNote ?? 'No reason was given.'}</p>
          <p className="mt-2">Edit the exam to address the feedback, then resubmit it for approval.</p>
        </Banner>
      );
    case 'CANCELLED':
      return (
        <Banner tone="destructive" icon={Ban} title={`Cancelled ${formatDateTime(exam.cancelledAt)}`}>
          {exam.reviewNote ? <>Reason: {exam.reviewNote}. </> : 'This exam was cancelled by an administrator. '}
          Results of a cancelled exam are never released.
        </Banner>
      );
    case 'ARCHIVED':
      return (
        <Banner tone="muted" icon={Archive} title="Archived">
          This exam is hidden from students and read-only. Restore it to make changes.
        </Banner>
      );
    default:
      return null;
  }
}

function QuestionsPanel({ exam }: { exam: ExamDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Question | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Question | null>(null);
  const [reordering, setReordering] = useState(false);
  const readOnly = exam.editLevel !== 'FULL';

  const apply = (updated: ExamDetail) => {
    qc.setQueryData(['exam', exam.id], updated);
    qc.invalidateQueries({ queryKey: ['exams'] });
  };

  const save = async (input: QuestionInput) => {
    const updated = editing
      ? await api.put<ExamDetail>(`/exams/${exam.id}/questions/${editing.id}`, input)
      : await api.post<ExamDetail>(`/exams/${exam.id}/questions`, input);
    apply(updated);
    toast.success(editing ? 'Question updated' : 'Question added');
  };

  const move = async (index: number, dir: -1 | 1) => {
    const ids = exam.questions.map((q) => q.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    setReordering(true);
    try {
      apply(await api.put<ExamDetail>(`/exams/${exam.id}/questions-order`, { questionIds: ids }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReordering(false);
    }
  };

  const objective = exam.questions.filter((q) => q.type !== 'DESCRIPTIVE').length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">Total marks</span> <span className="font-semibold tabular-nums">{formatScore(exam.totalMarks)}</span></span>
          <span><span className="text-muted-foreground">Pass marks</span> <span className={cn('font-semibold tabular-nums', exam.passMarks > exam.totalMarks && 'text-warning')}>{formatScore(exam.passMarks)}</span></span>
          <span><span className="text-muted-foreground">Auto-graded</span> <span className="font-semibold">{objective}/{exam.questions.length}</span></span>
        </div>
        {readOnly ? (
          <Badge variant="warning" className="w-fit whitespace-normal"><Lock className="h-3 w-3 shrink-0" /> {lockReason(exam)}</Badge>
        ) : (
          <Button onClick={() => { setEditing(null); setCreating(true); }}><Plus /> Add question</Button>
        )}
      </Card>

      {exam.passMarks > exam.totalMarks && exam.questions.length > 0 && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          Pass marks ({formatScore(exam.passMarks)}) exceed the total ({formatScore(exam.totalMarks)}). Add questions or lower the pass marks before publishing.
        </p>
      )}

      {exam.questions.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No questions yet"
          description="Add single-choice, multiple-select, true/false or descriptive questions."
          action={!readOnly && <Button onClick={() => setCreating(true)}><Plus /> Add first question</Button>}
        />
      ) : (
        <ol className="space-y-3">
          {exam.questions.map((q, i) => (
            <li key={q.id}>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-sm font-semibold text-white">{q.order}</span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="violet">{questionTypeLabel[q.type]}</Badge>
                        <Badge variant="muted">{formatScore(q.marks)} {q.marks === 1 ? 'mark' : 'marks'}</Badge>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{q.text}</p>
                      {q.options.length > 0 && (
                        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                          {q.options.map((o) => (
                            <li key={o.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', o.isCorrect ? 'border-success/50 bg-success/10' : 'border-border')}>
                              {o.isCorrect ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                              <span className="min-w-0 break-words">{o.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {q.type === 'DESCRIPTIVE' && <p className="mt-2 text-xs text-muted-foreground">Graded manually after submission.</p>}
                      {q.explanation && <p className="mt-3 border-l-2 border-primary/50 pl-3 text-sm text-muted-foreground">{q.explanation}</p>}
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                        <Button variant="ghost" size="icon" disabled={i === 0 || reordering} onClick={() => move(i, -1)} aria-label={`Move question ${q.order} up`}><ArrowUp /></Button>
                        <Button variant="ghost" size="icon" disabled={i === exam.questions.length - 1 || reordering} onClick={() => move(i, 1)} aria-label={`Move question ${q.order} down`}><ArrowDown /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(q); setCreating(true); }} aria-label={`Edit question ${q.order}`}><Pencil /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleting(q)} aria-label={`Delete question ${q.order}`}><Trash2 /></Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <QuestionDialog
        open={creating}
        onOpenChange={(o) => { setCreating(o); if (!o) setEditing(null); }}
        question={editing ?? undefined}
        onSave={save}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete question ${deleting?.order ?? ''}?`}
        description="The question and its options will be removed and the remaining questions renumbered."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            apply(await api.delete<ExamDetail>(`/exams/${exam.id}/questions/${deleting!.id}`));
            toast.success('Question deleted');
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

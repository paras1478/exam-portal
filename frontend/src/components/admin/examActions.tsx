import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AuditOutcome, ExamAction, ExamDetail, ExamPhase, ExamStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field } from '@/components/common';

/** Workflow actions an administrator performs from the control panel. */
export type AdminExamAction = Extract<ExamAction, 'APPROVE' | 'REJECT' | 'PUBLISH' | 'CANCEL' | 'ARCHIVE' | 'RESTORE'>;
export const ADMIN_EXAM_ACTIONS: AdminExamAction[] = ['APPROVE', 'REJECT', 'PUBLISH', 'CANCEL', 'ARCHIVE', 'RESTORE'];

interface ActionCopy {
  title: string;
  description: string;
  confirm: string;
  variant: 'default' | 'destructive' | 'success';
  reason: 'required' | 'optional' | 'none';
  reasonLabel?: string;
  done: string;
}

export const ACTION_COPY: Record<AdminExamAction, ActionCopy> = {
  APPROVE: {
    title: 'Approve exam', confirm: 'Approve', variant: 'success', reason: 'optional', reasonLabel: 'Note to the faculty member (optional)',
    description: 'The exam becomes approved and can then be published. Its questions and grading rules stay frozen unless it is withdrawn to draft.',
    done: 'approved',
  },
  REJECT: {
    title: 'Reject exam', confirm: 'Reject', variant: 'destructive', reason: 'required', reasonLabel: 'Reason for rejection',
    description: 'The exam returns to the faculty member, who can edit and resubmit it. They will see your reason.',
    done: 'rejected',
  },
  PUBLISH: {
    title: 'Publish exam', confirm: 'Publish', variant: 'default', reason: 'none',
    description: 'Students are notified and can take the exam during its availability window.',
    done: 'published',
  },
  CANCEL: {
    title: 'Cancel exam', confirm: 'Cancel exam', variant: 'destructive', reason: 'required', reasonLabel: 'Reason for cancellation',
    description: 'Students can no longer start the exam, running attempts are closed immediately and results are never released. This cannot be undone.',
    done: 'cancelled',
  },
  ARCHIVE: {
    title: 'Archive exam', confirm: 'Archive', variant: 'default', reason: 'none',
    description: 'The exam is hidden from active lists. Attempts and results are kept and it can be restored later.',
    done: 'archived',
  },
  RESTORE: {
    title: 'Restore exam', confirm: 'Restore', variant: 'default', reason: 'none',
    description: 'The exam returns to the status it had before it was archived (exams that were under review return to draft).',
    done: 'restored',
  },
};

/**
 * Client-side hint of which admin actions apply to an exam in a list row (the summary has no
 * `allowedActions`). The server validates every transition again.
 */
export function rowActions(status: ExamStatus, phase: ExamPhase): AdminExamAction[] {
  switch (status) {
    case 'PENDING_APPROVAL': return ['APPROVE', 'REJECT', 'CANCEL'];
    case 'APPROVED': return ['PUBLISH', 'CANCEL'];
    case 'PUBLISHED': return phase === 'ENDED' ? ['ARCHIVE', 'CANCEL'] : ['CANCEL'];
    case 'DRAFT':
    case 'REJECTED':
    case 'CANCELLED': return ['ARCHIVE'];
    case 'ARCHIVED': return ['RESTORE'];
  }
}

const PATH: Record<AdminExamAction, string> = {
  APPROVE: 'approve', REJECT: 'reject', PUBLISH: 'publish', CANCEL: 'cancel', ARCHIVE: 'archive', RESTORE: 'restore',
};

export function ExamActionDialog({ target, onOpenChange, onDone }: {
  target: { examId: string; title: string; action: AdminExamAction } | null;
  onOpenChange: (open: boolean) => void;
  onDone?: (exam: ExamDetail) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [reasonError, setReasonError] = useState<string>();
  useEffect(() => {
    setReason('');
    setProblems([]);
    setReasonError(undefined);
  }, [target]);

  const copy = target ? ACTION_COPY[target.action] : null;
  const mutation = useMutation({
    mutationFn: () => api.patch<ExamDetail>(`/admin/exams/${target!.examId}/${PATH[target!.action]}`, { reason: reason.trim() || undefined }),
    onSuccess: (exam) => {
      toast.success(`"${exam.title}" ${copy!.done}`);
      qc.setQueryData(['admin', 'exam', exam.id], exam);
      void qc.invalidateQueries({ queryKey: ['admin'] });
      void qc.invalidateQueries({ queryKey: ['exams'] });
      onDone?.(exam);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.details?.problems?.length) {
        setProblems(e.details.problems);
        return;
      }
      if (e instanceof ApiRequestError && e.field('reason')) {
        setReasonError(e.field('reason'));
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = () => {
    if (copy?.reason === 'required' && reason.trim().length < 3) {
      setReasonError('Please give a reason (at least 3 characters).');
      return;
    }
    setReasonError(undefined);
    mutation.mutate();
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{target?.title}</span> — {copy?.description}
          </DialogDescription>
        </DialogHeader>
        {copy && copy.reason !== 'none' && (
          <Field label={copy.reasonLabel ?? 'Reason'} htmlFor="exam-action-reason" error={reasonError} required={copy.reason === 'required'}>
            <Textarea
              id="exam-action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={3}
              aria-invalid={!!reasonError || undefined}
              placeholder={copy.reason === 'required' ? 'Explain the decision — it is shown to the faculty member and kept in the audit log.' : undefined}
            />
          </Field>
        )}
        {problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <p className="mb-1 flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> The exam is not ready
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Close</Button>
          <Button variant={copy?.variant ?? 'default'} onClick={submit} loading={mutation.isPending}>{copy?.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  if (outcome === 'SUCCESS') return <Badge variant="success">Success</Badge>;
  if (outcome === 'FAILURE') return <Badge variant="warning">Failure</Badge>;
  return <Badge variant="destructive">Denied</Badge>;
}

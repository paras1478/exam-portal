import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { ExamAction as WorkflowAction, ExamDetail, ExamStatus } from '@/lib/types';
import { ConfirmDialog } from '@/components/common';

/** Faculty-side workflow actions (approve/reject/cancel are administrator-only and never offered here). */
export type ExamAction = 'submit' | 'withdraw' | 'publish' | 'unpublish' | 'archive' | 'restore' | 'delete';

export const FACULTY_WORKFLOW: Partial<Record<WorkflowAction, ExamAction>> = {
  SUBMIT: 'submit',
  WITHDRAW: 'withdraw',
  PUBLISH: 'publish',
  UNPUBLISH: 'unpublish',
  ARCHIVE: 'archive',
  RESTORE: 'restore',
};

/** Faculty workflow actions the server reported as allowed, in display order. */
export function facultyActions(allowed: WorkflowAction[]): ExamAction[] {
  const order: WorkflowAction[] = ['WITHDRAW', 'UNPUBLISH', 'ARCHIVE', 'RESTORE', 'SUBMIT', 'PUBLISH'];
  return order.filter((a) => allowed.includes(a)).map((a) => FACULTY_WORKFLOW[a]!);
}

/**
 * Fallback for rows without `allowedActions` (older API responses). The server remains the judge:
 * if the guess is wrong the action fails with a clear error toast.
 */
export function guessActions(status: ExamStatus, attemptCount: number, requireApproval: boolean, ended: boolean): ExamAction[] {
  const out: ExamAction[] = [];
  if (status === 'PENDING_APPROVAL' || status === 'APPROVED') out.push('withdraw');
  if (status === 'PUBLISHED' && attemptCount === 0) out.push('unpublish');
  if (['DRAFT', 'REJECTED', 'CANCELLED'].includes(status) || (status === 'PUBLISHED' && ended)) out.push('archive');
  if (status === 'ARCHIVED') out.push('restore');
  if (requireApproval && (status === 'DRAFT' || status === 'REJECTED')) out.push('submit');
  if (status === 'APPROVED' || (!requireApproval && status === 'DRAFT')) out.push('publish');
  if ((status === 'DRAFT' || status === 'REJECTED') && attemptCount === 0) out.push('delete');
  return out;
}

interface Target {
  id: string;
  title: string;
}

const copy: Record<ExamAction, { title: string; confirm: string; destructive?: boolean; describe: (t: string) => ReactNode; success: string }> = {
  submit: {
    title: 'Submit for approval?',
    confirm: 'Submit',
    describe: (t) => <>An administrator will review &ldquo;{t}&rdquo;. Questions and settings are frozen while it is under review; you can withdraw it at any time.</>,
    success: 'Submitted for approval',
  },
  withdraw: {
    title: 'Withdraw to draft?',
    confirm: 'Withdraw',
    describe: (t) => <>&ldquo;{t}&rdquo; returns to draft so you can edit it. It will need to be approved again before it can be published.</>,
    success: 'Exam moved back to draft',
  },
  publish: {
    title: 'Publish exam?',
    confirm: 'Publish',
    describe: (t) => <>Students will be notified and &ldquo;{t}&rdquo; will appear in their exam list. It opens at its scheduled start time.</>,
    success: 'Exam published',
  },
  unpublish: {
    title: 'Move back to draft?',
    confirm: 'Unpublish',
    describe: (t) => <>&ldquo;{t}&rdquo; will be hidden from students. If approval is required it must be approved again before republishing.</>,
    success: 'Exam moved to draft',
  },
  archive: {
    title: 'Archive exam?',
    confirm: 'Archive',
    destructive: true,
    describe: (t) => <>&ldquo;{t}&rdquo; will be hidden from students. Existing attempts and results are kept and you can restore it later.</>,
    success: 'Exam archived',
  },
  restore: {
    title: 'Restore exam?',
    confirm: 'Restore',
    describe: (t) => <>&ldquo;{t}&rdquo; will return to its previous state.</>,
    success: 'Exam restored',
  },
  delete: {
    title: 'Delete exam permanently?',
    confirm: 'Delete',
    destructive: true,
    describe: (t) => <>&ldquo;{t}&rdquo; and all of its questions will be permanently deleted. This cannot be undone.</>,
    success: 'Exam deleted',
  },
};

export const actionLabel: Record<ExamAction, string> = {
  submit: 'Submit for approval',
  withdraw: 'Withdraw to draft',
  publish: 'Publish',
  unpublish: 'Unpublish',
  archive: 'Archive',
  restore: 'Restore',
  delete: 'Delete',
};

/** Workflow actions with confirmation dialogs, shared by the exam list and the editor. */
export function useExamActions(opts: { onDeleted?: () => void } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ action: ExamAction; target: Target } | null>(null);
  const [problems, setProblems] = useState<{ action: ExamAction; list: string[] } | null>(null);

  const run = async (action: ExamAction, target: Target) => {
    try {
      if (action === 'delete') {
        await api.delete(`/exams/${target.id}`);
        qc.removeQueries({ queryKey: ['exam', target.id] });
      } else {
        const exam = await api.post<ExamDetail>(`/exams/${target.id}/${action}`);
        qc.setQueryData(['exam', target.id], exam);
      }
      qc.invalidateQueries({ queryKey: ['exams'] });
      qc.invalidateQueries({ queryKey: ['faculty-dashboard'] });
      toast.success(copy[action].success);
      if (action === 'delete') (opts.onDeleted ?? (() => navigate('/faculty/exams')))();
    } catch (err) {
      if (err instanceof ApiRequestError && err.details?.problems?.length) {
        setProblems({ action, list: err.details.problems });
      } else {
        toast.error(errorMessage(err));
      }
      throw err;
    }
  };

  const dialogs = (
    <>
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={copy[pending.action].title}
          description={copy[pending.action].describe(pending.target.title)}
          confirmLabel={copy[pending.action].confirm}
          destructive={copy[pending.action].destructive}
          onConfirm={() => run(pending.action, pending.target).catch(() => setPending(null))}
        />
      )}
      <ConfirmDialog
        open={!!problems}
        onOpenChange={(o) => !o && setProblems(null)}
        title={problems?.action === 'submit' ? "This exam isn't ready for review" : "This exam isn't ready to publish"}
        description={
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {problems?.list.map((p) => <li key={p}>{p}</li>)}
          </ul>
        }
        confirmLabel="Got it"
        onConfirm={() => undefined}
      />
    </>
  );

  return { request: (action: ExamAction, target: Target) => setPending({ action, target }), dialogs };
}

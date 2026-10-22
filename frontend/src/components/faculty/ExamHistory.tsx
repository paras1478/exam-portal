import { Archive, ArchiveRestore, Ban, CheckCircle2, EyeOff, History, Send, ShieldCheck, Undo2, XCircle, type LucideIcon } from 'lucide-react';
import type { ExamAction, ExamDetail } from '@/lib/types';
import { cn, formatDateTime, formatRelative, phaseLabel } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { EmptyState } from '@/components/common';

const meta: Record<ExamAction, { label: string; icon: LucideIcon; tone: string }> = {
  SUBMIT: { label: 'Submitted for approval', icon: ShieldCheck, tone: 'text-primary bg-primary/12' },
  WITHDRAW: { label: 'Withdrawn to draft', icon: Undo2, tone: 'text-muted-foreground bg-muted' },
  APPROVE: { label: 'Approved', icon: CheckCircle2, tone: 'text-success bg-success/12' },
  REJECT: { label: 'Rejected', icon: XCircle, tone: 'text-destructive bg-destructive/12' },
  PUBLISH: { label: 'Published', icon: Send, tone: 'text-secondary bg-secondary/12' },
  UNPUBLISH: { label: 'Unpublished', icon: EyeOff, tone: 'text-muted-foreground bg-muted' },
  CANCEL: { label: 'Cancelled', icon: Ban, tone: 'text-destructive bg-destructive/12' },
  ARCHIVE: { label: 'Archived', icon: Archive, tone: 'text-muted-foreground bg-muted' },
  RESTORE: { label: 'Restored', icon: ArchiveRestore, tone: 'text-primary bg-primary/12' },
};

const statusLabel = (s: string) => phaseLabel[s as keyof typeof phaseLabel] ?? s;

/** Immutable workflow timeline: every status change with its actor and reason. */
export function ExamHistory({ exam }: { exam: ExamDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Workflow history</CardTitle>
        <CardDescription>Created {formatDateTime(exam.createdAt)} by {exam.createdBy.name}. Every status change is recorded permanently.</CardDescription>
      </CardHeader>
      <CardContent>
        {exam.statusChanges.length === 0 ? (
          <EmptyState icon={History} title="No workflow activity yet" description="Status changes such as submission, approval and publication will appear here." />
        ) : (
          <ol className="relative space-y-5 border-l border-border pl-6">
            {exam.statusChanges.map((c) => {
              const m = meta[c.action] ?? { label: c.action, icon: History, tone: 'text-muted-foreground bg-muted' };
              const Icon = m.icon;
              return (
                <li key={c.id} className="relative">
                  <span className={cn('absolute -left-[37px] grid h-7 w-7 place-items-center rounded-full ring-4 ring-background', m.tone)}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {statusLabel(c.fromStatus)} → {statusLabel(c.toStatus)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.actor ? `${c.actor.name} (${c.actor.role.toLowerCase()})` : 'System'} ·{' '}
                    <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>{formatRelative(c.createdAt)}</time>
                  </p>
                  {c.reason && <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{c.reason}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

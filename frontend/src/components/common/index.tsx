import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Search, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, Input, Skeleton } from '@/components/ui/primitives';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/overlays';
import { errorMessage, type PageMeta } from '@/lib/api';
import type { ExamPhase, ResultStatus, UserStatus } from '@/lib/types';
import { cn, phaseLabel } from '@/lib/utils';

// ---------- Page header ----------
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Stat card ----------
const accentMap = {
  blue: 'from-[#4F8CFF]/25 to-[#4F8CFF]/5 text-[#4F8CFF]',
  violet: 'from-[#8B5CF6]/25 to-[#8B5CF6]/5 text-[#8B5CF6]',
  green: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  amber: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  rose: 'from-rose-500/25 to-rose-500/5 text-rose-500',
};

export function StatCard({ label, value, icon: Icon, hint, accent = 'blue', index = 0, to }: {
  label: string; value: ReactNode; icon: LucideIcon; hint?: ReactNode; accent?: keyof typeof accentMap; index?: number; to?: string;
}) {
  const body = (
    <Card className={cn('relative overflow-hidden p-5 h-full', to && 'transition-transform hover:-translate-y-0.5 hover:border-primary/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn('rounded-xl bg-gradient-to-br p-2.5', accentMap[accent])}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </Card>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05, duration: 0.3 }}>
      {to ? <Link to={to} className="block h-full rounded-2xl">{body}</Link> : body}
    </motion.div>
  );
}

export function StatCardSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-32" />
    </Card>
  );
}

// ---------- Empty / error / loading ----------
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: {
  icon?: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center', className)}>
      <div className="mb-4 rounded-2xl bg-gradient-to-br from-[#4F8CFF]/20 to-[#8B5CF6]/20 p-4">
        <Icon className="h-7 w-7 text-primary" aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <AlertTriangle className="mb-3 h-8 w-8 text-destructive" aria-hidden />
      <h3 className="font-semibold">Couldn&apos;t load this content</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4" role="status">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------- Confirm dialog ----------
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string;
  destructive?: boolean; onConfirm: () => Promise<unknown> | void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description && <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>}
        {children}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                /* caller shows the error toast; keep dialog open */
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- Search & pagination ----------
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative w-full sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9 pr-8" />
      {value && (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Pagination({ meta, onPageChange }: { meta?: PageMeta; onPageChange: (p: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <nav className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row" aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–<span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{meta.total}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft /> Prev
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {meta.page} / {meta.totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page">
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

// ---------- Status badges ----------
export function PhaseBadge({ phase }: { phase: ExamPhase }) {
  const variant = ({
    DRAFT: 'muted', PENDING_APPROVAL: 'warning', APPROVED: 'default', REJECTED: 'destructive', SCHEDULED: 'violet',
    LIVE: 'success', ENDED: 'outline', CANCELLED: 'destructive', ARCHIVED: 'muted',
  } as const)[phase];
  return (
    <Badge variant={variant}>
      {phase === 'LIVE' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden />}
      {phaseLabel[phase]}
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const variant = ({ ACTIVE: 'success', INACTIVE: 'muted', SUSPENDED: 'destructive' } as const)[status];
  return <Badge variant={variant}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export function ResultBadge({ status, passed, released = true }: { status: ResultStatus; passed?: boolean | null; released?: boolean }) {
  if (status === 'PENDING_REVIEW') return <Badge variant="warning">Pending review</Badge>;
  if (!released || passed === null || passed === undefined) return <Badge variant="muted">Awaiting release</Badge>;
  return passed ? <Badge variant="success">Passed</Badge> : <Badge variant="destructive">Failed</Badge>;
}

// ---------- Form field ----------
export function Field({ label, htmlFor, error, hint, children, required }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground/90">
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------- Decorative background ----------
export function BackgroundOrbs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="animate-orb absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full blur-3xl" style={{ background: 'radial-gradient(circle, var(--glow-blue), transparent 70%)' }} />
      <div className="animate-orb absolute -right-40 top-1/3 h-[32rem] w-[32rem] rounded-full blur-3xl" style={{ background: 'radial-gradient(circle, var(--glow-violet), transparent 70%)', animationDelay: '-6s' }} />
      <div className="animate-orb absolute bottom-[-10rem] left-1/3 h-[24rem] w-[24rem] rounded-full blur-3xl" style={{ background: 'radial-gradient(circle, var(--glow-blue), transparent 70%)', animationDelay: '-12s' }} />
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '28px 28px' }}
      />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-sm font-bold text-white shadow-[0_6px_20px_-6px_rgba(79,140,255,0.8)]">E</span>
      <span className="text-lg">
        Exam<span className="text-gradient">Flow</span>
      </span>
    </span>
  );
}

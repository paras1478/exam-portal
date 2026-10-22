import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, CheckCircle2, ClipboardList, Eye, FileBarChart, MoreHorizontal, Pencil, Send, XCircle, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { ExamStatus, ExamSummary } from '@/lib/types';
import { cn, formatDateTime, formatMinutes, formatRelative } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, PhaseBadge, SearchInput } from '@/components/common';
import { useUrlFilters } from '@/components/admin/helpers';
import { ACTION_COPY, ExamActionDialog, rowActions, type AdminExamAction } from '@/components/admin/examActions';

type Tab = ExamStatus | 'ALL';
const TABS: { value: Tab; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ARCHIVED', label: 'Archived' },
  { value: 'ALL', label: 'All' },
];

const SORTS = [
  { value: 'submittedForApprovalAt', label: 'Oldest submission first' },
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'startsAt', label: 'Starts soonest' },
  { value: '-startsAt', label: 'Starts latest' },
  { value: 'title', label: 'Title A–Z' },
];

const ACTION_ICON: Record<AdminExamAction, LucideIcon> = {
  APPROVE: CheckCircle2, REJECT: XCircle, PUBLISH: Send, CANCEL: Ban, ARCHIVE: Archive, RESTORE: ArchiveRestore,
};

interface AdminExamPage {
  data: ExamSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; statusCounts?: Partial<Record<ExamStatus, number>> };
}

export default function AdminExams() {
  useDocumentTitle('Exam approvals');
  const navigate = useNavigate();
  const { can } = useAuth();
  const [filters, setFilter] = useUrlFilters({ search: '', status: '', sort: '', page: '1' });
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== filters.search) setFilter('search', debounced);
  }, [debounced, filters.search, setFilter]);

  // Status counts come with every page; fetch them once to choose a sensible default tab.
  const counts = useQuery({
    queryKey: ['admin', 'exams', 'counts'],
    queryFn: async () => ((await api.page<ExamSummary>('/admin/exams', { pageSize: 1 })) as AdminExamPage).meta.statusCounts ?? {},
  });
  const tab: Tab = (filters.status as Tab) || ((counts.data?.PENDING_APPROVAL ?? 0) > 0 ? 'PENDING_APPROVAL' : 'ALL');
  const sort = filters.sort || (tab === 'PENDING_APPROVAL' ? 'submittedForApprovalAt' : '-createdAt');

  const query = {
    search: filters.search || undefined,
    status: tab === 'ALL' ? undefined : tab,
    sort,
    page: Number(filters.page) || 1,
    pageSize: 10,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'exams', query],
    queryFn: () => api.page<ExamSummary>('/admin/exams', query) as Promise<AdminExamPage>,
    placeholderData: keepPreviousData,
    enabled: !counts.isLoading || !!filters.status,
  });
  const statusCounts = data?.meta.statusCounts ?? counts.data ?? {};
  const totalCount = Object.values(statusCounts).reduce((s, n) => s + (n ?? 0), 0);

  const [target, setTarget] = useState<{ examId: string; title: string; action: AdminExamAction } | null>(null);
  const canAct: Record<AdminExamAction, boolean> = {
    APPROVE: can('exam:approve'), REJECT: can('exam:approve'), PUBLISH: can('exam:publish'),
    CANCEL: can('exam:cancel'), ARCHIVE: can('exam:archive'), RESTORE: can('exam:archive'),
  };

  const exams = data?.data ?? [];
  const actionsMenu = (e: ExamSummary) => {
    const actions = rowActions(e.status, e.phase).filter((a) => canAct[a]);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for ${e.title}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => navigate(`/admin/exams/${e.id}`)}><Eye /> Review details</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(`/faculty/exams/${e.id}`)}><Pencil /> Open in editor</DropdownMenuItem>
          {['PUBLISHED', 'ARCHIVED', 'CANCELLED'].includes(e.status) && (
            <DropdownMenuItem onSelect={() => navigate(`/faculty/exams/${e.id}/submissions`)}><FileBarChart /> Submissions</DropdownMenuItem>
          )}
          {actions.length > 0 && <DropdownMenuSeparator />}
          {actions.map((a) => {
            const Icon = ACTION_ICON[a];
            return (
              <DropdownMenuItem key={a} destructive={a === 'REJECT' || a === 'CANCEL'} onSelect={() => setTarget({ examId: e.id, title: e.title, action: a })}>
                <Icon /> {ACTION_COPY[a].confirm}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const quickApprove = (e: ExamSummary) =>
    e.status === 'PENDING_APPROVAL' && canAct.APPROVE ? (
      <Button size="sm" variant="success" onClick={() => setTarget({ examId: e.id, title: e.title, action: 'APPROVE' })}>
        <CheckCircle2 /> Approve
      </Button>
    ) : e.status === 'APPROVED' && canAct.PUBLISH ? (
      <Button size="sm" onClick={() => setTarget({ examId: e.id, title: e.title, action: 'PUBLISH' })}>
        <Send /> Publish
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        title="Examination approvals"
        description="Review submitted exams, approve or reject them, and manage schedules across the institution."
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-thin" role="tablist" aria-label="Exam status">
        {TABS.map((t) => {
          const count = t.value === 'ALL' ? totalCount : statusCounts[t.value] ?? 0;
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter('status', t.value)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                active ? 'border-primary/50 bg-primary/12 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs tabular-nums',
                  t.value === 'PENDING_APPROVAL' && count > 0 ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search title, subject or faculty" className="sm:max-w-sm" />
          <Select value={sort} onValueChange={(v) => setFilter('sort', v)}>
            <SelectTrigger className="sm:ml-auto sm:w-56" aria-label="Sort exams"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading || counts.isLoading ? (
          <ListSkeleton rows={6} />
        ) : exams.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={filters.search ? 'No exams match your search' : tab === 'PENDING_APPROVAL' ? 'Nothing waiting for approval' : 'No exams here'}
            description={tab === 'PENDING_APPROVAL' ? 'Exams submitted by faculty appear here for review.' : 'Try another tab or clear the search.'}
            action={filters.search ? <Button variant="outline" onClick={() => { setSearch(''); setFilter('search', ''); }}>Clear search</Button> : undefined}
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Exam</TableHead>
                    <TableHead>Faculty</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead className="text-right">Questions</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exams.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="max-w-xs">
                        <Link to={`/admin/exams/${e.id}`} className="font-medium hover:text-primary">{e.title}</Link>
                        <p className="text-xs text-muted-foreground">
                          {e.subject} · {formatMinutes(e.durationMinutes)} · {e.totalMarks} marks
                          {e.status === 'PENDING_APPROVAL' && e.submittedForApprovalAt && <> · submitted {formatRelative(e.submittedForApprovalAt)}</>}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.createdBy.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(e.startsAt)}<br />→ {formatDateTime(e.endsAt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.questionCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.attemptCount}</TableCell>
                      <TableCell><PhaseBadge phase={e.phase} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {quickApprove(e)}
                          <Button size="sm" variant="outline" asChild><Link to={`/admin/exams/${e.id}`}>Review</Link></Button>
                          {actionsMenu(e)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 lg:hidden">
              {exams.map((e) => (
                <li key={e.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/admin/exams/${e.id}`} className="font-medium hover:text-primary">{e.title}</Link>
                      <p className="text-xs text-muted-foreground">{e.subject} · {e.createdBy.name}</p>
                    </div>
                    <PhaseBadge phase={e.phase} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDateTime(e.startsAt)} · {formatMinutes(e.durationMinutes)} · {e.questionCount} questions · {e.attemptCount} attempts
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {quickApprove(e)}
                    <Button size="sm" variant="outline" asChild><Link to={`/admin/exams/${e.id}`}>Review</Link></Button>
                    <div className="ml-auto">{actionsMenu(e)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setFilter('page', String(p))} />
      </Card>

      <ExamActionDialog target={target} onOpenChange={(o) => !o && setTarget(null)} />
    </>
  );
}

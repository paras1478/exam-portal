import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, BarChart3, CalendarRange, ClipboardList, Clock, EyeOff, FileQuestion, History, MessageSquareWarning, MoreHorizontal, Pencil, Plus, Send,
  ShieldCheck, Trash2, Undo2, Users, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ExamSummary } from '@/lib/types';
import { formatDateTime, formatMinutes, formatScore } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, PhaseBadge, SearchInput } from '@/components/common';
import { actionLabel, facultyActions, guessActions, useExamActions, type ExamAction } from '@/components/faculty/useExamActions';

const ALL = 'all';

const menuIcon: Record<ExamAction, LucideIcon> = {
  submit: ShieldCheck, withdraw: Undo2, publish: Send, unpublish: EyeOff, archive: Archive, restore: ArchiveRestore, delete: Trash2,
};

function ExamActionsMenu({ exam, request, requireApproval }: { exam: ExamSummary; request: ReturnType<typeof useExamActions>['request']; requireApproval: boolean }) {
  const navigate = useNavigate();
  const target = { id: exam.id, title: exam.title };
  // Prefer the actions the server reports for this row; fall back to a conservative guess.
  const canDelete = (exam.status === 'DRAFT' || exam.status === 'REJECTED') && exam.attemptCount === 0;
  const actions = exam.allowedActions
    ? [...facultyActions(exam.allowedActions), ...(canDelete ? (['delete'] as const) : [])]
    : guessActions(exam.status, exam.attemptCount, requireApproval, new Date(exam.endsAt) < new Date());
  const workflow = actions.filter((a) => a !== 'delete');
  const editable = exam.status === 'DRAFT' || exam.status === 'REJECTED' || exam.status === 'PUBLISHED' || exam.status === 'APPROVED';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${exam.title}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/faculty/exams/${exam.id}`)}>
          <Pencil /> {editable ? 'Edit' : 'View'}
        </DropdownMenuItem>
        {(exam.status === 'PUBLISHED' || exam.status === 'ARCHIVED' || exam.status === 'CANCELLED') && (
          <DropdownMenuItem onSelect={() => navigate(`/faculty/exams/${exam.id}/submissions`)}>
            <BarChart3 /> Submissions
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate(`/faculty/exams/${exam.id}?tab=history`)}>
          <History /> History
        </DropdownMenuItem>
        {workflow.length > 0 && <DropdownMenuSeparator />}
        {workflow.map((a) => {
          const Icon = menuIcon[a];
          return (
            <DropdownMenuItem key={a} onSelect={() => request(a, target)}>
              <Icon /> {a === 'submit' && exam.status === 'REJECTED' ? 'Resubmit for approval' : actionLabel[a]}
            </DropdownMenuItem>
          );
        })}
        {actions.includes('delete') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => request('delete', target)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function FacultyExams() {
  useDocumentTitle('My exams');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const status = params.get('status') ?? ALL;
  const phase = params.get('phase') ?? ALL;
  const sort = params.get('sort') ?? '-createdAt';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['exams', { page, status, phase, sort, q: debounced }],
    queryFn: () =>
      api.page<ExamSummary>('/exams', {
        page,
        pageSize: 10,
        search: debounced,
        status: status === ALL ? undefined : status,
        phase: phase === ALL ? undefined : phase,
        sort,
      }),
    placeholderData: keepPreviousData,
  });

  const { request, dialogs } = useExamActions({ onDeleted: () => refetch() });
  const filtered = !!debounced || status !== ALL || phase !== ALL;

  return (
    <div>
      <PageHeader
        title={user?.role === 'ADMIN' ? 'Exam workspace' : 'My exams'}
        description={
          user?.policy.requireExamApproval
            ? 'Create and schedule examinations. Exams are published after administrator approval.'
            : 'Create, schedule and publish your examinations.'
        }
        actions={
          <Button asChild>
            <Link to="/faculty/exams/new"><Plus /> New exam</Link>
          </Button>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by title or subject" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:ml-auto lg:flex">
            <Select value={status} onValueChange={(v) => update({ status: v, phase: v !== ALL && v !== 'PUBLISHED' ? null : phase })}>
              <SelectTrigger className="lg:w-44" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={phase} onValueChange={(v) => update({ phase: v, status: v !== ALL ? null : status })}>
              <SelectTrigger className="lg:w-40" aria-label="Filter by schedule"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any schedule</SelectItem>
                <SelectItem value="SCHEDULED">Upcoming</SelectItem>
                <SelectItem value="LIVE">Live</SelectItem>
                <SelectItem value="ENDED">Ended</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => update({ sort: v })}>
              <SelectTrigger className="lg:w-44" aria-label="Sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="-createdAt">Newest first</SelectItem>
                <SelectItem value="createdAt">Oldest first</SelectItem>
                <SelectItem value="startsAt">Start time ↑</SelectItem>
                <SelectItem value="-startsAt">Start time ↓</SelectItem>
                <SelectItem value="title">Title A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <ListSkeleton rows={6} />
        ) : data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No exams match your filters"
              description="Try a different search term or clear the filters."
              action={<Button variant="outline" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Create your first exam"
              description="Set up the schedule, add questions and publish it to your students."
              action={<Button asChild><Link to="/faculty/exams/new"><Plus /> Create your first exam</Link></Button>}
            />
          )
        ) : (
          <ul className={`space-y-3 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
            {data.data.map((exam) => (
              <li key={exam.id} className="rounded-xl border border-border bg-background/30 p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/faculty/exams/${exam.id}`} className="truncate font-semibold hover:text-primary">
                        {exam.title}
                      </Link>
                      <PhaseBadge phase={exam.phase} />
                      <Badge variant="muted">{exam.subject}</Badge>
                      {exam.resultsPublishedAt && <Badge variant="success">Results published</Badge>}
                    </div>
                    {exam.status === 'REJECTED' && exam.reviewNote && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
                        <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="line-clamp-2">Changes requested: {exam.reviewNote}</span>
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> {formatDateTime(exam.startsAt)} – {formatDateTime(exam.endsAt)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {formatMinutes(exam.durationMinutes)}</span>
                      <span className="inline-flex items-center gap-1.5"><FileQuestion className="h-3.5 w-3.5" /> {exam.questionCount} questions · {formatScore(exam.totalMarks)} marks</span>
                      <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {exam.attemptCount} attempts</span>
                      {user?.role === 'ADMIN' && <span>By {exam.createdBy.name}</span>}
                    </div>
                  </div>
                  <ExamActionsMenu exam={exam} request={request} requireApproval={user?.policy.requireExamApproval ?? true} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => update({ page: String(p) })} />
      </Card>
      {dialogs}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Eye, FileBarChart, Send } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AdminResultRow, ExamSummary } from '@/lib/types';
import { cn, formatDateTime, formatPercent, formatScore } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { ConfirmDialog, EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, ResultBadge, SearchInput } from '@/components/common';
import { ALL, orUndefined, useUrlFilters } from '@/components/admin/helpers';

const PUBLICATION_TABS = [
  { value: 'awaiting', label: 'Awaiting publication' },
  { value: 'released', label: 'Released' },
  { value: ALL, label: 'All results' },
];

function ReleaseBadge({ r }: { r: AdminResultRow }) {
  if (r.exam.status === 'CANCELLED') return <Badge variant="destructive">Exam cancelled</Badge>;
  if (r.released) return <Badge variant="success">Released</Badge>;
  if (r.status === 'PENDING_REVIEW') return <Badge variant="muted">Not gradable yet</Badge>;
  return <Badge variant="warning">Awaiting</Badge>;
}

/** Lets the confirm dialog close for benign conflicts (already handled with an info toast). */
const ignoreCodes = (...codes: string[]) => (e: unknown) => {
  if (e instanceof ApiRequestError && codes.includes(e.code)) return;
  throw e;
};

export default function AdminResults() {
  useDocumentTitle('Results');
  const qc = useQueryClient();
  const { can } = useAuth();
  const canPublish = can('result:publish');
  const [filters, setFilter] = useUrlFilters({ search: '', publication: 'awaiting', status: ALL, examId: ALL, page: '1' });
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== filters.search) setFilter('search', debounced);
  }, [debounced, filters.search, setFilter]);

  const query = {
    search: filters.search || undefined,
    publication: orUndefined(filters.publication),
    status: orUndefined(filters.status),
    examId: orUndefined(filters.examId),
    page: Number(filters.page) || 1,
    pageSize: 10,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'results', query],
    queryFn: () => api.page<AdminResultRow>('/admin/results', query),
    placeholderData: keepPreviousData,
  });
  const exams = useQuery({
    queryKey: ['admin', 'exams', 'options'],
    queryFn: () => api.page<ExamSummary>('/admin/exams', { pageSize: 100, sort: '-startsAt' }),
    select: (r) => r.data.filter((e) => ['PUBLISHED', 'ARCHIVED', 'CANCELLED'].includes(e.status)),
  });
  const selectedExam = exams.data?.find((e) => e.id === query.examId);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    void qc.invalidateQueries({ queryKey: ['exams'] });
  };

  const [publishTarget, setPublishTarget] = useState<AdminResultRow | null>(null);
  const publishOne = useMutation({
    mutationFn: (r: AdminResultRow) => api.patch(`/admin/results/${r.id}/publish`),
    onSuccess: (_d, r) => {
      toast.success(`Result published for ${r.student.name}`);
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === 'ALREADY_PUBLISHED') {
        toast.info('This result was already published.');
        invalidate();
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const [bulkOpen, setBulkOpen] = useState(false);
  const publishAll = useMutation({
    mutationFn: (examId: string) => api.patch<{ notified: number; pendingReview: number }>(`/admin/exams/${examId}/results/publish`),
    onSuccess: (r) => {
      toast.success(
        `Published ${r.notified} result${r.notified === 1 ? '' : 's'}` + (r.pendingReview ? ` · ${r.pendingReview} still awaiting descriptive grading` : ''),
      );
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === 'NOTHING_TO_PUBLISH') {
        toast.info('Every graded result for this exam is already published.');
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const results = data?.data ?? [];
  const canPublishRow = (r: AdminResultRow) => canPublish && r.status === 'GRADED' && !r.released && r.exam.status !== 'CANCELLED';
  const hasFilters = !!(filters.search || query.status || query.examId);

  const rowActions = (r: AdminResultRow) => (
    <div className="flex items-center justify-end gap-1">
      {canPublishRow(r) && (
        <Button size="sm" onClick={() => setPublishTarget(r)}>
          <Send /> Publish
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <Link to={`/admin/results/${r.id}`}><Eye /> View</Link>
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Results verification"
        description="Verify graded results and publish them to students. Descriptive answers must be graded first."
        actions={
          selectedExam && canPublish ? (
            <Button onClick={() => setBulkOpen(true)} disabled={selectedExam.status === 'CANCELLED'}>
              <BadgeCheck /> Publish all graded results for this exam
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-thin" role="tablist" aria-label="Publication state">
        {PUBLICATION_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={filters.publication === t.value}
            onClick={() => setFilter('publication', t.value)}
            className={cn(
              'shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
              filters.publication === t.value ? 'border-primary/50 bg-primary/12 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search student or exam" className="lg:max-w-xs" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:ml-auto lg:flex">
            <Select value={filters.examId} onValueChange={(v) => setFilter('examId', v)}>
              <SelectTrigger className="lg:w-64" aria-label="Filter by exam"><SelectValue placeholder="All exams" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All exams</SelectItem>
                {exams.data?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.title}{e.status !== 'PUBLISHED' ? ` (${e.status.toLowerCase()})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilter('status', v)}>
              <SelectTrigger className="lg:w-44" aria-label="Filter by grading status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any grading status</SelectItem>
                <SelectItem value="GRADED">Fully graded</SelectItem>
                <SelectItem value="PENDING_REVIEW">Pending review</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : results.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title={filters.publication === 'awaiting' && !hasFilters ? 'Nothing awaiting publication' : 'No results found'}
            description={
              filters.publication === 'awaiting' && !hasFilters
                ? 'Graded results that students cannot see yet appear here for verification.'
                : 'Try a different tab, exam or search term.'
            }
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Student</TableHead>
                    <TableHead>Exam</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">%</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>Published</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-medium">{r.student.name}</p>
                        <p className="text-xs text-muted-foreground">{r.student.email}</p>
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        <p className="truncate">{r.exam.title}</p>
                        <p className="text-xs text-muted-foreground">{r.exam.subject}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatScore(r.totalScore)} / {formatScore(r.maxScore)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.status === 'GRADED' ? formatPercent(r.percentage) : '—'}</TableCell>
                      <TableCell><ResultBadge status={r.status} passed={r.passed} /></TableCell>
                      <TableCell><ReleaseBadge r={r} /></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.publishedAt ? formatDateTime(r.publishedAt) : '—'}</TableCell>
                      <TableCell>{rowActions(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-3 lg:hidden">
              {results.map((r) => (
                <li key={r.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{r.student.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.exam.title}</p>
                    </div>
                    <p className="text-right text-sm font-semibold tabular-nums">
                      {formatScore(r.totalScore)}/{formatScore(r.maxScore)}
                      <span className="block text-xs font-normal text-muted-foreground">{r.status === 'GRADED' ? formatPercent(r.percentage) : 'pending'}</span>
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ResultBadge status={r.status} passed={r.passed} />
                    <ReleaseBadge r={r} />
                  </div>
                  <div className="mt-3">{rowActions(r)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setFilter('page', String(p))} />
      </Card>

      <ConfirmDialog
        open={!!publishTarget}
        onOpenChange={(o) => !o && setPublishTarget(null)}
        title="Verify and publish result?"
        description={
          publishTarget ? (
            <>
              <span className="font-medium text-foreground">{publishTarget.student.name}</span> will be able to see their score of{' '}
              {formatScore(publishTarget.totalScore)} / {formatScore(publishTarget.maxScore)} for “{publishTarget.exam.title}” and is notified.
              Publication is recorded in the audit log.
            </>
          ) : undefined
        }
        confirmLabel="Publish result"
        onConfirm={() => publishOne.mutateAsync(publishTarget!).catch(ignoreCodes('ALREADY_PUBLISHED'))}
      />
      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Publish all graded results?"
        description={
          selectedExam ? (
            <>Every fully graded, unpublished result of “{selectedExam.title}” is published and the students are notified. Results still awaiting descriptive grading stay hidden.</>
          ) : undefined
        }
        confirmLabel="Publish results"
        onConfirm={() => publishAll.mutateAsync(selectedExam!.id).catch(ignoreCodes('NOTHING_TO_PUBLISH'))}
      />
    </>
  );
}

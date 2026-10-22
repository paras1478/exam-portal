import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, FileBarChart } from 'lucide-react';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { StudentResultRow } from '@/lib/types';
import { formatDateTime, formatPercent, formatScore } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, ResultBadge, SearchInput } from '@/components/common';

function StatusBadge({ row }: { row: StudentResultRow }) {
  if (row.examCancelled) return <Badge variant="destructive">Exam cancelled</Badge>;
  return <ResultBadge status={row.resultStatus} passed={row.passed} released={row.released} />;
}

export default function StudentResults() {
  useDocumentTitle('Results');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student', 'results', { page, search: debounced }],
    queryFn: () => api.page<StudentResultRow>('/student/results', { page, pageSize: 10, search: debounced }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Results" description="Your examination history and scores." />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by exam title"
          />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : !data?.data.length ? (
          <EmptyState
            icon={FileBarChart}
            title={debounced ? 'No results match your search' : 'No submitted exams yet'}
            description={debounced ? 'Try a different exam title.' : 'Once you submit an exam, it will appear here.'}
            action={
              !debounced && (
                <Button asChild>
                  <Link to="/student/exams">Browse exams</Link>
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exam</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Percentage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="sr-only">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((r) => (
                    <TableRow key={r.attemptId}>
                      <TableCell>
                        <Link to={`/student/results/${r.attemptId}`} className="font-medium hover:text-primary">
                          {r.exam.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {r.exam.subject} · Attempt {r.attemptNumber}
                          {r.submissionType === 'AUTO_TIMEOUT' && ' · auto-submitted'}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.submittedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.released ? `${formatScore(r.score)} / ${formatScore(r.maxScore)}` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(r.percentage)}</TableCell>
                      <TableCell>
                        <StatusBadge row={r} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/student/results/${r.attemptId}`} aria-label={`View result for ${r.exam.title}`}>
                            View <ChevronRight />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {data.data.map((r) => (
                <Link key={r.attemptId} to={`/student/results/${r.attemptId}`} className="block rounded-xl border border-border p-4 hover:border-primary/40">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{r.exam.title}</p>
                    <StatusBadge row={r} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.exam.subject} · {formatDateTime(r.submittedAt)}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {r.released ? (
                      <>
                        <span className="text-lg font-semibold tabular-nums">{formatPercent(r.percentage)}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatScore(r.score)} / {formatScore(r.maxScore)}
                        </span>
                      </>
                    ) : r.examCancelled ? (
                      <span className="text-sm text-muted-foreground">No result is issued for a cancelled exam</span>
                    ) : (
                      <Badge variant="muted">Score not yet released</Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

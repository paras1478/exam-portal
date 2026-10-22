import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BookOpenCheck } from 'lucide-react';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { StudentExamCard } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Card, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, Pagination, SearchInput } from '@/components/common';
import { ExamCard } from '@/components/student/ExamCard';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
] as const;

const SORTS = [
  { value: 'startsAt', label: 'Start date (soonest)' },
  { value: '-startsAt', label: 'Start date (latest)' },
  { value: 'title', label: 'Title (A–Z)' },
];

const ALL_SUBJECTS = '__all__';

export default function StudentExams() {
  useDocumentTitle('Examinations');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const subject = params.get('subject') ?? '';
  const sort = params.get('sort') ?? 'startsAt';
  const page = Number(params.get('page') ?? '1') || 1;
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounce(search);

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || (k === 'tab' && v === 'all') || (k === 'sort' && v === 'startsAt')) next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('search') ?? '') !== debounced) update({ search: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const subjects = useQuery({ queryKey: ['student', 'subjects'], queryFn: () => api.get<string[]>('/student/subjects'), staleTime: 5 * 60_000 });
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['student', 'exams', { tab, subject, sort, page, search: debounced }],
    queryFn: () => api.page<StudentExamCard>('/student/exams', { tab, subject, sort, page, pageSize: 9, search: debounced }),
    placeholderData: keepPreviousData,
  });

  const hasFilters = !!(debounced || subject || tab !== 'all');

  return (
    <div>
      <PageHeader title="Examinations" description="Browse, filter and start your available exams." />

      <Card className="mb-6 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => update({ tab: v })}>
          <TabsList aria-label="Exam status">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search title or subject" />
          <Select value={subject || ALL_SUBJECTS} onValueChange={(v) => update({ subject: v === ALL_SUBJECTS ? null : v })}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by subject">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>All subjects</SelectItem>
              {subjects.data?.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => update({ sort: v })}>
            <SelectTrigger className="sm:w-48" aria-label="Sort exams">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-8 w-full" />
            </Card>
          ))}
        </div>
      ) : data?.data.length ? (
        <>
          <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
            {data.data.map((e, i) => (
              <ExamCard key={e.id} exam={e} index={i} />
            ))}
          </div>
          <Pagination meta={data.meta} onPageChange={(p) => update({ page: String(p) }, false)} />
        </>
      ) : (
        <EmptyState
          icon={BookOpenCheck}
          title={hasFilters ? 'No exams match your filters' : 'No exams available yet'}
          description={hasFilters ? 'Try a different tab, subject or search term.' : 'Published exams will appear here.'}
          action={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

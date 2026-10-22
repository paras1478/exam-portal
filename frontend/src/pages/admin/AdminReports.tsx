import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { BarChart3, CheckCircle2, ClipboardList, Download, FileBarChart, Hourglass, Percent, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { ResultsReport } from '@/lib/types';
import { formatDate, formatPercent, formatScore } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, PhaseBadge, StatCard, StatCardSkeleton } from '@/components/common';
import { ALL, orUndefined, useUrlFilters } from '@/components/admin/helpers';

const dayBound = (v: string, end: boolean) => (v ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

const EXPORTS = [
  { type: 'results', label: 'Results (per student)', file: 'results.csv' },
  { type: 'exam-summary', label: 'Exam summary', file: 'exam-summary.csv' },
  { type: 'exams', label: 'Examinations', file: 'exams.csv' },
  { type: 'users', label: 'Users', file: 'users.csv' },
  { type: 'audit-logs', label: 'Audit logs', file: 'audit-logs.csv' },
] as const;

export default function AdminReports() {
  useDocumentTitle('Reports');
  const { can } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilter] = useUrlFilters({ from: '', to: '', subject: ALL });
  const query = { from: dayBound(filters.from, false), to: dayBound(filters.to, true), subject: orUndefined(filters.subject) };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'reports', 'results', query],
    queryFn: () => api.get<ResultsReport>('/admin/reports/results', query),
    placeholderData: keepPreviousData,
  });
  const [exporting, setExporting] = useState<string | null>(null);

  const doExport = async (type: (typeof EXPORTS)[number]['type'], file: string) => {
    setExporting(type);
    try {
      // Users ignore the date/subject filters on the server; audit logs use only the date range.
      await api.download('/admin/reports/export', file, { type, ...query });
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const chartData = (data?.subjects ?? []).map((s) => ({ subject: s.subject, average: s.averagePercentage ?? 0, passRate: s.passRate ?? 0 }));

  return (
    <>
      <PageHeader title="Reports" description="Result statistics across examinations, with CSV exports for further analysis." />

      <Card className="mb-6 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground/90">Exams starting from</span>
            <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className="lg:w-44" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground/90">to</span>
            <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className="lg:w-44" />
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground/90">Subject</span>
            <Select value={filters.subject} onValueChange={(v) => setFilter('subject', v)}>
              <SelectTrigger className="lg:w-56" aria-label="Filter by subject"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All subjects</SelectItem>
                {data?.availableSubjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(filters.from || filters.to || filters.subject !== ALL) && (
            <Button variant="ghost" onClick={() => navigate({ search: '' }, { replace: true })}>Clear filters</Button>
          )}
        </div>
        {can('report:export') && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium">Export CSV (uses the filters above where applicable)</p>
            <div className="flex flex-wrap gap-2">
              {EXPORTS.map((e) => (
                <Button key={e.type} variant="outline" size="sm" loading={exporting === e.type} disabled={!!exporting && exporting !== e.type} onClick={() => void doExport(e.type, e.file)}>
                  <Download /> {e.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className={isFetching && !isLoading ? 'space-y-6 opacity-70 transition-opacity' : 'space-y-6 transition-opacity'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {isLoading || !data ? (
              Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard index={0} label="Exams" value={data.totals.exams} icon={ClipboardList} accent="blue" />
                <StatCard index={1} label="Submissions" value={data.totals.submissions} icon={Users} accent="violet" />
                <StatCard index={2} label="Graded" value={data.totals.graded} icon={CheckCircle2} accent="green" hint={`${data.totals.pendingReview} pending review`} />
                <StatCard index={3} label="Average score" value={formatPercent(data.totals.averagePercentage)} icon={Percent} accent="amber" />
                <StatCard index={4} label="Pass rate" value={formatPercent(data.totals.passRate)} icon={Hourglass} accent="rose" />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By subject</CardTitle>
              <CardDescription>Average percentage and pass rate of graded results</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading || !data ? (
                <Skeleton className="h-64 w-full" />
              ) : chartData.length === 0 ? (
                <EmptyState icon={BarChart3} title="No graded results in this range" description="Adjust the date range or subject filter." />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="subject" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                      <ChartTooltip
                        cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                        content={({ active, payload, label }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg border border-border bg-card-solid px-3 py-2 text-xs shadow-lg">
                              <p className="font-medium">{String(label)}</p>
                              {payload.map((p) => <p key={String(p.dataKey)} className="text-muted-foreground">{p.name}: {Number(p.value).toFixed(1)}%</p>)}
                            </div>
                          ) : null
                        }
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="average" name="Average %" fill="#4F8CFF" radius={[6, 6, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="passRate" name="Pass rate %" fill="#8B5CF6" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Per examination</CardTitle>
              <CardDescription>Published, archived and cancelled exams in the selected range</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading || !data ? (
                <ListSkeleton rows={5} />
              ) : data.rows.length === 0 ? (
                <EmptyState icon={FileBarChart} title="No exams in this range" description="Only exams that have been published appear in reports." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Exam</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Submissions</TableHead>
                      <TableHead className="text-right">Graded</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Released</TableHead>
                      <TableHead className="text-right">Avg %</TableHead>
                      <TableHead className="text-right">Pass rate</TableHead>
                      <TableHead className="text-right">High / Low</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.examId}>
                        <TableCell className="min-w-[14rem]">
                          <Link to={`/faculty/exams/${r.examId}/submissions`} className="font-medium hover:text-primary">{r.title}</Link>
                          <p className="text-xs text-muted-foreground">{r.subject} · {r.faculty} · {formatDate(r.startsAt)}</p>
                        </TableCell>
                        <TableCell><PhaseBadge phase={r.phase} /></TableCell>
                        <TableCell className="text-right tabular-nums">{r.submissions}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.graded}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.pendingReview}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.released}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(r.averagePercentage)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(r.passRate)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {r.highestScore === null ? '—' : `${formatScore(r.highestScore)} / ${formatScore(r.lowestScore)}`}
                          <span className="text-xs text-muted-foreground"> of {r.totalMarks}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

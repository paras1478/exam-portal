import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Download, Eye, EyeOff, Hourglass, Info, Megaphone, Pencil, Percent, Timer, Trophy, Users, UsersRound } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { ExamAttemptRow, ExamDetail, ExamStats } from '@/lib/types';
import { formatDateTime, formatPercent, formatScore } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import {
  ConfirmDialog, EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, PhaseBadge, ResultBadge, SearchInput, StatCard, StatCardSkeleton,
} from '@/components/common';

const ALL = 'all';
const tooltipStyle = { background: 'var(--card-solid)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--foreground)', fontSize: 12 };
const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };

const releaseCopy = {
  IMMEDIATE: 'Results release immediately once graded.',
  AFTER_END: 'Results release automatically when the exam window closes.',
  MANUAL: 'Results stay hidden until they are published.',
};

export default function ExamSubmissions() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const status = params.get('status') ?? ALL;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounce(search);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { can } = useAuth();
  const canPublish = can('result:publish');
  const canExport = can('report:export');

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) setParam({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const examQ = useQuery({ queryKey: ['exam', examId], queryFn: () => api.get<ExamDetail>(`/exams/${examId}`) });
  const statsQ = useQuery({ queryKey: ['exam-stats', examId], queryFn: () => api.get<ExamStats>(`/exams/${examId}/stats`) });
  const attemptsQ = useQuery({
    queryKey: ['exam-attempts', examId, { page, status, q: debounced }],
    queryFn: () => api.page<ExamAttemptRow>(`/exams/${examId}/attempts`, { page, pageSize: 10, search: debounced, status: status === ALL ? undefined : status }),
    placeholderData: keepPreviousData,
  });
  const exam = examQ.data;
  const stats = statsQ.data;
  useDocumentTitle(exam ? `Submissions · ${exam.title}` : 'Submissions');

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download(`/exams/${examId}/results/export`, 'results.csv');
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const publishResults = async () => {
    try {
      const res = await api.post<{ resultsPublishedAt: string; notified: number; pendingReview: number }>(`/exams/${examId}/results/publish`);
      toast.success(`Results published — ${res.notified} student${res.notified === 1 ? '' : 's'} notified`, {
        description: res.pendingReview ? `${res.pendingReview} attempt(s) still need grading and will appear once graded.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ['exam', examId] });
      qc.invalidateQueries({ queryKey: ['exam-stats', examId] });
      qc.invalidateQueries({ queryKey: ['exam-attempts', examId] });
      qc.invalidateQueries({ queryKey: ['exams'] });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NOTHING_TO_PUBLISH') {
        // Not a failure: everything graded is already visible to students.
        toast.info('All graded results are already published', { description: 'Newly graded attempts can be published once grading finishes.' });
        return;
      }
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const publishable = !!exam && (exam.status === 'PUBLISHED' || exam.status === 'ARCHIVED');

  if (examQ.error) {
    return (
      <div>
        <PageHeader title="Submissions" back={{ to: '/faculty/exams', label: 'All exams' }} />
        <ErrorState error={examQ.error} onRetry={() => examQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: exam ? `/faculty/exams/${exam.id}` : '/faculty/exams', label: 'Back to exam' }}
        title={exam ? exam.title : 'Submissions'}
        description={
          exam && (
            <span className="flex flex-wrap items-center gap-2">
              <PhaseBadge phase={exam.phase} />
              <span>{releaseCopy[exam.resultRelease]}</span>
              {exam.resultsPublishedAt && <Badge variant="success">Published {formatDateTime(exam.resultsPublishedAt)}</Badge>}
            </span>
          )
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/faculty/exams/${examId}`}><Pencil /> Edit exam</Link>
            </Button>
            {canExport && <Button variant="outline" onClick={exportCsv} loading={exporting}><Download /> Export CSV</Button>}
            {canPublish && (
              <Button onClick={() => setConfirmPublish(true)} disabled={!publishable}>
                <Megaphone /> {exam?.resultsPublishedAt ? 'Publish new results' : 'Publish results'}
              </Button>
            )}
          </>
        }
      />

      {exam?.status === 'CANCELLED' && (
        <div role="status" className="flex gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>This exam was cancelled{exam.reviewNote ? `: ${exam.reviewNote}` : ''}. Its results are never released to students.</p>
        </div>
      )}
      {!canPublish && exam?.status !== 'CANCELLED' && exam?.resultRelease === 'MANUAL' && (
        <div role="status" className="flex gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <span className="font-medium">Results are published by an administrator.</span>{' '}
            <span className="text-muted-foreground">Finish grading descriptive answers; an administrator verifies and publishes the results.</span>
          </p>
        </div>
      )}

      {statsQ.error ? (
        <ErrorState error={statsQ.error} onRetry={() => statsQ.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {!stats ? (
            Array.from({ length: 10 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard index={0} label="Participants" value={stats.participants} icon={UsersRound} />
              <StatCard index={1} label="Submissions" value={stats.submissions} icon={Users} accent="violet" />
              <StatCard index={2} label="In progress" value={stats.inProgress} icon={Timer} accent="blue" />
              <StatCard index={3} label="Pending review" value={stats.pendingReview} icon={Hourglass} accent={stats.pendingReview ? 'amber' : 'green'} hint={stats.pendingReview ? 'Descriptive answers to grade' : 'Nothing to grade'} />
              <StatCard index={4} label="Released" value={stats.released} icon={Eye} accent="green" hint="Visible to students" />
              <StatCard
                index={5}
                label="Awaiting publication"
                value={stats.awaitingPublication}
                icon={EyeOff}
                accent={stats.awaitingPublication ? 'amber' : 'green'}
                hint={stats.awaitingPublication ? (canPublish ? 'Graded, ready to publish' : 'Waiting for an administrator') : 'Nothing waiting'}
              />
              <StatCard index={6} label="Average score" value={formatPercent(stats.averagePercentage)} icon={Percent} accent="violet" />
              <StatCard index={7} label="Pass rate" value={formatPercent(stats.passRate)} icon={Trophy} accent="green" />
              <StatCard index={8} label="Highest" value={`${formatScore(stats.highestScore)} / ${formatScore(stats.totalMarks)}`} icon={ArrowUpRight} accent="green" />
              <StatCard index={9} label="Lowest" value={`${formatScore(stats.lowestScore)} / ${formatScore(stats.totalMarks)}`} icon={ArrowDownRight} accent="rose" />
            </>
          )}
        </div>
      )}

      {stats && stats.submissions > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Score distribution</CardTitle>
              <CardDescription>Graded attempts by percentage band</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64" role="img" aria-label="Histogram of scores by percentage band">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.distribution} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="range" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                    <ChartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)', opacity: 0.4 }} labelFormatter={(l) => `${l}%`} />
                    <Bar dataKey="count" name="Students" fill="#4F8CFF" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Question accuracy</CardTitle>
              <CardDescription>Share of answered attempts that got each objective question right</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64" role="img" aria-label="Correct answer rate per question">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.questionStats.map((q) => ({ ...q, label: `Q${q.order}`, rate: q.correctRate ?? 0 }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} unit="%" tick={axisTick} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      contentStyle={tooltipStyle}
                      cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                      formatter={(_v, _n, item) => {
                        const p = item.payload as ExamStats['questionStats'][number];
                        return [p.correctRate === null ? 'Manually graded' : `${p.correctRate}% correct (${p.answered} answered)`, p.text];
                      }}
                    />
                    <Bar dataKey="rate" name="Correct %" radius={[6, 6, 0, 0]}>
                      {stats.questionStats.map((q) => (
                        <Cell key={q.questionId} fill={q.correctRate === null ? 'var(--muted-foreground)' : '#8B5CF6'} fillOpacity={q.correctRate === null ? 0.3 : 1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Attempts</CardTitle>
            <CardDescription>Open an attempt to review answers and grade descriptive questions.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or roll no." />
            <Select value={status} onValueChange={(v) => setParam({ status: v })}>
              <SelectTrigger className="sm:w-44" aria-label="Filter attempts"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All attempts</SelectItem>
                <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="PENDING_REVIEW">Pending review</SelectItem>
                <SelectItem value="GRADED">Graded</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {attemptsQ.error ? (
            <ErrorState error={attemptsQ.error} onRetry={() => attemptsQ.refetch()} />
          ) : !attemptsQ.data ? (
            <ListSkeleton rows={5} />
          ) : attemptsQ.data.data.length === 0 ? (
            <EmptyState
              icon={Users}
              title={debounced || status !== ALL ? 'No attempts match' : 'No attempts yet'}
              description={debounced || status !== ALL ? 'Try another search or filter.' : 'Attempts appear here as soon as students start the exam.'}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Released</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attemptsQ.data.data.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/faculty/attempts/${a.id}`)}
                  >
                    <TableCell>
                      <Link to={`/faculty/attempts/${a.id}`} className="font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                        {a.student.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.student.studentProfile?.rollNumber ?? a.student.email}</p>
                    </TableCell>
                    <TableCell className="tabular-nums">#{a.attemptNumber}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {a.submittedAt ? formatDateTime(a.submittedAt) : <span className="text-muted-foreground">—</span>}
                      {a.submissionType === 'AUTO_TIMEOUT' && <Badge variant="muted" className="ml-2">Auto</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.result ? (
                        <>
                          <span className="font-semibold">{formatScore(a.result.totalScore)}</span>
                          <span className="text-muted-foreground"> / {formatScore(a.result.maxScore)}</span>
                          <p className="text-xs text-muted-foreground">{formatPercent(a.result.percentage)}</p>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {a.status === 'IN_PROGRESS' ? <Badge variant="default">In progress</Badge> : a.result ? <ResultBadge status={a.result.status} passed={a.result.passed} /> : <Badge variant="muted">Submitted</Badge>}
                    </TableCell>
                    <TableCell>
                      {a.released ? (
                        <Badge variant="success"><Eye className="h-3 w-3" /> Visible</Badge>
                      ) : a.result?.status === 'GRADED' ? (
                        <Badge variant="warning"><EyeOff className="h-3 w-3" /> Awaiting</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination meta={attemptsQ.data?.meta} onPageChange={(p) => setParam({ page: String(p) })} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={exam?.resultsPublishedAt ? 'Publish newly graded results?' : 'Publish results?'}
        description={
          <>
            Students with fully graded, unpublished attempts will be able to see their scores and will be notified.
            {stats?.pendingReview ? ` ${stats.pendingReview} attempt(s) still need grading; those students see their result once you finish grading.` : ''}
          </>
        }
        confirmLabel="Publish results"
        onConfirm={publishResults}
      />
    </div>
  );
}

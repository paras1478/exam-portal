import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, ClipboardCheck, ClipboardList, FilePen, Hourglass, Plus, Radio, ShieldCheck, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { FacultyDashboard as Dashboard } from '@/lib/types';
import { formatDateTime, formatMinutes, formatPercent, formatRelative, firstName } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatCard, StatCardSkeleton } from '@/components/common';

const tooltipStyle = {
  background: 'var(--card-solid)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--foreground)',
  fontSize: 12,
};

export default function FacultyDashboard() {
  useDocumentTitle('Faculty dashboard');
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['faculty-dashboard'],
    queryFn: () => api.get<Dashboard>('/faculty/dashboard'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Welcome back, <span className="text-gradient">{firstName(user?.name ?? '')}</span></>}
        description="Manage your examinations, review submissions and track performance."
        actions={
          <Button asChild>
            <Link to="/faculty/exams/new"><Plus /> Create exam</Link>
          </Button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard index={0} label="Total exams" value={data.stats.totalExams} icon={ClipboardList} to="/faculty/exams" />
                <StatCard index={1} label="Drafts" value={data.stats.drafts} icon={FilePen} accent="violet" to="/faculty/exams?status=DRAFT" />
                <StatCard
                  index={2}
                  label="Pending approval"
                  value={data.stats.pendingApproval}
                  icon={ShieldCheck}
                  accent={data.stats.pendingApproval ? 'amber' : 'blue'}
                  hint="Awaiting administrator review"
                  to="/faculty/exams?status=PENDING_APPROVAL"
                />
                <StatCard
                  index={3}
                  label="Rejected"
                  value={data.stats.rejected}
                  icon={XCircle}
                  accent={data.stats.rejected ? 'rose' : 'green'}
                  hint={data.stats.rejected ? 'Changes requested' : 'Nothing to fix'}
                  to="/faculty/exams?status=REJECTED"
                />
                <StatCard index={4} label="Live now" value={data.stats.liveCount} icon={Radio} accent="green" to="/faculty/exams?phase=LIVE" />
                <StatCard index={5} label="Scheduled" value={data.stats.scheduledCount} icon={CalendarClock} accent="blue" to="/faculty/exams?phase=SCHEDULED" />
                <StatCard index={6} label="Submissions" value={data.stats.submissions} icon={ClipboardCheck} accent="violet" />
                <StatCard index={7} label="Pending review" value={data.stats.pendingReview} icon={Hourglass} accent={data.stats.pendingReview ? 'amber' : 'green'} />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Exam performance</CardTitle>
                <CardDescription>Average score and pass rate for your recent exams (graded results)</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ListSkeleton rows={4} />
                ) : data.examPerformance.length === 0 ? (
                  <EmptyState title="No results yet" description="Performance appears here once students submit your published exams." />
                ) : (
                  <div className="h-72" role="img" aria-label="Bar chart of average score and pass rate per exam">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.examPerformance} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="title" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
                        <YAxis domain={[0, 100]} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                        <ChartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)', opacity: 0.4 }} formatter={(v: number) => `${v}%`} />
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
                <CardTitle className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden /> Live exams
                </CardTitle>
                <CardDescription>Currently open for attempts</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ListSkeleton rows={3} />
                ) : data.liveExams.length === 0 ? (
                  <EmptyState icon={Radio} title="Nothing live" description="No exam is open right now." className="py-8" />
                ) : (
                  <ul className="space-y-2">
                    {data.liveExams.map((e) => (
                      <li key={e.id}>
                        <Link to={`/faculty/exams/${e.id}/submissions`} className="block rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{e.title}</span>
                            <Badge variant="success" className="shrink-0"><Users className="h-3 w-3" /> {e.attemptCount}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">Closes {formatRelative(e.endsAt)} · {e.subject}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent submissions</CardTitle>
                <CardDescription>Latest attempts submitted across your exams</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ListSkeleton rows={4} />
                ) : data.recentSubmissions.length === 0 ? (
                  <EmptyState icon={ClipboardCheck} title="No submissions yet" className="py-8" />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentSubmissions.map((s) => (
                      <li key={s.id}>
                        <Link to={`/faculty/attempts/${s.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-accent/40">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{s.student.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{s.exam.title} · {formatRelative(s.submittedAt)}</p>
                          </div>
                          {s.result?.status === 'PENDING_REVIEW' ? (
                            <Badge variant="warning">Needs grading</Badge>
                          ) : (
                            <span className="text-sm font-semibold tabular-nums">{formatPercent(s.result?.percentage)}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming exams</CardTitle>
                <CardDescription>Published and scheduled to open</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <ListSkeleton rows={3} />
                ) : data.scheduledExams.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="No upcoming exams"
                    description="Schedule an exam to see it here."
                    action={<Button asChild size="sm" variant="outline"><Link to="/faculty/exams/new"><Plus /> New exam</Link></Button>}
                    className="py-8"
                  />
                ) : (
                  <ul className="space-y-2">
                    {data.scheduledExams.map((e) => (
                      <li key={e.id}>
                        <Link to={`/faculty/exams/${e.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 hover:border-primary/40 hover:bg-accent/40">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{e.title}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(e.startsAt)} · {formatMinutes(e.durationMinutes)}</p>
                          </div>
                          <Badge variant="violet">{formatRelative(e.startsAt)}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, Bell, BookOpenCheck, CalendarClock, CheckCircle2, Clock, FileBarChart, Target } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { StudentDashboard as Dashboard } from '@/lib/types';
import { formatDateTime, formatMinutes, formatPercent, formatRelative, firstName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, ResultBadge, StatCard, StatCardSkeleton } from '@/components/common';
import { Countdown, ExamCard } from '@/components/student/ExamCard';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const tooltipStyle = {
  contentStyle: { background: 'var(--card-solid)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' },
  labelStyle: { color: 'var(--muted-foreground)' },
};

export default function StudentDashboard() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['student', 'dashboard'], queryFn: () => api.get<Dashboard>('/student/dashboard') });

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            {greeting()}, <span className="text-gradient">{firstName(user?.name ?? '')}</span>
          </>
        }
        description="Here's what's happening with your examinations."
        actions={
          <Button asChild>
            <Link to="/student/exams">
              Browse exams <ArrowRight />
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard index={0} label="Total exams" value={data.stats.totalExams} icon={BookOpenCheck} to="/student/exams" hint="Published examinations" />
                <StatCard index={1} label="Upcoming" value={data.stats.upcomingExams} icon={CalendarClock} accent="violet" to="/student/exams?tab=upcoming" hint="Scheduled to open" />
                <StatCard index={2} label="Completed" value={data.stats.completedExams} icon={CheckCircle2} accent="green" to="/student/results" hint={`${data.stats.passedCount} passed`} />
                <StatCard index={3} label="Average score" value={formatPercent(data.stats.averageScore)} icon={Target} accent="amber" to="/student/results" hint="Across released results" />
              </>
            )}
          </div>

          {data && data.liveExams.length > 0 && (
            <section aria-labelledby="live-heading">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="live-heading" className="flex items-center gap-2 text-lg font-semibold">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> Live now
                </h2>
                <Link to="/student/exams?tab=active" className="text-sm text-primary hover:underline">View all</Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.liveExams.map((e, i) => <ExamCard key={e.id} exam={e} index={i} />)}
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Performance trend</CardTitle>
                <CardDescription>Your percentage across recent released results</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : data?.performance.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.performance} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4F8CFF" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="exam" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 12)}…` : v)} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                      <ChartTooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, 'Score']} />
                      <Area type="monotone" dataKey="percentage" stroke="#4F8CFF" strokeWidth={2.5} fill="url(#perf)" dot={{ r: 3, fill: '#4F8CFF' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={FileBarChart} title="No released results yet" description="Your performance chart appears once results are published." className="h-full py-6" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Subject progress</CardTitle>
                <CardDescription>Average score by subject</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : data?.subjectPerformance.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.subjectPerformance} layout="vertical" margin={{ left: 0, right: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="subject" width={90} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                      <ChartTooltip {...tooltipStyle} cursor={{ fill: 'var(--accent)' }} formatter={(v: number) => [`${v}%`, 'Average']} />
                      <Bar dataKey="average" fill="#8B5CF6" radius={[0, 6, 6, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState icon={Target} title="No subject data" description="Complete exams to see subject-wise progress." className="h-full py-6" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Upcoming exams</CardTitle>
                <Link to="/student/exams?tab=upcoming" className="text-sm text-primary hover:underline">View all</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : data?.upcomingExams.length ? (
                  data.upcomingExams.map((e) => (
                    <Link key={e.id} to={`/student/exams/${e.id}`} className="block rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-medium">{e.title}</p>
                        <Badge variant="violet" className="shrink-0">{e.subject}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {formatDateTime(e.startsAt)}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatMinutes(e.durationMinutes)}</span>
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-secondary"><Countdown to={e.startsAt} /></p>
                    </Link>
                  ))
                ) : (
                  <EmptyState icon={CalendarClock} title="Nothing scheduled" description="New exams will appear here when faculty schedule them." className="py-8" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Recent results</CardTitle>
                <Link to="/student/results" className="text-sm text-primary hover:underline">History</Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : data?.recentResults.length ? (
                  data.recentResults.map((r) => (
                    <Link key={r.attemptId} to={`/student/results/${r.attemptId}`} className="flex items-center justify-between gap-3 rounded-xl p-3 transition-colors hover:bg-accent/50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.examTitle}</p>
                        <p className="text-xs text-muted-foreground">{r.subject} · {formatRelative(r.submittedAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {r.percentage !== null && <span className="text-sm font-semibold tabular-nums">{formatPercent(r.percentage)}</span>}
                        <ResultBadge status={r.status} passed={r.passed} released={r.released} />
                      </div>
                    </Link>
                  ))
                ) : (
                  <EmptyState icon={FileBarChart} title="No attempts yet" description="Take your first exam to see results here." className="py-8" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Notifications</CardTitle>
                <Link to="/notifications" className="text-sm text-primary hover:underline">View all</Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  <ListSkeleton rows={3} />
                ) : data?.notifications.length ? (
                  data.notifications.map((n) => (
                    <Link key={n.id} to={n.link ?? '/notifications'} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-accent/50">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-muted-foreground/30' : 'bg-primary'}`} aria-label={n.readAt ? 'Read' : 'Unread'} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">{formatRelative(n.createdAt)}</p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <EmptyState icon={Bell} title="All caught up" description="Announcements and exam updates will show here." className="py-8" />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowRight, BadgeCheck, ClipboardList, FileBarChart, GraduationCap, Hourglass, RefreshCw, ScrollText, Send, ShieldCheck, UserCog, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { AdminDashboard as AdminDashboardData, ExamStatus, UserStatus } from '@/lib/types';
import { formatDateTime, formatRelative, firstName } from '@/lib/utils';
import { useDocumentTitle, useNow } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, StatCard, StatCardSkeleton } from '@/components/common';
import { actionVariant, humanizeAction, roleLabel } from '@/components/admin/helpers';
import { OutcomeBadge } from '@/components/admin/examActions';

const STATUS_COLORS: Record<UserStatus, string> = { ACTIVE: '#34d399', INACTIVE: '#94a3b8', SUSPENDED: '#f87171' };
const EXAM_STATUS_COLORS: Record<ExamStatus, string> = {
  DRAFT: '#94a3b8', PENDING_APPROVAL: '#fbbf24', APPROVED: '#4F8CFF', REJECTED: '#f87171', PUBLISHED: '#34d399', CANCELLED: '#fb7185', ARCHIVED: '#64748b',
};
const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', REJECTED: 'Rejected', PUBLISHED: 'Published', CANCELLED: 'Cancelled', ARCHIVED: 'Archived',
};
const EXAM_STATUS_ORDER: ExamStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'CANCELLED', 'ARCHIVED'];

const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function ChartTooltipContent({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card-solid px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{label ? shortDate(label) : ''}</p>
      <p className="text-muted-foreground">
        {payload[0]!.value} {unit}
      </p>
    </div>
  );
}

function TrendChart({ data, color, id, unit }: { data: { date: string; count: number }[]; color: string; id: string; unit: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <ChartTooltip content={<ChartTooltipContent unit={unit} />} cursor={{ stroke: color, strokeOpacity: 0.3 }} />
          <Area type="monotone" dataKey="count" stroke={color} strokeWidth={2} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AdminDashboard() {
  useDocumentTitle('Admin dashboard');
  const { user } = useAuth();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<AdminDashboardData>('/admin/dashboard/stats'),
    refetchInterval: 60_000,
  });
  useNow(30_000); // keep the "updated … ago" label fresh
  const examStatusData = data
    ? EXAM_STATUS_ORDER.map((status) => ({ status, label: EXAM_STATUS_LABEL[status], count: data.examStatus.find((e) => e.status === status)?.count ?? 0 }))
    : [];

  const totalRegistrations = data?.registrations.reduce((s, r) => s + r.count, 0) ?? 0;
  const totalSubmissions = data?.submissions.reduce((s, r) => s + r.count, 0) ?? 0;
  const totalAccounts = data?.accountStatus.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={<>Welcome back, <span className="text-gradient">{firstName(user?.name ?? '')}</span></>}
        description={
          data ? (
            <>Live overview of accounts, examinations and activity · updated {formatRelative(data.generatedAt)}</>
          ) : (
            'Live overview of accounts, examinations and activity.'
          )
        }
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => void refetch()} aria-label="Refresh statistics" disabled={isFetching}>
              <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            </Button>
            <Button variant="outline" asChild>
              <Link to="/admin/announcements"><Send /> Announce</Link>
            </Button>
            <Button asChild>
              <Link to="/admin/users"><UserCog /> Manage users</Link>
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          {/* Work queues needing an administrator */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {isLoading || !data ? (
              Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard index={0} label="Pending approvals" value={data.stats.pendingApprovals} icon={ShieldCheck} accent="amber" hint={data.stats.pendingApprovals ? 'Exams waiting for your decision' : 'Nothing to review'} to="/admin/exams?status=PENDING_APPROVAL" />
                <StatCard index={1} label="Results awaiting publication" value={data.stats.awaitingPublication} icon={BadgeCheck} accent="violet" hint="Graded, not yet visible to students" to="/admin/results?publication=awaiting" />
                <StatCard index={2} label="Pending review" value={data.stats.pendingReview} icon={Hourglass} accent="rose" hint="Descriptive answers awaiting faculty marks" to="/admin/results?status=PENDING_REVIEW&publication=all" />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <StatCard index={3} label="Students" value={data.stats.students} icon={GraduationCap} accent="blue" to="/admin/users?role=STUDENT" />
                <StatCard index={4} label="Faculty" value={data.stats.faculty} icon={Users} accent="violet" hint={`${data.stats.admins} administrator${data.stats.admins === 1 ? '' : 's'}`} to="/admin/users?role=FACULTY" />
                <StatCard index={5} label="Examinations" value={data.stats.exams} icon={ClipboardList} accent="green" hint={`${data.stats.publishedExams} published · ${data.stats.liveExams} live now`} to="/admin/exams?status=ALL" />
                <StatCard index={6} label="Submissions" value={data.stats.submissions} icon={FileBarChart} accent="amber" to="/admin/results?publication=all" />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Awaiting your approval</CardTitle>
                  <CardDescription>Oldest submissions first</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/exams?status=PENDING_APPROVAL">Open queue <ArrowRight /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
                ) : data.pendingApprovals.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No exams waiting" description="Exams submitted by faculty for approval will appear here." />
                ) : (
                  <ul className="space-y-2">
                    {data.pendingApprovals.map((e) => (
                      <li key={e.id}>
                        <Link to={`/admin/exams/${e.id}`} className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{e.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {e.subject} · {e.createdBy.name} · {e.questionCount} questions · opens {formatDateTime(e.startsAt)}
                            </p>
                          </div>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {e.submittedForApprovalAt ? `submitted ${formatRelative(e.submittedForApprovalAt)}` : ''}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Examinations by status</CardTitle>
                <CardDescription>{data ? `${data.stats.exams} exams in total` : 'Workflow overview'}</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={examStatusData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="label" width={112} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                        <ChartTooltip
                          cursor={{ fill: 'var(--accent)', opacity: 0.4 }}
                          content={({ active, payload }) =>
                            active && payload?.length ? (
                              <div className="rounded-lg border border-border bg-card-solid px-3 py-2 text-xs shadow-lg">
                                {String(payload[0]!.payload.label)}: {String(payload[0]!.value)}
                              </div>
                            ) : null
                          }
                        />
                        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={18}>
                          {examStatusData.map((d) => <Cell key={d.status} fill={EXAM_STATUS_COLORS[d.status]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Registrations</CardTitle>
                <CardDescription>{isLoading ? 'Last 30 days' : `${totalRegistrations} new accounts in the last 30 days`}</CardDescription>
              </CardHeader>
              <CardContent>{isLoading || !data ? <Skeleton className="h-56 w-full" /> : <TrendChart data={data.registrations} color="#4F8CFF" id="reg-grad" unit="registrations" />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Exam submissions</CardTitle>
                <CardDescription>{isLoading ? 'Last 30 days' : `${totalSubmissions} submissions in the last 30 days`}</CardDescription>
              </CardHeader>
              <CardContent>{isLoading || !data ? <Skeleton className="h-56 w-full" /> : <TrendChart data={data.submissions} color="#8B5CF6" id="sub-grad" unit="submissions" />}</CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Account status</CardTitle>
                <CardDescription>{totalAccounts} accounts in total</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <Skeleton className="mx-auto h-48 w-48 rounded-full" />
                ) : (
                  <>
                    <div className="relative h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.accountStatus} dataKey="count" nameKey="status" innerRadius={55} outerRadius={80} paddingAngle={3} stroke="none">
                            {data.accountStatus.map((s) => (
                              <Cell key={s.status} fill={STATUS_COLORS[s.status]} />
                            ))}
                          </Pie>
                          <ChartTooltip
                            content={({ active, payload }) =>
                              active && payload?.length ? (
                                <div className="rounded-lg border border-border bg-card-solid px-3 py-2 text-xs shadow-lg">
                                  {String(payload[0]!.name)}: {String(payload[0]!.value)}
                                </div>
                              ) : null
                            }
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-semibold">{totalAccounts}</span>
                        <span className="text-xs text-muted-foreground">accounts</span>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-2">
                      {data.accountStatus.map((s) => (
                        <li key={s.status}>
                          <Link to={`/admin/users?status=${s.status}`} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-accent">
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[s.status] }} />
                              {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{s.count}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Latest audited actions across the system</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/audit-logs">View all <ArrowRight /></Link>
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading || !data ? (
                  <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : data.recentActivity.length === 0 ? (
                  <EmptyState icon={Activity} title="No activity yet" description="Audited actions such as sign-ins and account changes will appear here." />
                ) : (
                  <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
                    {data.recentActivity.map((log) => (
                      <li key={log.id} className="relative flex items-start gap-3 rounded-lg px-1 py-2">
                        <span className="relative z-10 mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border border-border bg-card-solid">
                          <ScrollText className="h-3.5 w-3.5 text-primary" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={actionVariant(log.action)}>{humanizeAction(log.action)}</Badge>
                            {log.outcome !== 'SUCCESS' && <OutcomeBadge outcome={log.outcome} />}
                            <span className="text-xs text-muted-foreground">{formatRelative(log.createdAt)}</span>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {log.actor ? (
                              <>
                                <span className="font-medium text-foreground">{log.actor.name}</span> · {roleLabel[log.actor.role]}
                              </>
                            ) : log.actorEmail ? (
                              <>
                                <span className="font-medium text-foreground">{log.actorEmail}</span>
                                {log.actorRole && <> · {roleLabel[log.actorRole]}</>}
                              </>
                            ) : (
                              'System'
                            )}
                            {' · '}
                            {log.entityType}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { to: '/admin/users', icon: Users, title: 'User management', desc: 'Create accounts, assign roles, manage status' },
              { to: '/admin/reports', icon: ClipboardList, title: 'Reports', desc: 'Result reports and CSV exports' },
              { to: '/admin/settings', icon: FileBarChart, title: 'System settings', desc: 'Approval and publication policies' },
            ].map((l) => (
              <Link key={l.to} to={l.to} className="group rounded-2xl">
                <Card className="flex h-full items-center gap-4 p-5 transition-colors group-hover:border-primary/40">
                  <div className="rounded-xl bg-gradient-to-br from-[#4F8CFF]/20 to-[#8B5CF6]/20 p-3">
                    <l.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.title}</p>
                    <p className="text-sm text-muted-foreground">{l.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

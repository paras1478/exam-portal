import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, FileQuestion, Info, Play, RotateCcw, Target, Trophy, User } from 'lucide-react';
import { useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { StudentExamDetail as Detail } from '@/lib/types';
import { formatDateTime, formatMinutes, formatScore } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState, PageHeader, PhaseBadge } from '@/components/common';
import { Countdown, StartExamDialog, useStartAttempt } from '@/components/student/ExamCard';

function Rule({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border p-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function StudentExamDetail() {
  const { examId } = useParams();
  const [confirm, setConfirm] = useState(false);
  const start = useStartAttempt();
  const { data: exam, isLoading, error, refetch } = useQuery({
    queryKey: ['student', 'exam', examId],
    queryFn: () => api.get<Detail>(`/student/exams/${examId}`),
    enabled: !!examId,
  });
  useDocumentTitle(exam?.title ?? 'Exam');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !exam) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const remaining = exam.maxAttempts - exam.attemptsUsed;
  const resuming = !!exam.inProgressAttemptId;

  let cta: React.ReactNode;
  if (exam.phase === 'LIVE' && exam.canStart) {
    cta = (
      <Button size="lg" loading={start.isPending} onClick={() => (resuming ? start.mutate(exam.id) : setConfirm(true))}>
        <Play /> {resuming ? 'Resume attempt' : 'Start exam'}
      </Button>
    );
  } else if (exam.phase === 'SCHEDULED') {
    cta = (
      <Badge variant="violet" className="px-3 py-1.5 text-sm">
        <CalendarClock className="h-4 w-4" /> <Countdown to={exam.startsAt} prefix="Opens" />
      </Badge>
    );
  } else if (exam.phase === 'LIVE') {
    cta = <Badge variant="muted" className="px-3 py-1.5 text-sm">All attempts used</Badge>;
  } else {
    cta = <Badge variant="muted" className="px-3 py-1.5 text-sm">This exam has ended</Badge>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/student/exams', label: 'All exams' }}
        title={exam.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="violet">{exam.subject}</Badge>
            <PhaseBadge phase={exam.phase} />
            <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {exam.createdBy.name}</span>
          </span>
        }
        actions={cta}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>About this exam</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{exam.description || 'No description provided.'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Rule icon={Clock} label="Duration" value={formatMinutes(exam.durationMinutes)} />
                <Rule icon={FileQuestion} label="Questions" value={exam.questionCount} />
                <Rule icon={Trophy} label="Total marks" value={formatScore(exam.totalMarks)} />
                <Rule icon={Target} label="Pass marks" value={formatScore(exam.passMarks)} />
                <Rule icon={RotateCcw} label="Attempts" value={`${exam.attemptsUsed} used of ${exam.maxAttempts}`} />
                <Rule
                  icon={AlertTriangle}
                  label="Negative marking"
                  value={exam.negativeMarking ? `−${Math.round(exam.negativeMarkRatio * 100)}% of the question's marks per wrong answer` : 'None'}
                />
                <Rule icon={CalendarClock} label="Opens" value={formatDateTime(exam.startsAt)} />
                <Rule icon={CalendarClock} label="Closes" value={formatDateTime(exam.endsAt)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              {exam.instructions ? (
                <div className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{exam.instructions}</div>
              ) : (
                <p className="text-sm text-muted-foreground">No special instructions.</p>
              )}
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {[
                  'Your timer is controlled by the server and continues even if you close the page.',
                  'Answers are saved automatically as you work.',
                  'The exam submits automatically when time runs out or the exam window closes.',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {t}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>My attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {exam.attempts.length ? (
              exam.attempts.map((a) =>
                a.status === 'SUBMITTED' ? (
                  <Link key={a.id} to={`/student/results/${a.id}`} className="flex items-center justify-between rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                    <div>
                      <p className="text-sm font-medium">Attempt {a.attemptNumber}</p>
                      <p className="text-xs text-muted-foreground">Submitted {formatDateTime(a.submittedAt)}</p>
                    </div>
                    <Badge variant={a.submissionType === 'AUTO_TIMEOUT' ? 'warning' : 'success'}>
                      {a.submissionType === 'AUTO_TIMEOUT' ? 'Auto-submitted' : 'Submitted'}
                    </Badge>
                  </Link>
                ) : (
                  <Link key={a.id} to={`/attempt/${a.id}`} className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3">
                    <div>
                      <p className="text-sm font-medium">Attempt {a.attemptNumber}</p>
                      <p className="text-xs text-muted-foreground">Started {formatDateTime(a.startedAt)}</p>
                    </div>
                    <Badge variant="default">In progress</Badge>
                  </Link>
                ),
              )
            ) : (
              <EmptyState icon={RotateCcw} title="No attempts yet" description={remaining > 0 ? `You have ${remaining} attempt${remaining > 1 ? 's' : ''} available.` : undefined} className="py-8" />
            )}
          </CardContent>
        </Card>
      </div>

      <StartExamDialog open={confirm} onOpenChange={setConfirm} exam={exam} onConfirm={() => start.mutateAsync(exam.id)} />
    </div>
  );
}

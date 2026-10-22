import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts';
import { Ban, CheckCircle2, Circle, Clock, Hourglass, Lock, MinusCircle, Printer, XCircle } from 'lucide-react';
import { useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { StudentResultDetail as Detail } from '@/lib/types';
import { cn, formatDateTime, formatPercent, formatScore, questionTypeLabel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Separator, Skeleton } from '@/components/ui/primitives';
import { ErrorState, PageHeader } from '@/components/common';

function Notice({ icon: Icon, title, children, tone }: { icon: typeof Lock; title: string; children: React.ReactNode; tone: 'warning' | 'muted' }) {
  return (
    <div className={cn('flex gap-3 rounded-2xl border p-4', tone === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/40')}>
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-muted-foreground')} />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

const releaseCopy = {
  IMMEDIATE: 'Your score will appear as soon as evaluation is complete.',
  AFTER_END: 'Scores are released once the exam window closes.',
  MANUAL: 'Results are published after evaluation and verification.',
};

export default function StudentResultDetail() {
  const { attemptId } = useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student', 'result', attemptId],
    queryFn: () => api.get<Detail>(`/student/results/${attemptId}`),
    enabled: !!attemptId,
  });
  useDocumentTitle(data ? `Result · ${data.exam.title}` : 'Result');

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const { exam, result, student, attempt } = data;
  const chartData = result
    ? [
        { name: 'Correct', value: result.correctCount, color: '#34d399' },
        { name: 'Incorrect', value: result.incorrectCount, color: '#f87171' },
        { name: 'Unanswered', value: result.unansweredCount, color: '#64748b' },
        { name: 'Descriptive', value: Math.max(0, data.questions.length - result.correctCount - result.incorrectCount - result.unansweredCount), color: '#8B5CF6' },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          back={{ to: '/student/results', label: 'All results' }}
          title="Result sheet"
          description={`${exam.title} · Attempt ${attempt.attemptNumber}`}
          actions={
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          }
        />
      </div>

      <Card className="print-area p-5 sm:p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">ExamFlow · Official result</p>
            <h2 className="mt-1 text-2xl font-semibold">{exam.title}</h2>
            <p className="text-sm text-muted-foreground">
              {exam.subject} · Faculty: {exam.faculty}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Student</dt><dd className="font-medium">{student.name}</dd></div>
              <div><dt className="text-muted-foreground">Roll number</dt><dd className="font-medium">{student.studentProfile?.rollNumber ?? '—'}</dd></div>
              <div><dt className="text-muted-foreground">Department</dt><dd className="font-medium">{student.studentProfile?.department ?? '—'}</dd></div>
              <div><dt className="text-muted-foreground">Submitted</dt><dd className="font-medium">{formatDateTime(attempt.submittedAt)}</dd></div>
              <div><dt className="text-muted-foreground">Submission</dt><dd className="font-medium">{attempt.submissionType === 'AUTO_TIMEOUT' ? 'Auto (time up)' : 'Manual'}</dd></div>
              <div><dt className="text-muted-foreground">Pass marks</dt><dd className="font-medium">{formatScore(exam.passMarks)} / {formatScore(exam.totalMarks)}</dd></div>
            </dl>
          </div>

          {result ? (
            <div className="flex items-center gap-5">
              <div className="h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
                      {chartData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <ChartTooltip contentStyle={{ background: 'var(--card-solid)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-4xl font-bold tracking-tight tabular-nums">{formatPercent(result.percentage)}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatScore(result.totalScore)} / {formatScore(result.maxScore)} marks
                </p>
                <Badge variant={result.passed ? 'success' : 'destructive'} className="mt-2 text-sm">
                  {result.passed ? 'PASSED' : 'FAILED'}
                </Badge>
              </div>
            </div>
          ) : null}
        </div>

        {result && (
          <>
            <Separator className="my-5" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Correct', value: result.correctCount, icon: CheckCircle2, cls: 'text-success' },
                { label: 'Incorrect', value: result.incorrectCount, icon: XCircle, cls: 'text-destructive' },
                { label: 'Unanswered', value: result.unansweredCount, icon: MinusCircle, cls: 'text-muted-foreground' },
                { label: 'Descriptive marks', value: formatScore(result.descriptiveScore), icon: Circle, cls: 'text-secondary' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <s.icon className={cn('h-4 w-4', s.cls)} /> {s.label}
                  </div>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {!data.released && (
          <div className="mt-5">
            {data.examCancelled ? (
              <Notice icon={Ban} title="Exam cancelled" tone="warning">
                This examination was cancelled by the institution, so no result will be issued for it. Your submitted answers are kept on record.
              </Notice>
            ) : data.resultStatus === 'PENDING_REVIEW' ? (
              <Notice icon={Hourglass} title="Evaluation in progress" tone="warning">
                Some descriptive answers are awaiting evaluation by your faculty. Your score will be available once grading is complete.
              </Notice>
            ) : (
              <Notice icon={Lock} title="Result not yet released" tone="muted">
                {releaseCopy[exam.resultRelease]}
              </Notice>
            )}
          </div>
        )}
        {data.released && !data.answersRevealed && (
          <div className="mt-5">
            <Notice icon={Lock} title="Correct answers are hidden" tone="muted">
              Answers and explanations become visible after the exam window closes or once you have used all your attempts.
            </Notice>
          </div>
        )}
      </Card>

      <Card className="print-area">
        <CardHeader>
          <CardTitle>Question review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.questions.map((q) => {
            const r = q.response;
            const answered = q.type === 'DESCRIPTIVE' ? !!r.textAnswer?.trim() : r.selectedOptionIds.length > 0;
            return (
              <div key={q.id} className="break-inside-avoid rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    <span className="mr-2 text-muted-foreground">Q{q.order}.</span>
                    <span className="whitespace-pre-line">{q.text}</span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="muted">{questionTypeLabel[q.type]}</Badge>
                    {r.marksAwarded !== null ? (
                      <Badge variant={r.marksAwarded > 0 ? 'success' : r.marksAwarded < 0 ? 'destructive' : 'muted'}>
                        {formatScore(r.marksAwarded)} / {formatScore(q.marks)}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{formatScore(q.marks)} marks</Badge>
                    )}
                  </div>
                </div>

                {q.type === 'DESCRIPTIVE' ? (
                  <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                    {r.textAnswer?.trim() ? r.textAnswer : <span className="italic text-muted-foreground">Not answered</span>}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {q.options.map((o) => {
                      const selected = r.selectedOptionIds.includes(o.id);
                      const correct = data.answersRevealed && o.isCorrect;
                      const wrongPick = data.answersRevealed && selected && !o.isCorrect;
                      return (
                        <li
                          key={o.id}
                          className={cn(
                            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                            correct ? 'border-success/40 bg-success/10' : wrongPick ? 'border-destructive/40 bg-destructive/10' : selected ? 'border-primary/40 bg-primary/10' : 'border-border',
                          )}
                        >
                          {correct ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Correct answer" />
                          ) : wrongPick ? (
                            <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Incorrect choice" />
                          ) : (
                            <Circle className={cn('h-4 w-4 shrink-0', selected ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                          )}
                          <span className="flex-1">{o.text}</span>
                          {selected && <span className="text-xs text-muted-foreground">Your answer</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!answered && q.type !== 'DESCRIPTIVE' && <p className="mt-2 text-xs italic text-muted-foreground">You did not answer this question.</p>}
                {r.feedback && (
                  <p className="mt-3 rounded-lg border border-secondary/30 bg-secondary/5 p-3 text-sm">
                    <span className="font-medium">Faculty feedback: </span>
                    {r.feedback}
                  </p>
                )}
                {q.explanation && (
                  <p className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    <span className="font-medium">Explanation: </span>
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="no-print flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to={`/student/exams/${exam.id}`}>
            <Clock /> Exam details
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/student">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Clock, FileQuestion, Play, RotateCcw, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { ConfirmDialog, PhaseBadge } from '@/components/common';
import { api, errorMessage } from '@/lib/api';
import type { StudentExamCard } from '@/lib/types';
import { formatDateTime, formatMinutes, formatRelative, formatScore } from '@/lib/utils';
import { useNow } from '@/hooks';

export function useStartAttempt() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (examId: string) => api.post<{ attemptId: string; resumed: boolean }>(`/student/exams/${examId}/attempts`),
    onSuccess: (d) => {
      toast.success(d.resumed ? 'Resuming your attempt' : 'Exam started. Good luck!');
      navigate(`/attempt/${d.attemptId}`);
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not start the exam')),
  });
}

export function Countdown({ to, prefix = 'Starts' }: { to: string; prefix?: string }) {
  const now = useNow(1000);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span>{prefix} now</span>;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  return (
    <span className="tabular-nums">
      {prefix} in {text}
    </span>
  );
}

export function ExamCard({ exam, index = 0 }: { exam: StudentExamCard; index?: number }) {
  const start = useStartAttempt();
  const [confirm, setConfirm] = useState(false);
  const live = exam.phase === 'LIVE';
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.25 }}>
      <Card className="group flex h-full flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40">
        <div className="flex items-start justify-between gap-3">
          <Badge variant="violet">{exam.subject}</Badge>
          <PhaseBadge phase={exam.phase} />
        </div>
        <Link to={`/student/exams/${exam.id}`} className="mt-3 rounded focus-visible:outline-2">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug group-hover:text-primary">{exam.title}</h3>
        </Link>
        {exam.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{exam.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {formatMinutes(exam.durationMinutes)}</div>
          <div className="flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> {formatScore(exam.totalMarks)} marks</div>
          <div className="flex items-center gap-1.5"><FileQuestion className="h-3.5 w-3.5" /> {exam.questionCount} questions</div>
          <div className="flex items-center gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> {exam.attemptsUsed}/{exam.maxAttempts} attempts</div>
        </dl>
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          {exam.phase === 'SCHEDULED' ? (
            <span>
              {formatDateTime(exam.startsAt)} · <span className="text-secondary"><Countdown to={exam.startsAt} prefix="Opens" /></span>
            </span>
          ) : live ? (
            <span>Closes {formatRelative(exam.endsAt)}</span>
          ) : (
            <span>Ended {formatDateTime(exam.endsAt)}</span>
          )}
        </div>
        <div className="mt-auto flex gap-2 pt-5">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link to={`/student/exams/${exam.id}`}>Details</Link>
          </Button>
          {live && exam.canStart && (
            <Button size="sm" className="flex-1" loading={start.isPending} onClick={() => (exam.inProgressAttemptId ? start.mutate(exam.id) : setConfirm(true))}>
              <Play /> {exam.inProgressAttemptId ? 'Resume' : 'Start'}
            </Button>
          )}
        </div>
      </Card>
      <StartExamDialog open={confirm} onOpenChange={setConfirm} exam={exam} onConfirm={() => start.mutateAsync(exam.id)} />
    </motion.div>
  );
}

export function StartExamDialog({ open, onOpenChange, exam, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; exam: Pick<StudentExamCard, 'title' | 'durationMinutes' | 'negativeMarking' | 'attemptsUsed' | 'maxAttempts'>;
  onConfirm: () => Promise<unknown>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Start "${exam.title}"?`}
      confirmLabel="Start exam"
      onConfirm={onConfirm}
      description={
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>The timer starts immediately and runs for {formatMinutes(exam.durationMinutes)} (or until the exam window closes).</li>
          <li>Your answers save automatically. Refreshing the page will not lose your progress.</li>
          <li>The exam submits automatically when time runs out.</li>
          {exam.negativeMarking && <li>Negative marking applies to wrong objective answers.</li>}
          <li>This uses attempt {exam.attemptsUsed + 1} of {exam.maxAttempts}.</li>
        </ul>
      }
    />
  );
}

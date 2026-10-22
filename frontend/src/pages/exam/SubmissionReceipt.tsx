import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, FileBarChart, Hash, LayoutDashboard, Timer } from 'lucide-react';
import { useDocumentTitle } from '@/hooks';
import { api } from '@/lib/api';
import type { AttemptState, SubmitReceipt } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { BackgroundOrbs, ErrorState, FullPageLoader, Logo } from '@/components/common';

type Receipt = SubmitReceipt['receipt'];

export default function SubmissionReceipt() {
  useDocumentTitle('Submission receipt');
  const { attemptId = '' } = useParams();
  const location = useLocation();
  const fromState = (location.state as { receipt?: Receipt } | null)?.receipt;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attempt', attemptId, 'receipt'],
    queryFn: () => api.get<AttemptState>(`/student/attempts/${attemptId}`),
    enabled: !fromState,
  });

  if (!fromState && isLoading) return <FullPageLoader label="Loading receipt…" />;
  if (!fromState && (error || !data)) {
    return (
      <div className="mx-auto max-w-lg p-6 pt-24">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const inProgress = !fromState && data!.attempt.status === 'IN_PROGRESS';
  const receipt = fromState ?? {
    attemptId,
    examId: data!.exam.id,
    examTitle: data!.exam.title,
    attemptNumber: data!.attempt.attemptNumber,
    submittedAt: data!.attempt.submittedAt ?? '',
    submissionType: data!.attempt.submissionType ?? 'MANUAL',
    status: data!.attempt.status,
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <BackgroundOrbs />
      <Link to="/student" className="mb-8">
        <Logo />
      </Link>
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.35 }} className="w-full max-w-md">
        <Card className="p-7 text-center">
          {inProgress ? (
            <>
              <h1 className="text-xl font-semibold">This attempt is still in progress</h1>
              <p className="mt-2 text-sm text-muted-foreground">Return to the exam to continue answering.</p>
              <Button asChild className="mt-6 w-full">
                <Link to={`/attempt/${attemptId}`}>Return to exam</Link>
              </Button>
            </>
          ) : (
            <>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/15">
                <CheckCircle2 className="h-9 w-9 text-success" />
              </motion.div>
              <h1 className="mt-4 text-2xl font-semibold">Submission received</h1>
              <p className="mt-1 text-sm text-muted-foreground">Your answers have been recorded securely.</p>

              <dl className="mt-6 space-y-3 rounded-xl border border-border p-4 text-left text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Exam</dt>
                  <dd className="text-right font-medium">{receipt.examTitle}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground"><Hash className="h-3.5 w-3.5" /> Attempt</dt>
                  <dd className="font-medium">{receipt.attemptNumber}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Submitted</dt>
                  <dd className="text-right font-medium">{formatDateTime(receipt.submittedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground"><Timer className="h-3.5 w-3.5" /> Method</dt>
                  <dd>
                    <Badge variant={receipt.submissionType === 'AUTO_TIMEOUT' ? 'warning' : 'success'}>
                      {receipt.submissionType === 'AUTO_TIMEOUT' ? 'Auto-submitted (time up)' : 'Submitted manually'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Reference</dt>
                  <dd className="font-mono text-xs text-muted-foreground">{receipt.attemptId.slice(0, 8).toUpperCase()}</dd>
                </div>
              </dl>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button asChild className="flex-1">
                  <Link to={`/student/results/${receipt.attemptId}`}>
                    <FileBarChart /> View result
                  </Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link to="/student">
                    <LayoutDashboard /> Dashboard
                  </Link>
                </Button>
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
}

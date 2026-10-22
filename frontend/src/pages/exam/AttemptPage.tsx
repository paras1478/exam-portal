import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Bookmark, BookmarkCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CloudOff, Eraser,
  Info, LayoutGrid, Loader2, Send, Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AttemptState, SubmitReceipt } from '@/lib/types';
import { cn, formatDuration, formatScore, questionTypeLabel } from '@/lib/utils';
import { useDocumentTitle, useNow, useOnlineStatus } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, Progress } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { BackgroundOrbs, ConfirmDialog, ErrorState, FullPageLoader, Logo } from '@/components/common';
import { QuestionPalette, type QuestionStatus } from '@/components/exam/QuestionPalette';
import { QuestionView, type LocalAnswer } from '@/components/exam/QuestionView';

/** A partial answer update. Only fields that are present are written by the server. */
interface Patch {
  questionId: string;
  selectedOptionIds?: string[];
  textAnswer?: string | null;
  markedForReview?: boolean;
}
type PatchMap = Record<string, Patch>;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const queueKey = (id: string) => `ef-attempt-queue:${id}`;
const OPTION_DELAY = 300;
const TEXT_DELAY = 1000;
const MAX_BACKOFF = 30_000;

function mergePatches(base: PatchMap, newer: PatchMap): PatchMap {
  const out: PatchMap = { ...base };
  for (const [q, p] of Object.entries(newer)) out[q] = { ...out[q], ...p };
  return out;
}

function readQueue(id: string): PatchMap {
  try {
    const raw = localStorage.getItem(queueKey(id));
    return raw ? (JSON.parse(raw) as PatchMap) : {};
  } catch {
    return {};
  }
}

function writeQueue(id: string, q: PatchMap) {
  try {
    if (Object.keys(q).length) localStorage.setItem(queueKey(id), JSON.stringify(q));
    else localStorage.removeItem(queueKey(id));
  } catch {
    /* storage unavailable; server autosave still works */
  }
}

function isAnswered(type: string, a?: LocalAnswer) {
  if (!a) return false;
  return type === 'DESCRIPTIVE' ? !!a.text?.trim() : a.selected.length > 0;
}

const closedCodes = new Set(['TIME_UP', 'ATTEMPT_CLOSED']);

export default function AttemptPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: async () => {
      const sent = Date.now();
      const state = await api.get<AttemptState>(`/student/attempts/${attemptId}`);
      // Server clock offset, compensating for half the round-trip.
      const received = Date.now();
      return { state, offset: new Date(state.serverNow).getTime() - (sent + received) / 2 };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  useDocumentTitle(data?.state.exam.title ?? 'Exam');

  const [answers, setAnswers] = useState<Record<string, LocalAnswer>>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [hasPending, setHasPending] = useState(false);
  const [closed, setClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [initialised, setInitialised] = useState(false);

  const offsetRef = useRef(0);
  const pendingRef = useRef<PatchMap>({});
  const inflightRef = useRef<PatchMap>({});
  const chainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const backoffRef = useRef(1000);
  const closedRef = useRef(false);
  const autoSubmitStarted = useRef(false);

  const persist = useCallback(() => {
    writeQueue(attemptId, mergePatches(inflightRef.current, pendingRef.current));
    setHasPending(Object.keys(pendingRef.current).length + Object.keys(inflightRef.current).length > 0);
  }, [attemptId]);

  const goToReceipt = useCallback(
    (receipt?: SubmitReceipt['receipt']) => navigate(`/attempt/${attemptId}/receipt`, { replace: true, state: receipt ? { receipt } : undefined }),
    [attemptId, navigate],
  );

  const handleClosed = useCallback(
    (message: string) => {
      if (closedRef.current) return;
      closedRef.current = true;
      setClosed(true);
      clearTimeout(timerRef.current);
      pendingRef.current = {};
      inflightRef.current = {};
      writeQueue(attemptId, {});
      toast.info(message);
      goToReceipt();
    },
    [attemptId, goToReceipt],
  );

  /** Sends one batch of pending answers. Serialised through chainRef so batches never overlap. */
  const doFlush = useCallback(async (): Promise<boolean> => {
    if (closedRef.current) return false;
    const batch = pendingRef.current;
    if (!Object.keys(batch).length) return true;
    pendingRef.current = {};
    inflightRef.current = batch;
    persist();
    setStatus('saving');
    try {
      const res = await api.put<{ savedAt: string }>(`/student/attempts/${attemptId}/answers`, { answers: Object.values(batch) });
      offsetRef.current = new Date(res.savedAt).getTime() - Date.now();
      inflightRef.current = {};
      backoffRef.current = 1000;
      persist();
      setStatus(Object.keys(pendingRef.current).length ? 'saving' : 'saved');
      return true;
    } catch (e) {
      inflightRef.current = {};
      if (e instanceof ApiRequestError && e.status === 409 && closedCodes.has(e.code)) {
        handleClosed(e.message);
        return false;
      }
      if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        // Not retryable (e.g. validation). Drop this batch so the queue cannot get stuck.
        persist();
        setStatus('error');
        toast.error(errorMessage(e, 'An answer could not be saved'));
        return false;
      }
      // Network/server error: put the batch back under any newer edits and retry with backoff.
      pendingRef.current = mergePatches(batch, pendingRef.current);
      persist();
      setStatus(e instanceof ApiRequestError && e.status === 0 ? 'offline' : 'error');
      const delay = backoffRef.current;
      backoffRef.current = Math.min(MAX_BACKOFF, delay * 2);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), delay);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, handleClosed, persist]);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timerRef.current);
    chainRef.current = chainRef.current.then(doFlush, doFlush);
    return chainRef.current;
  }, [doFlush]);

  const queue = useCallback(
    (patch: Patch, delay: number) => {
      if (closedRef.current) return;
      pendingRef.current = mergePatches(pendingRef.current, { [patch.questionId]: patch });
      persist();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), delay);
    },
    [flush, persist],
  );

  // Initialise local state from the server, then replay any unsaved answers left from a refresh/crash.
  useEffect(() => {
    if (!data || initialised) return;
    const { state } = data;
    offsetRef.current = data.offset;
    if (state.attempt.status !== 'IN_PROGRESS') return;
    const local: Record<string, LocalAnswer> = {};
    const seen = new Set<string>();
    for (const a of state.answers) {
      local[a.questionId] = { selected: a.selectedOptionIds, text: a.textAnswer, marked: a.markedForReview };
      seen.add(a.questionId);
    }
    const validIds = new Set(state.questions.map((q) => q.id));
    const replay = Object.fromEntries(Object.entries(readQueue(attemptId)).filter(([q]) => validIds.has(q)));
    for (const p of Object.values(replay)) {
      const prev = local[p.questionId] ?? { selected: [], text: null, marked: false };
      local[p.questionId] = {
        selected: p.selectedOptionIds ?? prev.selected,
        text: p.textAnswer !== undefined ? p.textAnswer : prev.text,
        marked: p.markedForReview ?? prev.marked,
      };
      seen.add(p.questionId);
    }
    setAnswers(local);
    setVisited(seen);
    const firstOpen = state.questions.findIndex((q) => !isAnswered(q.type, local[q.id]));
    setCurrent(firstOpen >= 0 ? firstOpen : 0);
    setShowInstructions(state.answers.length === 0 && !!state.exam.instructions);
    setInitialised(true);
    if (Object.keys(replay).length) {
      pendingRef.current = replay;
      persist();
      toast.info('Restoring answers that had not been saved yet…');
      void flush();
    }
  }, [data, initialised, attemptId, flush, persist]);

  const state = data?.state;
  const questions = useMemo(() => state?.questions ?? [], [state]);
  const question = questions[current];

  // Record a visit (no answer fields, so the server never clears an existing answer).
  useEffect(() => {
    if (!initialised || !question || visited.has(question.id)) return;
    setVisited((v) => new Set(v).add(question.id));
    queue({ questionId: question.id }, OPTION_DELAY);
  }, [initialised, question, visited, queue]);

  // Flush as soon as connectivity returns.
  useEffect(() => {
    if (online && initialised && Object.keys(pendingRef.current).length) {
      backoffRef.current = 1000;
      void flush();
    }
  }, [online, initialised, flush]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (closedRef.current) return;
      if (Object.keys(pendingRef.current).length || Object.keys(inflightRef.current).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const updateAnswer = (qid: string, patch: Partial<LocalAnswer>) =>
    setAnswers((prev) => ({ ...prev, [qid]: { ...(prev[qid] ?? { selected: [], text: null, marked: false }), ...patch } }));

  const onSelect = (ids: string[]) => {
    if (!question) return;
    updateAnswer(question.id, { selected: ids });
    queue({ questionId: question.id, selectedOptionIds: ids }, OPTION_DELAY);
  };
  const onText = (text: string) => {
    if (!question) return;
    updateAnswer(question.id, { text });
    queue({ questionId: question.id, textAnswer: text }, TEXT_DELAY);
  };
  const toggleMark = () => {
    if (!question) return;
    const marked = !answers[question.id]?.marked;
    updateAnswer(question.id, { marked });
    queue({ questionId: question.id, markedForReview: marked }, OPTION_DELAY);
  };
  const clearAnswer = () => {
    if (!question) return;
    if (question.type === 'DESCRIPTIVE') {
      updateAnswer(question.id, { text: null });
      queue({ questionId: question.id, textAnswer: null }, OPTION_DELAY);
    } else {
      updateAnswer(question.id, { selected: [] });
      queue({ questionId: question.id, selectedOptionIds: [] }, OPTION_DELAY);
    }
  };

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= questions.length) return;
      setCurrent(i);
      setPaletteOpen(false);
      // Persist text immediately when leaving a descriptive question.
      if (Object.keys(pendingRef.current).length) void flush();
    },
    [questions.length, flush],
  );

  // ←/→ navigation, ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') goTo(current + 1);
      if (e.key === 'ArrowLeft') goTo(current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, goTo]);

  const submit = useCallback(
    async (auto: boolean) => {
      if (closedRef.current || submitting) return;
      setSubmitting(true);
      const flushed = await flush();
      if (!flushed && !auto && !closedRef.current) {
        setSubmitting(false);
        toast.error('Some answers are not saved yet. Check your connection and try again.');
        throw new Error('unsaved');
      }
      if (closedRef.current) return;
      try {
        const res = await api.post<SubmitReceipt>(`/student/attempts/${attemptId}/submit`);
        closedRef.current = true;
        setClosed(true);
        writeQueue(attemptId, {});
        toast.success(auto ? 'Time is up — your exam was submitted automatically.' : 'Exam submitted successfully.');
        goToReceipt(res.receipt);
      } catch (e) {
        setSubmitting(false);
        if (e instanceof ApiRequestError && e.status === 409) return handleClosed(e.message);
        // Fixed id: automatic retries while offline update one toast instead of stacking new ones.
        toast.error(errorMessage(e, 'Submission failed. Retrying may help.'), { id: 'submit-error' });
        if (auto) {
          autoSubmitStarted.current = false; // allow the timer effect to retry
        }
        throw e;
      }
    },
    [attemptId, flush, goToReceipt, handleClosed, submitting],
  );

  // Display-only countdown; the server enforces the real deadline.
  const now = useNow(500);
  const deadline = state ? new Date(state.attempt.deadlineAt).getTime() : 0;
  const remainingSec = state ? Math.max(0, (deadline - (now + offsetRef.current)) / 1000) : 0;

  useEffect(() => {
    if (!initialised || closed || autoSubmitStarted.current) return;
    if (remainingSec <= 0) {
      autoSubmitStarted.current = true;
      void submit(true).catch(() => {
        setTimeout(() => {
          autoSubmitStarted.current = false;
        }, 3000);
      });
    }
  }, [remainingSec, initialised, closed, submit]);

  const statuses = useMemo(() => {
    const out: Record<string, QuestionStatus> = {};
    for (const q of questions) {
      const a = answers[q.id];
      const ans = isAnswered(q.type, a);
      if (a?.marked) out[q.id] = ans ? 'ANSWERED_MARKED' : 'MARKED';
      else if (ans) out[q.id] = 'ANSWERED';
      else out[q.id] = visited.has(q.id) ? 'NOT_ANSWERED' : 'NOT_VISITED';
    }
    return out;
  }, [questions, answers, visited]);

  if (isLoading) return <FullPageLoader label="Loading your exam…" />;
  if (error || !state) {
    return (
      <div className="mx-auto max-w-lg p-6 pt-24">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (state.attempt.status !== 'IN_PROGRESS') return <Navigate to={`/attempt/${attemptId}/receipt`} replace />;
  if (!initialised || !question) return <FullPageLoader label="Preparing questions…" />;

  const answeredCount = questions.filter((q) => isAnswered(q.type, answers[q.id])).length;
  const counts = {
    answered: answeredCount,
    notAnswered: Object.values(statuses).filter((s) => s === 'NOT_ANSWERED' || s === 'MARKED').length,
    marked: Object.values(statuses).filter((s) => s === 'MARKED' || s === 'ANSWERED_MARKED').length,
    notVisited: Object.values(statuses).filter((s) => s === 'NOT_VISITED').length,
  };
  const timeTone = remainingSec <= 60 ? 'critical' : remainingSec <= 300 ? 'warning' : 'normal';
  const currentAnswer = answers[question.id] ?? { selected: [], text: null, marked: false };
  const locked = closed || submitting;

  const saveIndicator = !online ? (
    <span className="flex items-center gap-1.5 text-warning"><CloudOff className="h-4 w-4" /> Offline – will retry</span>
  ) : status === 'saving' || (hasPending && status !== 'offline' && status !== 'error') ? (
    <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span>
  ) : status === 'offline' || status === 'error' ? (
    <span className="flex items-center gap-1.5 text-warning"><CloudOff className="h-4 w-4" /> Not saved – retrying</span>
  ) : (
    <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> All changes saved</span>
  );

  const palette = <QuestionPalette questions={questions} statuses={statuses} current={current} onJump={goTo} />;

  return (
    <div className="relative min-h-screen">
      <BackgroundOrbs />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Logo className="hidden md:inline-flex [&>span:last-child]:hidden" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold sm:text-base">{state.exam.title}</h1>
            <p className="hidden text-xs sm:block" aria-live="polite">{saveIndicator}</p>
          </div>
          <div
            role="timer"
            aria-live={timeTone === 'normal' ? 'off' : 'polite'}
            aria-label={`Time remaining ${formatDuration(remainingSec)}`}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-base font-semibold tabular-nums sm:text-lg',
              timeTone === 'critical' && 'animate-pulse border-destructive/50 bg-destructive/15 text-destructive',
              timeTone === 'warning' && 'border-warning/50 bg-warning/15 text-warning',
              timeTone === 'normal' && 'border-border bg-card',
            )}
          >
            <Timer className="h-4 w-4" />
            {formatDuration(remainingSec)}
          </div>
          <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setPaletteOpen(true)} aria-label="Open question palette">
            <LayoutGrid />
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={locked} className="hidden sm:inline-flex">
            <Send /> Submit
          </Button>
        </div>
        <Progress value={(answeredCount / questions.length) * 100} className="h-1 rounded-none" aria-label={`${answeredCount} of ${questions.length} answered`} />
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <p className="text-xs sm:hidden" aria-live="polite">{saveIndicator}</p>

          {state.exam.instructions && (
            <Card className="overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm font-medium"
                onClick={() => setShowInstructions((s) => !s)}
                aria-expanded={showInstructions}
              >
                <span className="flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> Instructions</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', showInstructions && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {showInstructions && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="whitespace-pre-line border-t border-border px-5 py-4 text-sm text-muted-foreground">{state.exam.instructions}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )}

          {timeTone !== 'normal' && (
            <div role="alert" className={cn('flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm', timeTone === 'critical' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-warning/40 bg-warning/10 text-warning')}>
              <AlertTriangle className="h-4 w-4" />
              {timeTone === 'critical' ? 'Less than a minute left. Your exam will submit automatically.' : 'Less than 5 minutes remaining.'}
            </div>
          )}

          <Card className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Question <span className="font-semibold text-foreground">{current + 1}</span> of {questions.length}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{questionTypeLabel[question.type]}</Badge>
                <Badge variant="default">{formatScore(question.marks)} mark{question.marks === 1 ? '' : 's'}</Badge>
                {state.exam.negativeMarking && question.type !== 'DESCRIPTIVE' && (
                  <Badge variant="warning">−{formatScore(question.marks * state.exam.negativeMarkRatio)} if wrong</Badge>
                )}
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={question.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                <h2 className="mt-4 whitespace-pre-line text-lg font-medium leading-relaxed">{question.text}</h2>
                <div className="mt-6">
                  <QuestionView question={question} answer={currentAnswer} disabled={locked} onSelect={onSelect} onText={onText} />
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={clearAnswer} disabled={locked || !isAnswered(question.type, currentAnswer)}>
                  <Eraser /> Clear
                </Button>
                <Button variant={currentAnswer.marked ? 'secondary' : 'outline'} size="sm" onClick={toggleMark} disabled={locked} aria-pressed={currentAnswer.marked}>
                  {currentAnswer.marked ? <BookmarkCheck className="text-secondary" /> : <Bookmark />}
                  {currentAnswer.marked ? 'Marked' : 'Mark for review'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => goTo(current - 1)} disabled={current === 0} className="flex-1 sm:flex-none">
                  <ChevronLeft /> Previous
                </Button>
                {current < questions.length - 1 ? (
                  <Button onClick={() => goTo(current + 1)} className="flex-1 sm:flex-none">
                    Next <ChevronRight />
                  </Button>
                ) : (
                  <Button onClick={() => setConfirmOpen(true)} disabled={locked} className="flex-1 sm:flex-none">
                    <Send /> Finish
                  </Button>
                )}
              </div>
            </div>
          </Card>
          <p className="hidden text-center text-xs text-muted-foreground sm:block">Tip: use ← and → to move between questions.</p>
          <Button onClick={() => setConfirmOpen(true)} disabled={locked} className="w-full sm:hidden">
            <Send /> Submit exam
          </Button>
        </div>

        <aside className="hidden lg:block">
          <Card className="sticky top-24 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Question palette</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{answeredCount}/{questions.length} answered</span>
            </div>
            {palette}
            <Button onClick={() => setConfirmOpen(true)} disabled={locked} className="mt-5 w-full">
              <Send /> Submit exam
            </Button>
          </Card>
        </aside>
      </div>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Question palette</DialogTitle>
          </DialogHeader>
          {palette}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit your exam?"
        confirmLabel="Submit now"
        onConfirm={() => submit(false)}
        description={
          <div className="space-y-3">
            <p>You won&apos;t be able to change your answers after submitting.</p>
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['Answered', counts.answered, 'text-success'],
                ['Not answered', counts.notAnswered, 'text-destructive'],
                ['Marked for review', counts.marked, 'text-secondary'],
                ['Not visited', counts.notVisited, 'text-muted-foreground'],
              ].map(([label, value, cls]) => (
                <div key={label as string} className="rounded-lg border border-border p-2.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className={cn('text-lg font-semibold tabular-nums', cls as string)}>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs">Time remaining: <span className="font-mono font-medium">{formatDuration(remainingSec)}</span></p>
          </div>
        }
      />

      {submitting && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/70 backdrop-blur-sm" role="status">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Submitting your answers…</p>
          </div>
        </div>
      )}
    </div>
  );
}

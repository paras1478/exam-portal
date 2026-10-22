import { Bookmark } from 'lucide-react';
import type { AttemptQuestion } from '@/lib/types';
import { cn } from '@/lib/utils';

export type QuestionStatus = 'NOT_VISITED' | 'ANSWERED' | 'NOT_ANSWERED' | 'MARKED' | 'ANSWERED_MARKED';

export const statusMeta: Record<QuestionStatus, { label: string; cls: string }> = {
  NOT_VISITED: { label: 'Not visited', cls: 'border-border bg-muted text-muted-foreground' },
  ANSWERED: { label: 'Answered', cls: 'border-success/50 bg-success/15 text-success' },
  NOT_ANSWERED: { label: 'Not answered', cls: 'border-destructive/50 bg-destructive/15 text-destructive' },
  MARKED: { label: 'Marked for review', cls: 'border-secondary/50 bg-secondary/15 text-secondary' },
  ANSWERED_MARKED: { label: 'Answered & marked', cls: 'border-secondary/60 bg-success/15 text-success' },
};

export function QuestionPalette({ questions, statuses, current, onJump }: {
  questions: AttemptQuestion[];
  statuses: Record<string, QuestionStatus>;
  current: number;
  onJump: (index: number) => void;
}) {
  const counts = Object.values(statuses).reduce<Record<QuestionStatus, number>>(
    (acc, s) => ({ ...acc, [s]: acc[s] + 1 }),
    { NOT_VISITED: 0, ANSWERED: 0, NOT_ANSWERED: 0, MARKED: 0, ANSWERED_MARKED: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5" role="list" aria-label="Question palette">
        {questions.map((q, i) => {
          const s = statuses[q.id] ?? 'NOT_VISITED';
          return (
            <button
              key={q.id}
              role="listitem"
              type="button"
              onClick={() => onJump(i)}
              aria-label={`Question ${i + 1}: ${statusMeta[s].label}`}
              aria-current={i === current ? 'step' : undefined}
              className={cn(
                'relative grid aspect-square place-items-center rounded-lg border text-sm font-semibold tabular-nums transition-all hover:scale-105 cursor-pointer',
                statusMeta[s].cls,
                i === current && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
              )}
            >
              {i + 1}
              {(s === 'MARKED' || s === 'ANSWERED_MARKED') && (
                <Bookmark className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-secondary text-secondary" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
      <ul className="space-y-2 text-xs">
        {(Object.keys(statusMeta) as QuestionStatus[]).map((k) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={cn('relative h-4 w-4 rounded border', statusMeta[k].cls)}>
                {(k === 'MARKED' || k === 'ANSWERED_MARKED') && <Bookmark className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-secondary text-secondary" />}
              </span>
              {statusMeta[k].label}
            </span>
            <span className="font-medium tabular-nums">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

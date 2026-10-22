import type { AttemptQuestion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Checkbox, RadioGroup, RadioGroupItem } from '@/components/ui/controls';
import { Textarea } from '@/components/ui/primitives';

export interface LocalAnswer {
  selected: string[];
  text: string | null;
  marked: boolean;
}

const MAX_TEXT = 20_000;

export function QuestionView({ question, answer, disabled, onSelect, onText }: {
  question: AttemptQuestion;
  answer: LocalAnswer;
  disabled?: boolean;
  onSelect: (ids: string[]) => void;
  onText: (text: string) => void;
}) {
  const optionCls = (checked: boolean) =>
    cn(
      'flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm transition-colors',
      checked ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-accent/40',
      disabled && 'cursor-not-allowed opacity-60',
    );
  const letter = (i: number) => String.fromCharCode(65 + i);

  if (question.type === 'DESCRIPTIVE') {
    const text = answer.text ?? '';
    return (
      <div className="space-y-2">
        <label htmlFor={`answer-${question.id}`} className="sr-only">
          Your answer
        </label>
        <Textarea
          id={`answer-${question.id}`}
          value={text}
          disabled={disabled}
          maxLength={MAX_TEXT}
          onChange={(e) => onText(e.target.value)}
          placeholder="Type your answer here…"
          className="min-h-[240px] text-[15px]"
        />
        <p className="text-right text-xs text-muted-foreground tabular-nums">
          {text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()} characters
        </p>
      </div>
    );
  }

  if (question.type === 'MULTI_SELECT') {
    return (
      <div className="space-y-3" role="group" aria-label="Select all that apply">
        <p className="text-xs text-muted-foreground">Select all that apply.</p>
        {question.options.map((o, i) => {
          const checked = answer.selected.includes(o.id);
          return (
            <label key={o.id} className={optionCls(checked)}>
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(c) => onSelect(c ? [...answer.selected, o.id] : answer.selected.filter((x) => x !== o.id))}
              />
              <span className="font-semibold text-muted-foreground">{letter(i)}.</span>
              <span className="flex-1">{o.text}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <RadioGroup value={answer.selected[0] ?? ''} onValueChange={(v) => onSelect([v])} disabled={disabled} className="gap-3" aria-label="Choose one answer">
      {question.options.map((o, i) => {
        const checked = answer.selected[0] === o.id;
        return (
          <label key={o.id} className={optionCls(checked)}>
            <RadioGroupItem value={o.id} />
            <span className="font-semibold text-muted-foreground">{letter(i)}.</span>
            <span className="flex-1">{o.text}</span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ApiRequestError, errorMessage } from '@/lib/api';
import type { Question, QuestionInput, QuestionType } from '@/lib/types';
import { cn, questionTypeLabel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { Checkbox, RadioGroup, RadioGroupItem, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Field } from '@/components/common';

type Opt = { text: string; isCorrect: boolean };
const blankOptions = (): Opt[] => Array.from({ length: 4 }, () => ({ text: '', isCorrect: false }));
const trueFalse = (correct: 'True' | 'False' = 'True'): Opt[] => [
  { text: 'True', isCorrect: correct === 'True' },
  { text: 'False', isCorrect: correct === 'False' },
];

function initial(q?: Question): QuestionInput {
  if (q) return { type: q.type, text: q.text, marks: q.marks, explanation: q.explanation ?? '', options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) };
  return { type: 'MCQ', text: '', marks: 1, explanation: '', options: blankOptions() };
}

/** Mirrors the server-side question rules so problems are caught before saving. */
function validate(q: QuestionInput) {
  const errors: Record<string, string> = {};
  if (!q.text.trim()) errors.text = 'Question text is required';
  if (!(q.marks > 0)) errors.marks = 'Marks must be greater than 0';
  else if (q.marks > 100) errors.marks = 'At most 100 marks per question';
  if (q.type !== 'DESCRIPTIVE') {
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.options.length < 2) errors.options = 'Provide at least two options';
    else if (q.options.some((o) => !o.text.trim())) errors.options = 'Every option needs text — remove empty ones';
    else if ((q.type === 'MCQ' || q.type === 'TRUE_FALSE') && correct !== 1) errors.options = 'Select exactly one correct option';
    else if (q.type === 'MULTI_SELECT' && correct < 1) errors.options = 'Mark at least one option as correct';
  }
  return errors;
}

export function QuestionDialog({ open, onOpenChange, question, onSave }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  question?: Question;
  onSave: (input: QuestionInput) => Promise<unknown>;
}) {
  const [form, setForm] = useState<QuestionInput>(() => initial(question));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial(question));
      setErrors({});
      setSubmitError(null);
    }
  }, [open, question]);

  const changeType = (type: QuestionType) => {
    setForm((f) => {
      let options = f.options;
      if (type === 'DESCRIPTIVE') options = [];
      else if (type === 'TRUE_FALSE') options = trueFalse();
      else if (f.type === 'DESCRIPTIVE' || f.type === 'TRUE_FALSE') options = blankOptions();
      else if (type === 'MCQ' && options.filter((o) => o.isCorrect).length > 1) options = options.map((o) => ({ ...o, isCorrect: false }));
      return { ...f, type, options };
    });
    setErrors({});
  };

  const setOption = (i: number, patch: Partial<Opt>) =>
    setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  const singleCorrect = form.type === 'MCQ' || form.type === 'TRUE_FALSE';
  const correctIndex = form.options.findIndex((o) => o.isCorrect);

  const save = async () => {
    const payload: QuestionInput = {
      ...form,
      text: form.text.trim(),
      explanation: form.explanation?.trim() || null,
      options: form.type === 'DESCRIPTIVE' ? [] : form.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })),
    };
    const v = validate(payload);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await onSave(payload);
      onOpenChange(false);
    } catch (err) {
      const fe = err instanceof ApiRequestError ? err.details?.fieldErrors : undefined;
      if (fe) setErrors(Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m?.[0] ?? 'Invalid'])));
      setSubmitError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{question ? `Edit question ${question.order}` : 'Add question'}</DialogTitle>
          <DialogDescription>Objective questions are graded automatically. Descriptive answers are graded by you after submission.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Field label="Question type" htmlFor="q-type">
            <Select value={form.type} onValueChange={(v) => changeType(v as QuestionType)}>
              <SelectTrigger id="q-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(questionTypeLabel) as QuestionType[]).map((t) => (
                  <SelectItem key={t} value={t}>{questionTypeLabel[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Marks" htmlFor="q-marks" error={errors.marks} required>
            <Input
              id="q-marks"
              type="number"
              min={0.5}
              max={100}
              step="0.5"
              value={Number.isNaN(form.marks) ? '' : form.marks}
              onChange={(e) => setForm((f) => ({ ...f, marks: e.target.valueAsNumber }))}
              aria-invalid={!!errors.marks || undefined}
            />
          </Field>
        </div>

        <Field label="Question" htmlFor="q-text" error={errors.text} required>
          <Textarea id="q-text" rows={3} value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} aria-invalid={!!errors.text || undefined} placeholder="Type the question…" />
        </Field>

        {form.type !== 'DESCRIPTIVE' && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Options{' '}
              <span className="font-normal text-muted-foreground">
                — {singleCorrect ? 'select the correct answer' : 'tick every correct answer (all must be selected to score)'}
              </span>
            </legend>
            {singleCorrect ? (
              <RadioGroup
                value={correctIndex >= 0 ? String(correctIndex) : ''}
                onValueChange={(v) => setForm((f) => ({ ...f, options: f.options.map((o, j) => ({ ...o, isCorrect: String(j) === v })) }))}
                className="gap-2"
                aria-label="Correct option"
              >
                {form.options.map((o, i) => (
                  <OptionRow key={i} index={i} option={o} fixed={form.type === 'TRUE_FALSE'} canRemove={form.options.length > 2}
                    onText={(text) => setOption(i, { text })}
                    onRemove={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}
                    control={<RadioGroupItem value={String(i)} aria-label={`Mark option ${i + 1} correct`} />}
                  />
                ))}
              </RadioGroup>
            ) : (
              form.options.map((o, i) => (
                <OptionRow key={i} index={i} option={o} canRemove={form.options.length > 2}
                  onText={(text) => setOption(i, { text })}
                  onRemove={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}
                  control={<Checkbox checked={o.isCorrect} onCheckedChange={(c) => setOption(i, { isCorrect: c === true })} aria-label={`Option ${i + 1} is correct`} />}
                />
              ))
            )}
            {form.type !== 'TRUE_FALSE' && form.options.length < 10 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, options: [...f.options, { text: '', isCorrect: false }] }))}>
                <Plus /> Add option
              </Button>
            )}
            {errors.options && <p className="text-xs text-destructive" role="alert">{errors.options}</p>}
          </fieldset>
        )}

        <Field label="Explanation (optional)" htmlFor="q-expl" hint="Shown to students with the answer key once results are released.">
          <Textarea id="q-expl" rows={2} value={form.explanation ?? ''} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} />
        </Field>

        {submitError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{submitError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>{question ? 'Save question' : 'Add question'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({ index, option, control, onText, onRemove, canRemove, fixed }: {
  index: number; option: Opt; control: ReactNode; onText: (t: string) => void; onRemove: () => void; canRemove: boolean; fixed?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-2 pl-3 transition-colors', option.isCorrect ? 'border-success/50 bg-success/5' : 'border-border')}>
      {control}
      <span className="w-5 text-xs font-semibold text-muted-foreground">{String.fromCharCode(65 + index)}</span>
      {fixed ? (
        <span className="flex-1 text-sm">{option.text}</span>
      ) : (
        <Input value={option.text} onChange={(e) => onText(e.target.value)} placeholder={`Option ${index + 1}`} aria-label={`Option ${index + 1} text`} className="h-9 flex-1" />
      )}
      {!fixed && (
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} disabled={!canRemove} aria-label={`Remove option ${index + 1}`}>
          <Trash2 />
        </Button>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { Controller, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Save } from 'lucide-react';
import { ApiRequestError } from '@/lib/api';
import type { ExamDetail, ExamInput, ResultRelease } from '@/lib/types';
import { cn, formatScore, fromLocalInput, toLocalInput } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Textarea } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/controls';
import { Field } from '@/components/common';

const schema = z
  .object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
    subject: z.string().trim().min(2, 'Subject is required').max(100),
    description: z.string().trim().max(2000).optional(),
    instructions: z.string().trim().max(5000).optional(),
    durationMinutes: z.number({ invalid_type_error: 'Enter a duration' }).int('Use whole minutes').min(1, 'At least 1 minute').max(600, 'At most 600 minutes'),
    passMarks: z.number({ invalid_type_error: 'Enter pass marks' }).min(0, 'Cannot be negative'),
    negativeMarking: z.boolean(),
    negativeMarkRatio: z.number({ invalid_type_error: 'Enter a ratio' }).min(0).max(1, 'Must be between 0 and 1'),
    maxAttempts: z.number({ invalid_type_error: 'Enter attempts' }).int().min(1, 'At least 1').max(10, 'At most 10'),
    startsAt: z.string().min(1, 'Start time is required'),
    endsAt: z.string().min(1, 'End time is required'),
    resultRelease: z.enum(['IMMEDIATE', 'AFTER_END', 'MANUAL']),
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), { message: 'End time must be after start time', path: ['endsAt'] })
  .refine((v) => !v.negativeMarking || v.negativeMarkRatio > 0, { message: 'Set a ratio above 0, or turn negative marking off', path: ['negativeMarkRatio'] });

type FormValues = z.infer<typeof schema>;

const releaseOptions: { value: ResultRelease; label: string; hint: string }[] = [
  { value: 'IMMEDIATE', label: 'Immediately', hint: 'Scores appear as soon as an attempt is fully graded.' },
  { value: 'AFTER_END', label: 'After the exam window closes', hint: 'Everyone sees results together once the exam ends.' },
  { value: 'MANUAL', label: 'When results are published', hint: 'Results stay hidden until they are explicitly published.' },
];


const fieldLabel: Record<string, string> = {
  title: 'title', description: 'description', instructions: 'instructions', endsAt: 'end time', resultRelease: 'result release',
};

function defaults(exam?: ExamDetail): FormValues {
  if (exam) {
    return {
      title: exam.title,
      subject: exam.subject,
      description: exam.description ?? '',
      instructions: exam.instructions ?? '',
      durationMinutes: exam.durationMinutes,
      passMarks: exam.passMarks,
      negativeMarking: exam.negativeMarking,
      negativeMarkRatio: exam.negativeMarkRatio,
      maxAttempts: exam.maxAttempts,
      startsAt: toLocalInput(exam.startsAt),
      endsAt: toLocalInput(exam.endsAt),
      resultRelease: exam.resultRelease,
    };
  }
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 3600_000);
  return {
    title: '',
    subject: '',
    description: '',
    instructions: 'Read every question carefully.\nYour answers are saved automatically.\nThe exam submits itself when the timer reaches zero.',
    durationMinutes: 60,
    passMarks: 10,
    negativeMarking: false,
    negativeMarkRatio: 0.25,
    maxAttempts: 1,
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    resultRelease: 'AFTER_END',
  };
}

export function ExamSettingsForm({ exam, onSubmit }: { exam?: ExamDetail; onSubmit: (input: Partial<ExamInput>) => Promise<unknown> }) {
  // The server tells us exactly which fields it will accept right now (FULL / SAFE / NONE edit levels).
  const level = exam?.editLevel ?? 'FULL';
  const locked = level !== 'FULL';
  const readOnly = level === 'NONE';
  const editable = new Set(exam ? exam.editableFields : Object.keys(defaults()));
  const {
    register, control, handleSubmit, watch, reset, setError,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(exam) });

  useEffect(() => {
    reset(defaults(exam));
    // Only re-sync when the saved exam actually changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, exam?.updatedAt, reset]);

  const negative = watch('negativeMarking');
  const passMarks = watch('passMarks');
  const lockedField = (name: keyof FormValues) => readOnly || !editable.has(name);

  const submit = handleSubmit(async (v) => {
    if (locked && exam && new Date(v.endsAt) < new Date(exam.endsAt)) {
      setError('endsAt', { message: 'At this stage the window can only be extended' });
      return;
    }
    const full: ExamInput = {
      title: v.title,
      subject: v.subject,
      description: v.description || null,
      instructions: v.instructions || null,
      durationMinutes: v.durationMinutes,
      passMarks: v.passMarks,
      negativeMarking: v.negativeMarking,
      negativeMarkRatio: v.negativeMarking ? v.negativeMarkRatio : 0,
      maxAttempts: v.maxAttempts,
      startsAt: fromLocalInput(v.startsAt),
      endsAt: fromLocalInput(v.endsAt),
      resultRelease: v.resultRelease,
    };
    // New exams send everything; existing exams send only changed fields the server accepts.
    const dirty = dirtyFields as Partial<Record<keyof FormValues, unknown>>;
    if (dirty.negativeMarking) dirty.negativeMarkRatio = true;
    const payload: Partial<ExamInput> = exam
      ? Object.fromEntries((Object.keys(full) as (keyof ExamInput)[]).filter((k) => dirty[k] && editable.has(k)).map((k) => [k, full[k]]))
      : full;
    if (exam && Object.keys(payload).length === 0) return;
    try {
      await onSubmit(payload);
    } catch (err) {
      const fieldErrors = err instanceof ApiRequestError ? err.details?.fieldErrors : undefined;
      if (fieldErrors) {
        for (const [k, msgs] of Object.entries(fieldErrors)) if (msgs?.[0]) setError(k as Path<FormValues>, { message: msgs[0] });
      }
    }
  });

  const aria = (name: keyof FormValues) => ({ 'aria-invalid': !!errors[name] || undefined, 'aria-describedby': errors[name] ? `${name}-error` : undefined });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {exam && locked && (
        <div role="status" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            {readOnly ? (
              <>
                <p className="font-medium">Settings are read-only</p>
                <p className="text-muted-foreground">
                  {exam.status === 'PENDING_APPROVAL'
                    ? 'This exam is awaiting administrator review. Withdraw it to draft to make changes.'
                    : `Exams that are ${exam.status.replace('_', ' ').toLowerCase()} cannot be modified.`}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Content and grading rules are locked</p>
                <p className="text-muted-foreground">
                  {exam.attemptCount > 0 ? 'Students have already attempted this exam' : 'This exam has been approved'}, so only{' '}
                  {exam.editableFields.map((f) => fieldLabel[f] ?? f).join(', ')} can change (the end time can only be extended).
                  {exam.attemptCount === 0 && ' Withdraw or unpublish it to draft to change anything else.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>What students see in their exam list</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" error={errors.title?.message} required>
            <Input id="title" placeholder="e.g. Database Systems Midterm" disabled={lockedField('title')} {...register('title')} {...aria('title')} />
          </Field>
          <Field label="Subject" htmlFor="subject" error={errors.subject?.message} required>
            <Input id="subject" placeholder="e.g. Databases" disabled={lockedField('subject')} {...register('subject')} {...aria('subject')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="description" error={errors.description?.message}>
              <Textarea id="description" rows={2} placeholder="A short summary of what the exam covers" disabled={lockedField('description')} {...register('description')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Instructions" htmlFor="instructions" error={errors.instructions?.message} hint="Shown to students before they start. One instruction per line works well.">
              <Textarea id="instructions" rows={4} disabled={lockedField('instructions')} {...register('instructions')} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Students can start any time inside the window; each attempt ends at the duration or the window close, whichever comes first.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" htmlFor="startsAt" error={errors.startsAt?.message} required>
            <Input id="startsAt" type="datetime-local" disabled={lockedField('startsAt')} {...register('startsAt')} {...aria('startsAt')} />
          </Field>
          <Field label="Closes" htmlFor="endsAt" error={errors.endsAt?.message} required hint={locked ? 'Can only be extended' : undefined}>
            <Input id="endsAt" type="datetime-local" disabled={lockedField('endsAt')} min={locked && exam ? toLocalInput(exam.endsAt) : undefined} {...register('endsAt')} {...aria('endsAt')} />
          </Field>
          <Field label="Duration (minutes)" htmlFor="durationMinutes" error={errors.durationMinutes?.message} required>
            <Input id="durationMinutes" type="number" min={1} max={600} disabled={lockedField('durationMinutes')} {...register('durationMinutes', { valueAsNumber: true })} {...aria('durationMinutes')} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grading</CardTitle>
          <CardDescription>
            Total marks are calculated from the questions{exam ? `: currently ${formatScore(exam.totalMarks)}` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Pass marks"
            htmlFor="passMarks"
            error={errors.passMarks?.message}
            required
            hint={exam && passMarks > exam.totalMarks ? `Above the current total (${formatScore(exam.totalMarks)}) — add questions or lower this before publishing.` : undefined}
          >
            <Input id="passMarks" type="number" min={0} step="0.5" disabled={lockedField('passMarks')} {...register('passMarks', { valueAsNumber: true })} {...aria('passMarks')} />
          </Field>
          <Field label="Attempts allowed" htmlFor="maxAttempts" error={errors.maxAttempts?.message} required>
            <Input id="maxAttempts" type="number" min={1} max={10} disabled={lockedField('maxAttempts')} {...register('maxAttempts', { valueAsNumber: true })} {...aria('maxAttempts')} />
          </Field>

          <div className="rounded-xl border border-border p-4 sm:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label htmlFor="negativeMarking" className="text-sm font-medium">Negative marking</label>
                <p className="text-xs text-muted-foreground">Deduct a fraction of the question&apos;s marks for wrong objective answers. Unanswered questions are never penalised.</p>
              </div>
              <Controller
                control={control}
                name="negativeMarking"
                render={({ field }) => <Switch id="negativeMarking" checked={field.value} onCheckedChange={field.onChange} disabled={lockedField('negativeMarking')} />}
              />
            </div>
            {negative && (
              <div className="mt-4 max-w-xs">
                <Field label="Deduction ratio" htmlFor="negativeMarkRatio" error={errors.negativeMarkRatio?.message} hint="0.25 deducts a quarter of the question's marks">
                  <Input id="negativeMarkRatio" type="number" min={0} max={1} step="0.05" disabled={lockedField('negativeMarkRatio')} {...register('negativeMarkRatio', { valueAsNumber: true })} {...aria('negativeMarkRatio')} />
                </Field>
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <Field label="Result release" htmlFor="resultRelease" error={errors.resultRelease?.message}>
              <Controller
                control={control}
                name="resultRelease"
                render={({ field }) => (
                  <div role="radiogroup" id="resultRelease" className="grid gap-2 sm:grid-cols-3">
                    {releaseOptions.map((o) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={field.value === o.value}
                        key={o.value}
                        disabled={lockedField('resultRelease')}
                        onClick={() => field.onChange(o.value)}
                        className={cn(
                          'rounded-xl border p-3 text-left transition-colors disabled:opacity-50',
                          field.value === o.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent/50',
                        )}
                      >
                        <span className="block text-sm font-medium">{o.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              />
            </Field>
            <p className="mt-2 text-xs text-muted-foreground">Correct answers are never shown while a student could still use them in another attempt.</p>
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="sticky bottom-4 z-10 flex justify-end">
          <div className="glass flex items-center gap-3 rounded-xl p-2 pl-4">
            <span className="text-xs text-muted-foreground">{exam ? (isDirty ? 'Unsaved changes' : 'All changes saved') : 'Create the exam, then add questions'}</span>
            <Button type="submit" loading={isSubmitting} disabled={!!exam && !isDirty}>
              <Save /> {exam ? 'Save changes' : 'Create exam'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

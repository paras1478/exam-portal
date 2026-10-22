import { CalendarRange, Clock, Eye, FileQuestion, MinusCircle, Repeat, Trophy } from 'lucide-react';
import type { ExamDetail } from '@/lib/types';
import { formatDateTime, formatMinutes, formatScore, questionTypeLabel } from '@/lib/utils';
import { Badge, Card, CardContent, Textarea } from '@/components/ui/primitives';
import { Checkbox, RadioGroup, RadioGroupItem } from '@/components/ui/controls';
import { EmptyState } from '@/components/common';

/** Read-only rendering of the exam as a student sees it — no answer key. */
export function ExamPreview({ exam }: { exam: ExamDetail }) {
  const facts = [
    { icon: Clock, label: 'Duration', value: formatMinutes(exam.durationMinutes) },
    { icon: FileQuestion, label: 'Questions', value: `${exam.questions.length} · ${formatScore(exam.totalMarks)} marks` },
    { icon: Trophy, label: 'Pass marks', value: formatScore(exam.passMarks) },
    { icon: Repeat, label: 'Attempts', value: exam.maxAttempts },
    { icon: MinusCircle, label: 'Negative marking', value: exam.negativeMarking ? `−${exam.negativeMarkRatio * 100}% per wrong answer` : 'None' },
    { icon: CalendarRange, label: 'Window', value: `${formatDateTime(exam.startsAt)} – ${formatDateTime(exam.endsAt)}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
        <Eye className="h-4 w-4 text-primary" /> Student preview — correct answers are hidden and inputs are disabled.
      </div>

      <Card>
        <CardContent className="space-y-5 p-6">
          <div>
            <Badge variant="muted">{exam.subject}</Badge>
            <h2 className="mt-2 text-2xl font-semibold">{exam.title}</h2>
            {exam.description && <p className="mt-1 text-muted-foreground">{exam.description}</p>}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <f.icon className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                <div>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="text-sm font-medium">{f.value}</dd>
                </div>
              </div>
            ))}
          </dl>
          {exam.instructions && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Instructions</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {exam.instructions.split('\n').filter((l) => l.trim()).map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {exam.questions.length === 0 ? (
        <EmptyState icon={FileQuestion} title="No questions yet" description="Add questions to see how they appear to students." />
      ) : (
        exam.questions.map((q) => (
          <Card key={q.id}>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-muted-foreground">Question {q.order} of {exam.questions.length}</span>
                <div className="flex gap-2">
                  <Badge variant="violet">{questionTypeLabel[q.type]}</Badge>
                  <Badge variant="muted">{formatScore(q.marks)} {q.marks === 1 ? 'mark' : 'marks'}</Badge>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-base leading-relaxed">{q.text}</p>
              {q.type === 'DESCRIPTIVE' ? (
                <Textarea disabled rows={4} placeholder="Students type their answer here…" aria-label="Answer (preview)" />
              ) : q.type === 'MULTI_SELECT' ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Select all that apply</p>
                  {q.options.map((o) => (
                    <label key={o.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
                      <Checkbox disabled /> {o.text}
                    </label>
                  ))}
                </div>
              ) : (
                <RadioGroup disabled className="gap-2">
                  {q.options.map((o) => (
                    <label key={o.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
                      <RadioGroupItem value={o.id} /> {o.text}
                    </label>
                  ))}
                </RadioGroup>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Megaphone, Send, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Announcement } from '@/lib/types';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Textarea } from '@/components/ui/primitives';
import { RadioGroup, RadioGroupItem } from '@/components/ui/controls';
import { EmptyState, ErrorState, Field, ListSkeleton, PageHeader, Pagination } from '@/components/common';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';

const audienceLabel: Record<Announcement['audience'], string> = { ALL: 'Everyone', STUDENT: 'Students', FACULTY: 'Faculty' };

function MyAnnouncements() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['my-announcements', page],
    queryFn: () => api.page<Announcement>('/notifications/announcements/mine', { page, pageSize: 5 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Your announcements</CardTitle>
        <CardDescription>Messages you have sent, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <ListSkeleton rows={3} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" description="Announcements you send will be listed here." />
        ) : (
          <ul className={cn('space-y-3 transition-opacity', isFetching && 'opacity-70')}>
            {data.data.map((a) => (
              <li key={a.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{a.title}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="violet">{audienceLabel[a.audience]}</Badge>
                    <Badge variant="muted"><Users className="h-3 w-3" /> {a.recipients}</Badge>
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm text-muted-foreground">{a.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>{formatRelative(a.createdAt)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={data?.meta} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

const schema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120, 'Max 120 characters'),
  message: z.string().trim().min(3, 'Message must be at least 3 characters').max(2000, 'Max 2000 characters'),
  audience: z.enum(['ALL', 'STUDENT', 'FACULTY']),
});
type Values = z.infer<typeof schema>;

const AUDIENCES: { value: Values['audience']; label: string; desc: string }[] = [
  { value: 'STUDENT', label: 'All students', desc: 'Every active student account' },
  { value: 'FACULTY', label: 'All faculty', desc: 'Every active faculty member' },
  { value: 'ALL', label: 'Everyone', desc: 'All active accounts, including admins' },
];

export default function Announcements() {
  useDocumentTitle('Announcements');
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const audiences = isAdmin ? AUDIENCES : AUDIENCES.filter((a) => a.value === 'STUDENT');

  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', message: '', audience: 'STUDENT' },
  });
  const [title, message, audience] = watch(['title', 'message', 'audience']);

  const mutation = useMutation({
    mutationFn: (v: Values) => api.post<{ recipients: number }>('/notifications/announcements', v),
    onSuccess: (r) => {
      toast.success(`Announcement sent to ${r.recipients} recipient${r.recipients === 1 ? '' : 's'}`);
      reset({ title: '', message: '', audience });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['my-announcements'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Announcements"
        description={isAdmin ? 'Broadcast a message to students, faculty or everyone.' : 'Send a message to all students. It appears in their notification center.'}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-primary" /> Compose</CardTitle>
            <CardDescription>Recipients receive an in-app notification immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5" noValidate>
              <Field label="Title" htmlFor="a-title" error={errors.title?.message} required>
                <Input id="a-title" placeholder="e.g. Midterm schedule update" {...register('title')} aria-invalid={!!errors.title || undefined} />
              </Field>
              <Field label="Message" htmlFor="a-message" error={errors.message?.message} hint={`${message.length}/2000 characters`} required>
                <Textarea id="a-message" rows={7} placeholder="Write your announcement…" {...register('message')} aria-invalid={!!errors.message || undefined} />
              </Field>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium text-foreground/90">Audience</legend>
                <Controller
                  control={control}
                  name="audience"
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-3">
                      {audiences.map((a) => (
                        <label
                          key={a.value}
                          htmlFor={`aud-${a.value}`}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                            field.value === a.value ? 'border-primary/50 bg-primary/8' : 'border-border hover:bg-accent/50',
                          )}
                        >
                          <RadioGroupItem id={`aud-${a.value}`} value={a.value} className="mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium">{a.label}</span>
                            <span className="block text-xs text-muted-foreground">{a.desc}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
              </fieldset>
              <div className="flex justify-end">
                <Button type="submit" loading={mutation.isPending}><Send /> Send announcement</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Live preview</p>
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-xl bg-gradient-to-br from-[#8B5CF6]/25 to-[#8B5CF6]/5 p-2.5 text-[#8B5CF6]">
                <Megaphone className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                  <span className={cn('font-medium', !title.trim() && 'text-muted-foreground')}>{title.trim() || 'Announcement title'}</span>
                  <Badge variant="muted" className="text-[10px]">Announcement</Badge>
                </div>
                <p className={cn('mt-1 whitespace-pre-line break-words text-sm', message.trim() ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                  {message.trim() || 'Your message will appear here.'}
                  {'\n'}— {user?.name}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground/80">just now</p>
              </div>
            </div>
          </Card>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border p-3 text-sm text-muted-foreground">
            <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            Sending to <span className="font-medium text-foreground">{AUDIENCES.find((a) => a.value === audience)?.label.toLowerCase()}</span> (active accounts only).
          </div>
        </div>
      </div>
      <div className="mt-6">
        <MyAnnouncements />
      </div>
    </>
  );
}

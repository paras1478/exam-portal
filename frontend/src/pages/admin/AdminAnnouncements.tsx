import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, Send, Users } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { Announcement, AnnouncementAudience } from '@/lib/types';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Textarea } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { ConfirmDialog, EmptyState, ErrorState, Field, ListSkeleton, PageHeader, Pagination, SearchInput } from '@/components/common';
import { ALL, orUndefined, roleLabel, useUrlFilters } from '@/components/admin/helpers';

const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = { ALL: 'Everyone', STUDENT: 'All students', FACULTY: 'All faculty' };

const schema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120),
  message: z.string().trim().min(3, 'Message must be at least 3 characters').max(2000),
  audience: z.enum(['ALL', 'STUDENT', 'FACULTY']),
});
type Values = z.infer<typeof schema>;

export default function AdminAnnouncements() {
  useDocumentTitle('Announcements');
  const qc = useQueryClient();
  const { user } = useAuth();
  const { register, control, handleSubmit, watch, reset, setError, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', message: '', audience: 'STUDENT' },
  });
  const [pending, setPending] = useState<Values | null>(null);
  const preview = watch();

  const send = useMutation({
    mutationFn: (v: Values) => api.post<Announcement>('/admin/announcements', v),
    onSuccess: (a) => {
      toast.success(`Announcement sent to ${a.recipients} ${a.recipients === 1 ? 'person' : 'people'}`);
      reset({ title: '', message: '', audience: a.audience });
      void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        for (const k of ['title', 'message'] as const) {
          const m = e.field(k);
          if (m) setError(k, { message: m });
        }
      }
      toast.error(errorMessage(e));
    },
  });

  const [filters, setFilter] = useUrlFilters({ search: '', audience: ALL, page: '1' });
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== filters.search) setFilter('search', debounced);
  }, [debounced, filters.search, setFilter]);
  const query = { search: filters.search || undefined, audience: orUndefined(filters.audience), page: Number(filters.page) || 1, pageSize: 8 };
  const history = useQuery({
    queryKey: ['admin', 'announcements', query],
    queryFn: () => api.page<Announcement>('/admin/announcements', query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Announcements" description="Broadcast messages to students, faculty or everyone. Recipients see them in their notification center." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
            <CardDescription>Only active accounts receive the announcement.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => setPending(v))} className="space-y-4" noValidate>
              <Field label="Audience" htmlFor="ann-audience" required>
                <Controller
                  control={control}
                  name="audience"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ann-audience"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(AUDIENCE_LABEL) as AnnouncementAudience[]).map((a) => (
                          <SelectItem key={a} value={a}>{AUDIENCE_LABEL[a]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Title" htmlFor="ann-title" error={errors.title?.message} required>
                <Input id="ann-title" maxLength={120} aria-invalid={!!errors.title || undefined} {...register('title')} />
              </Field>
              <Field label="Message" htmlFor="ann-message" error={errors.message?.message} hint={`${preview.message?.length ?? 0} / 2000`} required>
                <Textarea id="ann-message" rows={6} maxLength={2000} aria-invalid={!!errors.message || undefined} {...register('message')} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" loading={send.isPending}><Send /> Send announcement</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>How it appears in the notification center</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border bg-background/40 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-2"><Megaphone className="h-4 w-4 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{preview.title?.trim() || 'Announcement title'}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {preview.message?.trim() || 'Your message will appear here.'}
                    {'\n'}— {user?.name}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">just now</p>
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" /> Sent to: {AUDIENCE_LABEL[preview.audience ?? 'STUDENT']}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <h2 className="font-semibold">History</h2>
          <SearchInput value={search} onChange={setSearch} placeholder="Search announcements" className="sm:ml-auto" />
          <Select value={filters.audience} onValueChange={(v) => setFilter('audience', v)}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by audience"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All audiences</SelectItem>
              {(Object.keys(AUDIENCE_LABEL) as AnnouncementAudience[]).map((a) => <SelectItem key={a} value={a}>{AUDIENCE_LABEL[a]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.isLoading ? (
          <ListSkeleton rows={4} />
        ) : !history.data?.data.length ? (
          <EmptyState icon={Megaphone} title={filters.search || query.audience ? 'No announcements match' : 'No announcements yet'} description="Sent announcements are listed here with their reach." />
        ) : (
          <ul className={history.isFetching ? 'space-y-3 opacity-70' : 'space-y-3'}>
            {history.data.data.map((a) => (
              <li key={a.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{a.title}</p>
                  <Badge variant="violet">{AUDIENCE_LABEL[a.audience]}</Badge>
                  <Badge variant="muted">{a.recipients} recipient{a.recipients === 1 ? '' : 's'}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground" title={formatDateTime(a.createdAt)}>{formatRelative(a.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  By {a.createdBy ? `${a.createdBy.name} (${roleLabel[a.createdBy.role]})` : 'a former user'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={history.data?.meta} onPageChange={(p) => setFilter('page', String(p))} />
      </Card>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Send this announcement?"
        description={pending ? <>“{pending.title}” will be sent to {AUDIENCE_LABEL[pending.audience].toLowerCase()} immediately. Announcements cannot be recalled.</> : undefined}
        confirmLabel="Send"
        onConfirm={() => send.mutateAsync(pending!)}
      />
    </>
  );
}

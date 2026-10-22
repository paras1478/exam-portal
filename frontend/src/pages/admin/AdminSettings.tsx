import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Save, ShieldCheck, UserPlus, BadgeCheck } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { AdminSettingsResponse, SystemSettings } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { ME_KEY, useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/controls';
import { ConfirmDialog, ErrorState, Field, PageHeader } from '@/components/common';

const schema = z.object({
  requireExamApproval: z.boolean(),
  facultyCanPublishResults: z.boolean(),
  allowStudentRegistration: z.boolean(),
  institutionName: z.string().trim().min(2, 'At least 2 characters').max(100, 'At most 100 characters'),
  supportEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email address')]),
});
type Values = z.infer<typeof schema>;

const LABELS: Record<keyof SystemSettings, string> = {
  requireExamApproval: 'Require exam approval',
  facultyCanPublishResults: 'Faculty can publish results',
  allowStudentRegistration: 'Allow student self-registration',
  institutionName: 'Institution name',
  supportEmail: 'Support email',
};

const TOGGLES: { key: 'requireExamApproval' | 'facultyCanPublishResults' | 'allowStudentRegistration'; icon: typeof ShieldCheck; on: string; off: string }[] = [
  {
    key: 'requireExamApproval',
    icon: ShieldCheck,
    on: 'Faculty submit exams for review. Exams can only be published after an administrator approves them, and approved content stays frozen.',
    off: 'Faculty may publish their own exams directly without review.',
  },
  {
    key: 'facultyCanPublishResults',
    icon: BadgeCheck,
    on: 'Faculty may publish results of their own exams. Corrections to released results still require an administrator.',
    off: 'Only administrators can publish results. Automatic release settings on approved exams (immediate / after the window) still apply.',
  },
  {
    key: 'allowStudentRegistration',
    icon: UserPlus,
    on: 'Anyone can create a student account from the registration page.',
    off: 'Registration is closed. Student accounts must be created by an administrator.',
  },
];

const display = (v: unknown) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : v === '' ? '(empty)' : String(v));

export default function AdminSettings() {
  useDocumentTitle('System settings');
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can('settings:manage');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettingsResponse>('/admin/settings'),
  });

  const { register, control, handleSubmit, reset, watch, setError, formState } = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors, isDirty } = formState;
  useEffect(() => {
    if (data) reset(data.settings);
  }, [data, reset]);

  const [pending, setPending] = useState<Partial<Values> | null>(null);
  const mutation = useMutation({
    mutationFn: (patch: Partial<Values>) => api.patch<{ settings: SystemSettings }>('/admin/settings', patch),
    onSuccess: (r) => {
      toast.success('Settings saved');
      reset(r.settings);
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        for (const k of ['institutionName', 'supportEmail'] as const) {
          const m = e.field(k);
          if (m) setError(k, { message: m });
        }
      }
      toast.error(errorMessage(e));
    },
  });

  const onSubmit = handleSubmit((v) => {
    if (!data) return;
    const changed = (Object.keys(v) as (keyof Values)[]).filter((k) => v[k] !== data.settings[k]);
    if (!changed.length) {
      toast.info('No changes to save');
      return;
    }
    setPending(Object.fromEntries(changed.map((k) => [k, v[k]])) as Partial<Values>);
  });

  const meta = (key: keyof SystemSettings) => {
    const m = data?.meta[key];
    return m ? `Last changed ${formatDateTime(m.updatedAt)}${m.updatedBy ? ` by ${m.updatedBy}` : ''}` : 'Using the default value';
  };

  if (error) {
    return (
      <>
        <PageHeader title="System settings" />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="System settings"
        description="Institution-wide policies. Changes apply immediately and are recorded in the audit log."
        actions={
          canManage ? (
            <Button onClick={() => void onSubmit()} disabled={!isDirty || isLoading} loading={mutation.isPending}>
              <Save /> Save changes
            </Button>
          ) : undefined
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Policies</CardTitle>
              <CardDescription>Control the examination workflow and who may publish results.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {TOGGLES.map((t) => {
                const value = watch(t.key);
                return (
                  <div key={t.key} className="flex items-start gap-4 rounded-xl border border-border p-4">
                    <div className="rounded-xl bg-gradient-to-br from-[#4F8CFF]/20 to-[#8B5CF6]/20 p-2.5">
                      <t.icon className="h-5 w-5 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label htmlFor={`s-${t.key}`} className="font-medium">{LABELS[t.key]}</label>
                      <p id={`s-${t.key}-desc`} className="mt-0.5 text-sm text-muted-foreground">{value ? t.on : t.off}</p>
                      <p className="mt-1 text-xs text-muted-foreground/80">{meta(t.key)}</p>
                    </div>
                    <Controller
                      control={control}
                      name={t.key}
                      render={({ field }) => (
                        <Switch id={`s-${t.key}`} checked={field.value} onCheckedChange={field.onChange} disabled={!canManage} aria-describedby={`s-${t.key}-desc`} />
                      )}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Institution</CardTitle>
              <CardDescription>Shown on the sign-in and registration pages.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Institution name" htmlFor="s-name" error={errors.institutionName?.message} hint={meta('institutionName')} required>
                <Input id="s-name" disabled={!canManage} aria-invalid={!!errors.institutionName || undefined} {...register('institutionName')} />
              </Field>
              <Field label="Support email" htmlFor="s-email" error={errors.supportEmail?.message} hint={meta('supportEmail')}>
                <Input id="s-email" type="email" placeholder="exams@your-school.edu" disabled={!canManage} aria-invalid={!!errors.supportEmail || undefined} {...register('supportEmail')} />
              </Field>
            </CardContent>
          </Card>

          {canManage && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={!isDirty} onClick={() => reset(data.settings)}>Discard changes</Button>
              <Button type="submit" disabled={!isDirty} loading={mutation.isPending}><Save /> Save changes</Button>
            </div>
          )}
        </form>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Apply these changes?"
        description={
          pending && data ? (
            <ul className="mt-1 space-y-1">
              {(Object.keys(pending) as (keyof Values)[]).map((k) => (
                <li key={k}>
                  <span className="font-medium text-foreground">{LABELS[k]}</span>: {display(data.settings[k])} → {display(pending[k])}
                </li>
              ))}
            </ul>
          ) : undefined
        }
        confirmLabel="Save settings"
        onConfirm={() => mutation.mutateAsync(pending!)}
      />
    </>
  );
}

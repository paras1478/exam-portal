import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { SessionUser, User } from '@/lib/types';
import { formatDate, formatDateTime, initials } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Field, FullPageLoader, PageHeader, UserStatusBadge } from '@/components/common';
import { RoleBadge } from '@/components/admin/helpers';

const optional = (max: number) => z.string().trim().max(max, `Max ${max} characters`).optional();

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  department: optional(100),
  designation: optional(100),
  year: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && +v >= 1 && +v <= 10), 'Year must be between 1 and 10'),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine((v) => !v || /^[+\d][\d\s()-]{5,}$/.test(v), 'Enter a valid phone number'),
});
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .max(128)
      .regex(/[A-Za-z]/, 'Must contain a letter')
      .regex(/\d/, 'Must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'New password must differ from the current one', path: ['newPassword'] });
type PasswordValues = z.infer<typeof passwordSchema>;

const blank = (v?: string) => (v && v.trim() ? v.trim() : null);

function ProfileForm({ user }: { user: User }) {
  const { setUser } = useAuth();
  const isStudent = user.role === 'STUDENT';
  const isFaculty = user.role === 'FACULTY';
  const defaults = (u: User): ProfileValues => ({
    name: u.name,
    department: u.studentProfile?.department ?? u.facultyProfile?.department ?? '',
    designation: u.facultyProfile?.designation ?? '',
    year: u.studentProfile?.year ? String(u.studentProfile.year) : '',
    phone: u.studentProfile?.phone ?? u.facultyProfile?.phone ?? '',
  });
  const { register, handleSubmit, reset, setError, formState } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: defaults(user) });
  const { errors, isDirty } = formState;

  useEffect(() => reset(defaults(user)), [user, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (v: ProfileValues) =>
      api.patch<SessionUser>('/auth/me', {
        name: v.name,
        ...(isStudent && { student: { department: blank(v.department), year: v.year ? Number(v.year) : null, phone: blank(v.phone) } }),
        ...(isFaculty && { faculty: { department: blank(v.department), designation: blank(v.designation), phone: blank(v.phone) } }),
      }),
    onSuccess: (u) => {
      setUser(u);
      toast.success('Profile updated');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.field('name')) setError('name', { message: e.field('name') });
      toast.error(errorMessage(e));
    },
  });

  const aria = (k: keyof ProfileValues) => ({ 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': errors[k] ? `p-${k}-error` : undefined });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal details</CardTitle>
        <CardDescription>Keep your contact and academic information up to date.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="p-name" error={errors.name?.message} required>
              <Input id="p-name" autoComplete="name" {...register('name')} {...aria('name')} />
            </Field>
            <Field label="Email" htmlFor="p-email" hint="Contact an administrator to change your email.">
              <Input id="p-email" value={user.email} readOnly disabled />
            </Field>
          </div>
          {isStudent && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Roll number" htmlFor="p-roll" hint="Assigned by your institution.">
                <Input id="p-roll" value={user.studentProfile?.rollNumber ?? 'Not assigned'} readOnly disabled />
              </Field>
              <Field label="Department" htmlFor="p-department" error={errors.department?.message}>
                <Input id="p-department" {...register('department')} {...aria('department')} />
              </Field>
              <Field label="Year of study" htmlFor="p-year" error={errors.year?.message}>
                <Input id="p-year" inputMode="numeric" {...register('year')} {...aria('year')} />
              </Field>
              <Field label="Phone" htmlFor="p-phone" error={errors.phone?.message}>
                <Input id="p-phone" type="tel" autoComplete="tel" {...register('phone')} {...aria('phone')} />
              </Field>
            </div>
          )}
          {isFaculty && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee ID" htmlFor="p-emp" hint="Assigned by your institution.">
                <Input id="p-emp" value={user.facultyProfile?.employeeId ?? 'Not assigned'} readOnly disabled />
              </Field>
              <Field label="Department" htmlFor="p-department" error={errors.department?.message}>
                <Input id="p-department" {...register('department')} {...aria('department')} />
              </Field>
              <Field label="Designation" htmlFor="p-designation" error={errors.designation?.message}>
                <Input id="p-designation" {...register('designation')} {...aria('designation')} />
              </Field>
              <Field label="Phone" htmlFor="p-phone" error={errors.phone?.message}>
                <Input id="p-phone" type="tel" autoComplete="tel" {...register('phone')} {...aria('phone')} />
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={!isDirty || mutation.isPending} onClick={() => reset(defaults(user))}>Discard</Button>
            <Button type="submit" loading={mutation.isPending} disabled={!isDirty}>Save changes</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const [show, setShow] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (v: PasswordValues) => api.post('/auth/me/password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      reset();
      toast.success('Password changed');
    },
    onError: (e) => {
      if (e instanceof ApiRequestError) {
        if (e.field('currentPassword')) setError('currentPassword', { message: e.field('currentPassword') });
        if (e.field('newPassword')) setError('newPassword', { message: e.field('newPassword') });
      }
      toast.error(errorMessage(e));
    },
  });
  const type = show ? 'text' : 'password';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Change password</CardTitle>
        <CardDescription>Use at least 8 characters including a letter and a number.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
          <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword?.message} required>
            <Input id="pw-current" type={type} autoComplete="current-password" {...register('currentPassword')} aria-invalid={!!errors.currentPassword || undefined} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="pw-new" error={errors.newPassword?.message} required>
              <Input id="pw-new" type={type} autoComplete="new-password" {...register('newPassword')} aria-invalid={!!errors.newPassword || undefined} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirmPassword?.message} required>
              <Input id="pw-confirm" type={type} autoComplete="new-password" {...register('confirmPassword')} aria-invalid={!!errors.confirmPassword || undefined} />
            </Field>
          </div>
          <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? <EyeOff /> : <Eye />} {show ? 'Hide passwords' : 'Show passwords'}
            </Button>
            <Button type="submit" loading={mutation.isPending}>Update password</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Profile() {
  useDocumentTitle('Profile');
  const { user } = useAuth();
  if (!user) return <FullPageLoader />;

  const info = [
    { icon: Mail, label: 'Email', value: user.email },
    { icon: ShieldCheck, label: 'Status', value: <UserStatusBadge status={user.status} /> },
    { icon: UserRound, label: 'Member since', value: formatDate(user.createdAt) },
    { icon: CalendarClock, label: 'Last sign-in', value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This session' },
  ];

  return (
    <>
      <PageHeader title="Profile & settings" description="Manage your personal information and account security." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit overflow-hidden lg:sticky lg:top-24">
          <div className="h-20 bg-brand-gradient opacity-80" aria-hidden />
          <CardContent className="-mt-10 pt-0">
            <Avatar className="h-20 w-20 border-4 border-card-solid">
              <AvatarFallback className="text-xl">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <h2 className="mt-3 text-lg font-semibold">{user.name}</h2>
            <div className="mt-1"><RoleBadge role={user.role} /></div>
            <Separator className="my-4" />
            <dl className="space-y-3">
              {info.map((i) => (
                <div key={i.label} className="flex items-start gap-3">
                  <i.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{i.label}</dt>
                    <dd className="truncate text-sm">{i.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <ProfileForm user={user} />
          <PasswordForm />
        </div>
      </div>
    </>
  );
}

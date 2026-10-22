import { useEffect, useState, type FormEvent } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { api, ApiRequestError, errorMessage } from '@/lib/api';
import type { Role, User, UserStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { Field } from '@/components/common';
import { roleLabel } from './helpers';
import { deleteWithBody } from './request';

const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

const optional = (max: number) => z.string().trim().max(max, `Max ${max} characters`).optional();

const userSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().optional(),
  role: z.enum(['STUDENT', 'FACULTY', 'ADMIN']),
  rollNumber: optional(40),
  employeeId: optional(40),
  department: optional(100),
  designation: optional(100),
  year: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d+$/.test(v) && +v >= 1 && +v <= 10), 'Year must be between 1 and 10'),
  phone: optional(30),
});
type UserFormValues = z.infer<typeof userSchema>;

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

function invalidateUsers(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['admin'] });
}

/** Create (no `user`) or edit (with `user`) an account. */
export function UserFormDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user?: User | null }) {
  const qc = useQueryClient();
  const editing = !!user;
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<UserFormValues>({ resolver: zodResolver(userSchema) });
  const { register, handleSubmit, control, watch, reset, setError, formState } = form;
  const { errors } = formState;
  const role = watch('role');

  useEffect(() => {
    if (!open) return;
    setShowPassword(false);
    reset({
      name: user?.name ?? '',
      email: user?.email ?? '',
      password: '',
      role: user?.role ?? 'STUDENT',
      rollNumber: user?.studentProfile?.rollNumber ?? '',
      employeeId: user?.facultyProfile?.employeeId ?? '',
      department: user?.studentProfile?.department ?? user?.facultyProfile?.department ?? '',
      designation: user?.facultyProfile?.designation ?? '',
      year: user?.studentProfile?.year ? String(user.studentProfile.year) : '',
      phone: user?.studentProfile?.phone ?? user?.facultyProfile?.phone ?? '',
    });
  }, [open, user, reset]);

  const mutation = useMutation({
    mutationFn: async (v: UserFormValues) => {
      const student = { rollNumber: blank(v.rollNumber), department: blank(v.department), year: v.year ? Number(v.year) : null, phone: blank(v.phone) };
      const faculty = { employeeId: blank(v.employeeId), department: blank(v.department), designation: blank(v.designation), phone: blank(v.phone) };
      const profile = v.role === 'STUDENT' ? { student } : v.role === 'FACULTY' ? { faculty } : {};
      if (editing) return api.patch<User>(`/admin/users/${user!.id}`, { name: v.name, email: v.email, ...profile });
      return api.post<User>('/admin/users', { name: v.name, email: v.email, password: v.password, role: v.role, ...profile });
    },
    onSuccess: (u) => {
      toast.success(editing ? `Updated ${u.name}` : `Created account for ${u.name}`);
      invalidateUsers(qc);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError) {
        if (err.code === 'EMAIL_TAKEN') setError('email', { message: err.message });
        // DUPLICATE errors name the clashing field (rollNumber / employeeId / email) in fieldErrors.
        for (const key of ['name', 'email', 'password', 'rollNumber', 'employeeId'] as const) {
          const msg = err.field(key);
          if (msg) setError(key, { message: msg });
        }
      }
      toast.error(errorMessage(err));
    },
  });

  const onSubmit = handleSubmit((v) => {
    if (!editing) {
      const pw = passwordRule.safeParse(v.password ?? '');
      if (!pw.success) {
        setError('password', { message: pw.error.issues[0]!.message });
        return;
      }
    }
    mutation.mutate(v);
  });

  const err = (k: keyof UserFormValues) => errors[k]?.message;
  const aria = (k: keyof UserFormValues) => ({ 'aria-invalid': !!errors[k] || undefined, 'aria-describedby': errors[k] ? `u-${k}-error` : undefined });

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'Add user'}</DialogTitle>
          <DialogDescription>{editing ? 'Update account and profile details.' : 'Create an account. A welcome email is sent if SMTP is configured.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="u-name" error={err('name')} required>
              <Input id="u-name" autoComplete="off" {...register('name')} {...aria('name')} />
            </Field>
            <Field label="Email" htmlFor="u-email" error={err('email')} required>
              <Input id="u-email" type="email" autoComplete="off" {...register('email')} {...aria('email')} />
            </Field>
          </div>
          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role" htmlFor="u-role" required>
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="u-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['STUDENT', 'FACULTY'] as Role[]).map((r) => (
                          <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">Administrator rights are granted afterwards with “Change role”.</p>
              </Field>
              <Field label="Initial password" htmlFor="u-password" error={err('password')} hint="8+ characters with a letter and a number" required>
                <div className="relative">
                  <Input id="u-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="pr-10" {...register('password')} {...aria('password')} />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
            </div>
          )}

          {role === 'STUDENT' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Roll number" htmlFor="u-roll" error={err('rollNumber')}>
                <Input id="u-roll" {...register('rollNumber')} {...aria('rollNumber')} />
              </Field>
              <Field label="Department" htmlFor="u-dept" error={err('department')}>
                <Input id="u-dept" {...register('department')} />
              </Field>
              <Field label="Year" htmlFor="u-year" error={err('year')}>
                <Input id="u-year" inputMode="numeric" {...register('year')} {...aria('year')} />
              </Field>
              <Field label="Phone" htmlFor="u-phone" error={err('phone')}>
                <Input id="u-phone" type="tel" {...register('phone')} />
              </Field>
            </div>
          )}
          {role === 'FACULTY' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee ID" htmlFor="u-emp" error={err('employeeId')}>
                <Input id="u-emp" {...register('employeeId')} />
              </Field>
              <Field label="Department" htmlFor="u-dept" error={err('department')}>
                <Input id="u-dept" {...register('department')} />
              </Field>
              <Field label="Designation" htmlFor="u-desig" error={err('designation')}>
                <Input id="u-desig" {...register('designation')} />
              </Field>
              <Field label="Phone" htmlFor="u-phone" error={err('phone')}>
                <Input id="u-phone" type="tel" {...register('phone')} />
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending}>{editing ? 'Save changes' : 'Create user'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RoleDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>('STUDENT');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (user) setRole(user.role);
    setReason('');
  }, [user]);
  const mutation = useMutation({
    mutationFn: () => api.patch<User>(`/admin/users/${user!.id}/role`, { role, reason: reason.trim() || undefined }),
    onSuccess: (u) => {
      toast.success(`${u.name} is now ${roleLabel[u.role].toLowerCase()}`);
      invalidateUsers(qc);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Change the role of <span className="font-medium text-foreground">{user?.name}</span>. The change is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <Field label="New role" htmlFor="role-select">
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="role-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['STUDENT', 'FACULTY', 'ADMIN'] as Role[]).map((r) => (
                <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reason (optional, recorded in the audit log)" htmlFor="role-reason">
          <Textarea id="role-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
        </Field>
        {role === 'ADMIN' && user?.role !== 'ADMIN' && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Administrators have full access to all accounts, exams, results and settings.</p>
        )}
        {role !== user?.role && (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
            {user?.name} will be signed out of every device and must sign in again to use the new role.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={role === user?.role}>Confirm change</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const statusCopy: Record<UserStatus, { verb: string; desc: string }> = {
  ACTIVE: { verb: 'Activate', desc: 'The user will be able to sign in and use the platform again.' },
  INACTIVE: { verb: 'Deactivate', desc: 'All of the user’s sessions are revoked immediately and they cannot sign in until reactivated.' },
  SUSPENDED: { verb: 'Suspend', desc: 'All of the user’s sessions are revoked immediately and sign-in is blocked. Use for policy violations.' },
};

export function StatusDialog({ target, onOpenChange }: { target: { user: User; status: UserStatus } | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [target]);
  const mutation = useMutation({
    mutationFn: () => api.patch<User>(`/admin/users/${target!.user.id}/status`, { status: target!.status, reason: reason.trim() || undefined }),
    onSuccess: (u) => {
      toast.success(`${u.name} is now ${u.status.toLowerCase()}`);
      invalidateUsers(qc);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const copy = target ? statusCopy[target.status] : null;
  return (
    <Dialog open={!!target} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy?.verb} {target?.user.name}?</DialogTitle>
          <DialogDescription>{copy?.desc}</DialogDescription>
        </DialogHeader>
        {target?.status !== 'ACTIVE' && (
          <Field label="Reason (optional, recorded in the audit log)" htmlFor="status-reason">
            <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button variant={target?.status === 'ACTIVE' ? 'success' : 'destructive'} onClick={() => mutation.mutate()} loading={mutation.isPending}>
            {copy?.verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (o: boolean) => void }) {
  const [pw, setPw] = useState('');
  const [error, setErr] = useState<string>();
  const [show, setShow] = useState(false);
  useEffect(() => {
    setPw('');
    setErr(undefined);
    setShow(false);
  }, [user]);
  const mutation = useMutation({
    mutationFn: () => api.post(`/admin/users/${user!.id}/reset-password`, { newPassword: pw }),
    onSuccess: () => {
      toast.success(`Password reset for ${user!.name}. Share it with them securely.`);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.field('newPassword')) setErr(e.field('newPassword'));
      toast.error(errorMessage(e));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = passwordRule.safeParse(pw);
    if (!r.success) return setErr(r.error.issues[0]!.message);
    setErr(undefined);
    mutation.mutate();
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for <span className="font-medium text-foreground">{user?.name}</span>.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" htmlFor="reset-pw" error={error} hint="8+ characters with a letter and a number" required>
            <div className="relative">
              <Input id="reset-pw" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!error || undefined} className="pr-10" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" loading={mutation.isPending}>Reset password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes an account under the retention policy: hard delete without history, otherwise deactivate and retain. */
export function DeleteUserDialog({ user, onOpenChange }: { user: User | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [user]);
  const mutation = useMutation({
    mutationFn: () => deleteWithBody<{ deleted: boolean; mode: 'HARD' | 'SOFT' }>(`/admin/users/${user!.id}`, { reason: reason.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(
        r.mode === 'HARD'
          ? `${user!.name}'s account was permanently deleted.`
          : `${user!.name}'s account was deactivated and retained because it has academic or audit records.`,
      );
      invalidateUsers(qc);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {user?.name}?</DialogTitle>
          <DialogDescription>
            Accounts without any history are removed permanently. Accounts with attempts, results, authored exams, gradings or audit
            entries are deactivated and hidden instead, so academic records are preserved. Either way the user is signed out everywhere.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason (optional, recorded in the audit log)" htmlFor="delete-reason">
          <Textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} loading={mutation.isPending}>Delete account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

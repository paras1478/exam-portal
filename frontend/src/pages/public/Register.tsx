import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, UserPlus, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { AuthLayout } from './PublicLayout';
import { usePublicSettings } from './usePublicSettings';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().trim().email('Enter a valid email address'),
    rollNumber: z.string().trim().max(40).optional(),
    department: z.string().trim().max(100).optional(),
    year: z.union([z.literal(''), z.coerce.number().int().min(1, 'Year must be 1–10').max(10, 'Year must be 1–10')]).optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must contain a letter')
      .regex(/\d/, 'Password must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

type FormValues = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

export default function Register() {
  useDocumentTitle('Create account');
  const { register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<FormValues, unknown, Parsed>({ resolver: zodResolver(schema) });
  const { data: settings, isLoading: settingsLoading } = usePublicSettings();

  const onSubmit = async (v: Parsed) => {
    setFormError(null);
    try {
      await registerAccount({
        name: v.name,
        email: v.email,
        password: v.password,
        rollNumber: v.rollNumber || undefined,
        department: v.department || undefined,
        year: typeof v.year === 'number' ? v.year : undefined,
      });
      toast.success(`Account created. Welcome to ${settings?.institutionName ?? 'ExamFlow'}!`);
      navigate('/student', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        let mapped = false;
        for (const f of ['name', 'email', 'password', 'rollNumber', 'department', 'year'] as const) {
          const m = err.field(f);
          if (m) {
            setError(f, { message: m });
            mapped = true;
          }
        }
        if (err.code === 'EMAIL_TAKEN') {
          setError('email', { message: err.message });
          mapped = true;
        }
        if (mapped) return;
      }
      setFormError(errorMessage(err));
    }
  };

  const fieldProps = (name: keyof FormValues) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    ...register(name),
  });

  const institution = settings?.institutionName;

  if (settingsLoading) {
    return (
      <AuthLayout title="Create your student account" subtitle="Checking registration availability…" footer={null}>
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (settings && !settings.allowStudentRegistration) {
    return (
      <AuthLayout
        title="Registration is closed"
        subtitle={institution ? `${institution} is not accepting self-registration right now.` : 'Self-registration is not available right now.'}
        footer={
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <div className="mb-4 rounded-2xl bg-gradient-to-br from-[#4F8CFF]/20 to-[#8B5CF6]/20 p-4">
            <UserX className="h-7 w-7 text-primary" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">Student accounts are currently created by your institution.</p>
          {settings.supportEmail ? (
            <Button asChild variant="outline" className="mt-5">
              <a href={`mailto:${settings.supportEmail}`}><Mail /> Contact {settings.supportEmail}</a>
            </Button>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Please contact your examination office for an account.</p>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your student account"
      subtitle={`${institution ? `Join ${institution}. ` : ''}Faculty and administrator accounts are created by your institution.`}
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Field label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" autoFocus {...fieldProps('name')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" {...fieldProps('email')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Department" htmlFor="department" error={errors.department?.message}>
              <Input id="department" placeholder="Computer Science" {...fieldProps('department')} />
            </Field>
          </div>
          <Field label="Year" htmlFor="year" error={errors.year?.message}>
            <Input id="year" type="number" min={1} max={10} inputMode="numeric" {...fieldProps('year')} />
          </Field>
        </div>
        <Field label="Roll number" htmlFor="rollNumber" error={errors.rollNumber?.message} hint="Optional. Can't be changed later without an administrator.">
          <Input id="rollNumber" {...fieldProps('rollNumber')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number." required>
          <Input id="password" type="password" autoComplete="new-password" {...fieldProps('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={errors.confirmPassword?.message} required>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...fieldProps('confirmPassword')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          {!isSubmitting && <UserPlus />} Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

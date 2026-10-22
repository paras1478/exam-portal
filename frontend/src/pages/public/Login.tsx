import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { errorMessage } from '@/lib/api';
import { roleHome, firstName } from '@/lib/utils';
import { AuthLayout } from './PublicLayout';
import { usePublicSettings } from './usePublicSettings';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export default function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { data: settings } = usePublicSettings();

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${firstName(user.name)}!`);
      const from = (location.state as { from?: string } | null)?.from;
      // Only follow the redirect when it belongs to the user's own area.
      const home = roleHome[user.role];
      const safe = from && (from.startsWith(home) || from.startsWith('/profile') || from.startsWith('/notifications') || (user.role === 'STUDENT' && from.startsWith('/attempt/')));
      navigate(safe ? from : home, { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  // Hide the sign-up link only once we know registration is closed (avoids flicker for the common case).
  const registrationOpen = settings?.allowStudentRegistration ?? true;

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={settings?.institutionName ? `Sign in to ${settings.institutionName}.` : 'Sign in to continue to your workspace.'}
      footer={
        registrationOpen ? (
          <>
            New student?{' '}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>Need an account? Contact {settings?.supportEmail || 'your institution'}.</>
        )
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Field label="Email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pr-10"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          {!isSubmitting && <LogIn />} Sign in
        </Button>
      </form>
      {import.meta.env.DEV && (
        <div className="mt-6 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Development demo accounts</p>
          <p>admin@examflow.dev · Admin@12345</p>
          <p>faculty@examflow.dev · Faculty@12345</p>
          <p>student@examflow.dev · Student@12345</p>
        </div>
      )}
    </AuthLayout>
  );
}

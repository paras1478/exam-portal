import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackgroundOrbs, Logo } from '@/components/common';
import { ThemeToggle } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { roleHome } from '@/lib/utils';

export function PublicHeader() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="ExamFlow home">
          <Logo />
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Button asChild size="sm">
              <Link to={roleHome[user.role]}>Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/register">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <BackgroundOrbs />
      <PublicHeader />
      <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2">
        <section className="hidden lg:block">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-primary">Online examinations</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Fair, secure exams with <span className="text-gradient">instant insight</span>.
          </h2>
          <ul className="mt-8 space-y-4 text-muted-foreground">
            {[
              'Server-timed attempts that survive refreshes and dropped connections',
              'Automatic grading with negative marking and manual review',
              'Results released exactly when you decide',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gradient" />
                {t}
              </li>
            ))}
          </ul>
        </section>
        <section className="glass mx-auto w-full max-w-md rounded-2xl p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        </section>
      </main>
    </div>
  );
}

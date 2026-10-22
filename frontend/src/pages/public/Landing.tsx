import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BarChart3, CheckCircle2, Clock, FileCheck2, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { BackgroundOrbs, Logo } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { roleHome } from '@/lib/utils';
import { PublicHeader } from './PublicLayout';

const features = [
  { icon: Clock, title: 'Server-authoritative timing', text: 'Deadlines are enforced on the server. Refreshes, crashes and network drops never cost a student their answers.' },
  { icon: FileCheck2, title: 'Automatic evaluation', text: 'Objective questions are graded instantly, with optional negative marking. Descriptive answers go to faculty review.' },
  { icon: ShieldCheck, title: 'Secure by design', text: 'HTTP-only sessions, CSRF protection, rate limiting, role-based access and a full audit trail.' },
  { icon: BarChart3, title: 'Actionable analytics', text: 'Score distributions, question difficulty and subject-wise progress for students and faculty.' },
  { icon: Users, title: 'Three tailored workspaces', text: 'Purpose-built dashboards for students, faculty and administrators.' },
  { icon: Sparkles, title: 'Controlled result release', text: 'Release immediately, after the window closes, or manually — answers stay hidden until then.' },
];

export default function Landing() {
  useDocumentTitle('Online Examination & Result Management');
  const { user } = useAuth();
  const primaryCta = user ? { to: roleHome[user.role], label: 'Open your dashboard' } : { to: '/register', label: 'Create a student account' };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <BackgroundOrbs />
      <PublicHeader />

      <main>
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Examinations, results and analytics in one place
            </span>
            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
              Run online exams your students <span className="text-gradient">can trust</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
              ExamFlow handles scheduling, timed attempts, automatic grading and result publishing, so faculty can focus on teaching and
              students on learning.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to={primaryCta.to}>
                  {primaryCta.label} <ArrowRight />
                </Link>
              </Button>
              {!user && (
                <Button asChild size="lg" variant="outline">
                  <Link to="/login">Sign in</Link>
                </Button>
              )}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }} className="mx-auto mt-16 max-w-5xl">
            <Card className="p-4 text-left sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Live exam</p>
                  <p className="font-semibold">JavaScript Fundamentals</p>
                </div>
                <div className="rounded-xl bg-primary/12 px-3 py-1.5 font-mono text-lg font-semibold text-primary tabular-nums">24:18</div>
              </div>
              <div className="grid gap-6 pt-5 md:grid-cols-[1fr_220px]">
                <div>
                  <p className="text-sm text-muted-foreground">Question 3 of 5 · 3 marks</p>
                  <p className="mt-2 font-medium">Which of the following are primitive types in JavaScript?</p>
                  <div className="mt-4 space-y-2">
                    {[['string', true], ['symbol', true], ['array', false], ['bigint', true]].map(([o, c]) => (
                      <div key={String(o)} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${c ? 'border-primary/50 bg-primary/10' : 'border-border'}`}>
                        <span className={`grid h-5 w-5 place-items-center rounded-md border ${c ? 'border-primary bg-primary text-white' : 'border-input'}`}>
                          {c && <CheckCircle2 className="h-3.5 w-3.5" />}
                        </span>
                        <code>{String(o)}</code>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Question palette</p>
                  <div className="grid grid-cols-5 gap-2">
                    {['bg-emerald-500', 'bg-emerald-500', 'bg-primary ring-2 ring-primary/40', 'bg-violet-500', 'bg-muted'].map((c, i) => (
                      <span key={i} className={`grid aspect-square place-items-center rounded-lg text-xs font-semibold text-white ${c}`}>
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">All changes saved · 2 answered</p>
                </div>
              </div>
            </Card>
          </motion.div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6" aria-labelledby="features-heading">
          <h2 id="features-heading" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything an examination cell needs
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
                <Card className="h-full p-6">
                  <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-[#4F8CFF]/25 to-[#8B5CF6]/20 p-2.5">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo className="scale-90" />
          <p>© {new Date().getFullYear()} ExamFlow. Built for fair assessment.</p>
        </div>
      </footer>
    </div>
  );
}

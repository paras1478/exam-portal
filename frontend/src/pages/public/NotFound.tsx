import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { BackgroundOrbs } from '@/components/common';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useDocumentTitle } from '@/hooks';
import { roleHome } from '@/lib/utils';

export default function NotFound() {
  useDocumentTitle('Page not found');
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <BackgroundOrbs />
      <div className="glass max-w-md rounded-2xl p-8 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#4F8CFF]/25 to-[#8B5CF6]/25">
          <Compass className="h-7 w-7 text-primary" />
        </div>
        <p className="text-gradient text-5xl font-bold">404</p>
        <h1 className="mt-3 text-xl font-semibold">This page wandered off</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft /> Go back
          </Button>
          <Button asChild>
            <Link to={user ? roleHome[user.role] : '/'}>{user ? 'Back to dashboard' : 'Go home'}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

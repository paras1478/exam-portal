import { isRouteErrorResponse } from 'react-router-dom';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { BackgroundOrbs } from '@/components/common';
import { Button } from '@/components/ui/button';
import NotFound from './NotFound';

/** Shown when a route throws during render or a lazy chunk fails to load (e.g. after a deploy). */
export default function RouteError({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const chunkFailed = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <BackgroundOrbs />
      <div role="alert" className="glass max-w-md rounded-2xl p-8 text-center">
        <AlertOctagon className="mx-auto mb-4 h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">{chunkFailed ? 'A new version is available' : 'Something went wrong'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {chunkFailed
            ? 'Reload the page to get the latest version of ExamFlow.'
            : 'An unexpected error occurred. Your exam answers are saved on the server — reloading is safe.'}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw /> Reload page
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = '/')}>
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}

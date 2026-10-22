import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { BellOff, BookOpenCheck, CheckCheck, FileBarChart, Info, Megaphone, Trash2, UserCog, type LucideIcon } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Notification, NotificationType } from '@/lib/types';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { useDocumentTitle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/controls';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination } from '@/components/common';

const typeMeta: Record<NotificationType, { icon: LucideIcon; label: string; cls: string }> = {
  INFO: { icon: Info, label: 'Info', cls: 'from-slate-500/25 to-slate-500/5 text-slate-400' },
  EXAM: { icon: BookOpenCheck, label: 'Exam', cls: 'from-[#4F8CFF]/25 to-[#4F8CFF]/5 text-[#4F8CFF]' },
  RESULT: { icon: FileBarChart, label: 'Result', cls: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500' },
  ANNOUNCEMENT: { icon: Megaphone, label: 'Announcement', cls: 'from-[#8B5CF6]/25 to-[#8B5CF6]/5 text-[#8B5CF6]' },
  ACCOUNT: { icon: UserCog, label: 'Account', cls: 'from-amber-500/25 to-amber-500/5 text-amber-500' },
};

export default function Notifications() {
  useDocumentTitle('Notifications');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);

  const query = { page, pageSize: 15, unreadOnly: tab === 'unread' ? 'true' : undefined };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['notifications', 'list', query],
    queryFn: () => api.page<Notification>('/notifications', query),
    placeholderData: keepPreviousData,
  });
  const unread = (data?.meta.unreadCount as number | undefined) ?? 0;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({ mutationFn: (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: invalidate });
  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      toast.success(r.updated ? `Marked ${r.updated} notification${r.updated === 1 ? '' : 's'} as read` : 'Everything is already read');
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      toast.success('Notification deleted');
      // Step back a page if the last item on this page was removed.
      if (data && data.data.length === 1 && page > 1) setPage(page - 1);
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const items = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : "You're all caught up."}
        actions={
          <Button variant="outline" onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={!unread}>
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <Card className="p-4 sm:p-5">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as 'all' | 'unread'); setPage(1); }}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread {unread > 0 && <Badge className="ml-1 px-1.5 py-0">{unread}</Badge>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={tab === 'unread' ? 'New updates about exams, results and your account will show up here.' : 'Updates about exams, results and announcements will appear here.'}
            action={tab === 'unread' && <Button variant="outline" onClick={() => setTab('all')}>View all</Button>}
          />
        ) : (
          <ul className={cn('space-y-2 transition-opacity', isFetching && 'opacity-70')}>
            <AnimatePresence initial={false}>
              {items.map((n) => {
                const meta = typeMeta[n.type];
                return (
                  <motion.li key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                    <div
                      className={cn(
                        'group flex items-start gap-3 rounded-xl border p-4 transition-colors',
                        n.readAt ? 'border-border' : 'border-primary/30 bg-primary/5',
                      )}
                    >
                      <div className={cn('shrink-0 rounded-xl bg-gradient-to-br p-2.5', meta.cls)}>
                        <meta.icon className="h-4 w-4" aria-hidden />
                      </div>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                        <div className="flex flex-wrap items-center gap-2">
                          {!n.readAt && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                          <span className="font-medium">{n.title}</span>
                          <Badge variant="muted" className="text-[10px]">{meta.label}</Badge>
                        </div>
                        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{n.message}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground/80" title={formatDateTime(n.createdAt)}>
                          {formatRelative(n.createdAt)}
                          {n.link && <span className="ml-2 text-primary group-hover:underline">Open →</span>}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {!n.readAt && (
                          <Tooltip content="Mark as read">
                            <Button variant="ghost" size="icon" aria-label="Mark as read" onClick={() => markRead.mutate(n.id)}>
                              <CheckCheck />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content="Delete">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete notification"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={remove.isPending && remove.variables === n.id}
                            onClick={() => remove.mutate(n.id)}
                          >
                            <Trash2 />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
        <Pagination meta={data?.meta} onPageChange={setPage} />
      </Card>
    </>
  );
}

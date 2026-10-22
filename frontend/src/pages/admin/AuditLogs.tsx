import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { AuditLogEntry } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, SearchInput } from '@/components/common';
import { ALL, actionVariant, humanizeAction, orUndefined, roleLabel, useUrlFilters } from '@/components/admin/helpers';
import { OutcomeBadge } from '@/components/admin/examActions';

/** Actor cell: live user when available, otherwise the snapshot stored with the entry. */
function ActorLabel({ log, compact }: { log: AuditLogEntry; compact?: boolean }) {
  if (log.actor) {
    return compact ? <>{log.actor.name}</> : (
      <>
        <p className="font-medium">{log.actor.name}</p>
        <p className="text-xs text-muted-foreground">{roleLabel[log.actor.role]}{log.actor.email ? ` · ${log.actor.email}` : ''}</p>
      </>
    );
  }
  if (log.actorEmail) {
    return compact ? <>{log.actorEmail}</> : (
      <>
        <p className="font-medium">{log.actorEmail}</p>
        <p className="text-xs text-muted-foreground">{log.actorRole ? `${roleLabel[log.actorRole]} · ` : ''}account no longer linked</p>
      </>
    );
  }
  return compact ? <>Anonymous</> : <span className="text-muted-foreground">Anonymous / system</span>;
}

/** Date-only input value → ISO bound covering the whole local day. */
const dayBound = (v: string, end: boolean) => (v ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

function Metadata({ data }: { data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return <p className="text-xs text-muted-foreground">No additional details recorded.</p>;
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed scrollbar-thin">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function AuditLogs() {
  useDocumentTitle('Audit logs');
  const { can } = useAuth();
  const [filters, setFilter] = useUrlFilters({ search: '', action: ALL, outcome: ALL, from: '', to: '', page: '1' });
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== filters.search) setFilter('search', debounced);
  }, [debounced, filters.search, setFilter]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();
  const setParamsCleared = () => navigate({ search: '' }, { replace: true });

  const range = { from: dayBound(filters.from, false), to: dayBound(filters.to, true) };
  const query = {
    search: filters.search || undefined,
    action: orUndefined(filters.action),
    outcome: orUndefined(filters.outcome),
    ...range,
    page: Number(filters.page) || 1,
    pageSize: 20,
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download('/admin/reports/export', 'audit-logs.csv', { type: 'audit-logs', ...range });
      toast.success('Audit log exported');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'audit-logs', query],
    queryFn: () => api.page<AuditLogEntry>('/admin/audit-logs', query),
    placeholderData: keepPreviousData,
  });
  const actions = (data?.meta.actions as string[] | undefined) ?? [];
  const logs = data?.data ?? [];
  const toggle = (id: string) => setExpanded((e) => (e === id ? null : id));
  const filtered = !!(filters.search || query.action || query.outcome || filters.from || filters.to);

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="An append-only trail of sign-ins, access denials and sensitive administrative actions. Entries cannot be edited or deleted."
        actions={
          can('report:export') ? (
            <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
              <Download /> Export CSV
            </Button>
          ) : undefined
        }
      />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search action, actor or entity ID" className="lg:max-w-xs" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:ml-auto lg:flex">
            <Select value={filters.action} onValueChange={(v) => setFilter('action', v)}>
              <SelectTrigger className="lg:w-56" aria-label="Filter by action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {actions.map((a) => <SelectItem key={a} value={a}>{humanizeAction(a)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.outcome} onValueChange={(v) => setFilter('outcome', v)}>
              <SelectTrigger className="lg:w-40" aria-label="Filter by outcome"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All outcomes</SelectItem>
                <SelectItem value="SUCCESS">Success</SelectItem>
                <SelectItem value="FAILURE">Failure</SelectItem>
                <SelectItem value="DENIED">Denied</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              From
              <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className="lg:w-40" aria-label="From date" />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              To
              <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className="lg:w-40" aria-label="To date" />
            </label>
          </div>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={10} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtered ? 'No log entries match' : 'No audit entries yet'}
            description={filtered ? 'Try a different search or action filter.' : 'Sensitive actions will be recorded here.'}
            action={filtered && <Button variant="outline" onClick={() => { setSearch(''); setParamsCleared(); }}>Clear filters</Button>}
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8"><span className="sr-only">Expand</span></TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>IP address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const open = expanded === log.id;
                    return (
                      <Fragment key={log.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggle(log.id)}>
                          <TableCell>
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={open ? 'Hide details' : 'Show details'}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); toggle(log.id); }}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <p className="text-sm">{formatDateTime(log.createdAt)}</p>
                            <p className="text-xs text-muted-foreground">{formatRelative(log.createdAt)}</p>
                          </TableCell>
                          <TableCell><ActorLabel log={log} /></TableCell>
                          <TableCell><Badge variant={actionVariant(log.action)}>{humanizeAction(log.action)}</Badge></TableCell>
                          <TableCell><OutcomeBadge outcome={log.outcome} /></TableCell>
                          <TableCell>
                            <p className="text-sm">{log.entityType}</p>
                            {log.entityId && <p className="max-w-[12rem] truncate font-mono text-xs text-muted-foreground" title={log.entityId}>{log.entityId}</p>}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{log.ipAddress ?? '—'}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell />
                            <TableCell colSpan={6} className="pt-0">
                              <Metadata data={log.metadata} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-3 md:hidden">
              {logs.map((log) => {
                const open = expanded === log.id;
                return (
                  <li key={log.id} className="rounded-xl border border-border">
                    <button type="button" className="w-full p-4 text-left" aria-expanded={open} onClick={() => toggle(log.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={actionVariant(log.action)}>{humanizeAction(log.action)}</Badge>
                          {log.outcome !== 'SUCCESS' && <OutcomeBadge outcome={log.outcome} />}
                        </span>
                        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      </div>
                      <p className="mt-2 text-sm"><ActorLabel log={log} compact /> · {log.entityType}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)} · {log.ipAddress ?? 'no IP'}</p>
                    </button>
                    {open && <div className="px-4 pb-4"><Metadata data={log.metadata} /></div>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setFilter('page', String(p))} />
      </Card>
    </>
  );
}

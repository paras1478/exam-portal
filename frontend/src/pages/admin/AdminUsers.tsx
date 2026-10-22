import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Download, KeyRound, MoreHorizontal, Pencil, Power, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { User, UserStatus } from '@/lib/types';
import { formatRelative, initials } from '@/lib/utils';
import { useDebounce, useDocumentTitle } from '@/hooks';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, Badge, Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui/controls';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pagination, SearchInput, UserStatusBadge } from '@/components/common';
import { ALL, RoleBadge, orUndefined, useUrlFilters } from '@/components/admin/helpers';
import { DeleteUserDialog, ResetPasswordDialog, RoleDialog, StatusDialog, UserFormDialog } from '@/components/admin/UserDialogs';

const SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: '-name', label: 'Name Z–A' },
  { value: '-lastLoginAt', label: 'Recently active' },
];

interface ActionPerms {
  manage: boolean;
  assignRole: boolean;
  remove: boolean;
}

function UserActions({ user, isSelf, perms, onEdit, onRole, onStatus, onReset, onDelete }: {
  user: User; isSelf: boolean; perms: ActionPerms; onEdit: () => void; onRole: () => void; onStatus: (s: UserStatus) => void;
  onReset: () => void; onDelete: () => void;
}) {
  if (user.deletedAt) {
    return <Badge variant="muted" className="whitespace-nowrap">Retained</Badge>;
  }
  if (!perms.manage && !perms.assignRole && !perms.remove) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${user.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{isSelf ? 'This is your account' : user.name}</DropdownMenuLabel>
        {perms.manage && (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isSelf} onSelect={onReset}>
              <KeyRound /> Reset password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {perms.assignRole && (
          <DropdownMenuItem disabled={isSelf} onSelect={onRole}>
            <ShieldCheck /> Change role
          </DropdownMenuItem>
        )}
        {perms.manage && user.status !== 'ACTIVE' && (
          <DropdownMenuItem disabled={isSelf} onSelect={() => onStatus('ACTIVE')}>
            <Power /> Activate
          </DropdownMenuItem>
        )}
        {perms.manage && user.status !== 'INACTIVE' && (
          <DropdownMenuItem disabled={isSelf} onSelect={() => onStatus('INACTIVE')}>
            <Power /> Deactivate
          </DropdownMenuItem>
        )}
        {perms.manage && user.status !== 'SUSPENDED' && (
          <DropdownMenuItem destructive disabled={isSelf} onSelect={() => onStatus('SUSPENDED')}>
            <Ban /> Suspend
          </DropdownMenuItem>
        )}
        {perms.remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive disabled={isSelf} onSelect={onDelete}>
              <Trash2 /> Delete account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const identifier = (u: User) => u.studentProfile?.rollNumber ?? u.facultyProfile?.employeeId ?? null;
const department = (u: User) => u.studentProfile?.department ?? u.facultyProfile?.department ?? null;

export default function AdminUsers() {
  useDocumentTitle('Users');
  const { user: me, can } = useAuth();
  const perms: ActionPerms = { manage: can('user:manage'), assignRole: can('role:assign'), remove: can('user:delete') };
  const [filters, setFilter] = useUrlFilters({ search: '', role: ALL, status: ALL, sort: '-createdAt', page: '1', deleted: 'false' });
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search);
  useEffect(() => {
    if (debounced !== filters.search) setFilter('search', debounced);
  }, [debounced, filters.search, setFilter]);

  const query = {
    search: filters.search || undefined,
    role: orUndefined(filters.role),
    status: orUndefined(filters.status),
    sort: filters.sort,
    includeDeleted: filters.deleted === 'true' ? 'true' : undefined,
    page: Number(filters.page) || 1,
    pageSize: 10,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => api.page<User>('/admin/users', query),
    placeholderData: keepPreviousData,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [roleTarget, setRoleTarget] = useState<User | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ user: User; status: UserStatus } | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [exporting, setExporting] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (u: User) => {
    setEditing(u);
    setFormOpen(true);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download('/admin/users/export', 'users.csv', { search: query.search, role: query.role, status: query.status, includeDeleted: query.includeDeleted });
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const hasFilters = !!(filters.search || query.role || query.status);
  const users = data?.data ?? [];
  const actionsFor = (u: User) => (
    <UserActions
      user={u}
      isSelf={u.id === me?.id}
      perms={perms}
      onDelete={() => setDeleteTarget(u)}
      onEdit={() => openEdit(u)}
      onRole={() => setRoleTarget(u)}
      onStatus={(status) => setStatusTarget({ user: u, status })}
      onReset={() => setResetTarget(u)}
    />
  );

  return (
    <>
      <PageHeader
        title="User management"
        description="Create accounts, assign roles and control access."
        actions={
          <>
            {can('report:export') && (
              <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
                <Download /> Export CSV
              </Button>
            )}
            {perms.manage && (
              <Button onClick={openCreate}>
                <UserPlus /> Add user
              </Button>
            )}
          </>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, roll or employee ID" className="lg:max-w-sm" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:ml-auto lg:flex">
            <Select value={filters.role} onValueChange={(v) => setFilter('role', v)}>
              <SelectTrigger className="lg:w-36" aria-label="Filter by role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                <SelectItem value="STUDENT">Students</SelectItem>
                <SelectItem value="FACULTY">Faculty</SelectItem>
                <SelectItem value="ADMIN">Admins</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilter('status', v)}>
              <SelectTrigger className="lg:w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border border-input px-3 text-sm">
              <Switch checked={filters.deleted === 'true'} onCheckedChange={(c) => setFilter('deleted', c ? 'true' : 'false')} aria-label="Show deleted accounts" />
              Show deleted
            </label>
            <Select value={filters.sort} onValueChange={(v) => setFilter('sort', v)}>
              <SelectTrigger className="lg:w-44" aria-label="Sort users"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={6} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilters ? 'No users match your filters' : 'No users yet'}
            description={hasFilters ? 'Try a different search term or clear the filters.' : 'Create the first account to get started.'}
            action={
              hasFilters ? (
                <Button variant="outline" onClick={() => { setSearch(''); setFilter('search', ''); setFilter('role', ALL); setFilter('status', ALL); }}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={openCreate}><UserPlus /> Add user</Button>
              )
            }
          />
        ) : (
          <div className={isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Roll / Employee ID</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Last login</TableHead>
                    <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9"><AvatarFallback>{initials(u.name)}</AvatarFallback></Avatar>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-medium">
                              {u.name}
                              {u.id === me?.id && <Badge variant="muted">You</Badge>}
                              {u.deletedAt && <Badge variant="destructive">Deleted</Badge>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={u.role} /></TableCell>
                      <TableCell><UserStatusBadge status={u.status} /></TableCell>
                      <TableCell className="font-mono text-xs">{identifier(u) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-muted-foreground">{department(u) ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</TableCell>
                      <TableCell>{actionsFor(u)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-3 md:hidden">
              {users.map((u) => (
                <li key={u.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10"><AvatarFallback>{initials(u.name)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.name}{u.id === me?.id && ' (you)'}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <RoleBadge role={u.role} />
                        <UserStatusBadge status={u.status} />
                        {u.deletedAt && <Badge variant="destructive">Deleted</Badge>}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {[identifier(u), department(u)].filter(Boolean).join(' · ') || 'No profile details'} · Last login {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'never'}
                      </p>
                    </div>
                    {actionsFor(u)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setFilter('page', String(p))} />
      </Card>

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />
      <RoleDialog user={roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)} />
      <StatusDialog target={statusTarget} onOpenChange={(o) => !o && setStatusTarget(null)} />
      <ResetPasswordDialog user={resetTarget} onOpenChange={(o) => !o && setResetTarget(null)} />
      <DeleteUserDialog user={deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} />
    </>
  );
}

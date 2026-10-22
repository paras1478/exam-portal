import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, BookOpenCheck, ClipboardList, FileBarChart, GraduationCap, LayoutDashboard, LogOut, Megaphone, Menu,
  Moon, PieChart, ScrollText, Settings, ShieldCheck, Sun, User as UserIcon, Users, X, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/lib/api';
import type { Notification, Role } from '@/lib/types';
import { cn, formatRelative, initials, firstName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, Badge } from '@/components/ui/primitives';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip,
} from '@/components/ui/overlays';
import { BackgroundOrbs, Logo } from '@/components/common';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: Record<Role, NavItem[]> = {
  STUDENT: [
    { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/student/exams', label: 'Examinations', icon: BookOpenCheck },
    { to: '/student/results', label: 'Results', icon: FileBarChart },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/profile', label: 'Profile', icon: UserIcon },
  ],
  FACULTY: [
    { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/faculty/exams', label: 'My Exams', icon: ClipboardList },
    { to: '/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/profile', label: 'Profile', icon: UserIcon },
  ],
  ADMIN: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/exams', label: 'Exam Approvals', icon: ShieldCheck },
    { to: '/admin/results', label: 'Results', icon: FileBarChart },
    { to: '/admin/reports', label: 'Reports', icon: PieChart },
    { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
    { to: '/profile', label: 'Profile', icon: UserIcon },
  ],
};

const roleLabel: Record<Role, string> = { STUDENT: 'Student', FACULTY: 'Faculty', ADMIN: 'Administrator' };

function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {NAV[role].map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-gradient" />}
              <item.icon className={cn('h-4.5 w-4.5', isActive && 'text-primary')} aria-hidden />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => api.page<Notification>('/notifications', { pageSize: 6 }),
    refetchInterval: 60_000,
  });
  const unread = (data?.meta.unreadCount as number | undefined) ?? 0;
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const open = async (n: Notification) => {
    if (!n.readAt) {
      await api.patch(`/notifications/${n.id}/read`).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) navigate(n.link);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => markAll.mutate()}>
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {data?.data.length ? (
          data.data.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => void open(n)} className="flex-col items-start gap-0.5">
              <span className="flex w-full items-center gap-2">
                {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <span className="truncate font-medium">{n.title}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{n.message}</span>
              <span className="text-[11px] text-muted-foreground/80">{formatRelative(n.createdAt)}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/notifications')} className="justify-center text-primary">
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Tooltip content={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" className="px-2 pt-1">
        <Logo />
      </Link>
      <SidebarNav role={user.role} onNavigate={() => setMobileOpen(false)} />
      <div className="mt-auto rounded-2xl border border-border bg-gradient-to-br from-[#4F8CFF]/10 to-[#8B5CF6]/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GraduationCap className="h-4 w-4 text-primary" /> {roleLabel[user.role]} workspace
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Signed in as {user.email}</p>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <BackgroundOrbs />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-card-solid focus:px-4 focus:py-2">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card/60 backdrop-blur-xl lg:block">{sidebar}</aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-card-solid lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              role="dialog"
              aria-label="Navigation"
            >
              <button className="absolute right-3 top-4 rounded-md p-1.5 hover:bg-accent" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="lg:hidden">
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-accent" aria-label="Account menu">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm font-medium sm:inline">{firstName(user.name)}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-foreground">{user.name}</span>
                  <span className="truncate">{user.email}</span>
                  <Badge variant="violet" className="mt-1 w-fit">{roleLabel[user.role]}</Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <UserIcon /> Profile & settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/notifications')}>
                  <Bell /> Notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => void handleLogout()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

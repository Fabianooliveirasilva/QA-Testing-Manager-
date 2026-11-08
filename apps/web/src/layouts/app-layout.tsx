import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Bot,
  Bug,
  Check,
  ChevronsUpDown,
  ClipboardList,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PlayCircle,
  Search,
  Settings,
  Sun,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { meQueryKey, useWorkspace } from '@/features/auth/session';
import { useProjects } from '@/features/projects/queries';
import { api } from '@/lib/api';
import { humanize, timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { DashboardData } from '@/lib/types';
import { cn } from '@/lib/utils';

function useNavItems() {
  const { projectId } = useWorkspace();
  const scoped = (path: string) => (projectId ? `/p/${projectId}/${path}` : '/projects');
  return [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/projects', label: 'Projects', icon: FolderKanban, end: true },
    { to: scoped('test-cases'), label: 'Test Cases', icon: ListChecks, scoped: true },
    { to: scoped('test-plans'), label: 'Test Plans', icon: ClipboardList, scoped: true },
    { to: scoped('test-runs'), label: 'Test Runs', icon: PlayCircle, scoped: true },
    { to: scoped('bugs'), label: 'Bugs', icon: Bug, scoped: true },
    { to: scoped('automation'), label: 'Automation', icon: Workflow, scoped: true },
    { to: '/ai', label: 'AI Assistant', icon: Bot },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const items = useNavItems();
  const { projectId } = useWorkspace();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {items.map((item) => (
        <NavLink
          key={item.label}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          title={item.scoped && !projectId ? 'Select a project first' : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              isActive && !(item.scoped && !projectId) && 'bg-accent font-medium text-foreground',
            )
          }
        >
          <item.icon className="size-4" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 px-6 py-5">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span className="font-semibold tracking-tight">QA Testing Manager</span>
    </Link>
  );
}

function ProjectSelector() {
  const { organization, projectId, setProjectId } = useWorkspace();
  const { data: projects } = useProjects(organization.id);
  const navigate = useNavigate();
  const current = projects?.find((p) => p.id === projectId);
  const active = projects?.filter((p) => p.status === 'ACTIVE') ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-56 justify-between gap-2" aria-label="Select project">
          <FlaskConical className="text-muted-foreground" />
          <span className="truncate">{current?.name ?? 'Select project'}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {active.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No active projects</p>}
        {active.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => {
              setProjectId(p.id);
              navigate(`/p/${p.id}/test-cases`);
            }}
          >
            <span className="truncate">{p.name}</span>
            {p.id === projectId && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/projects')}>Manage projects</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SearchResults {
  projects: { id: string; name: string; status: string }[];
  testCases: { id: string; title: string; projectId: string }[];
  bugs: { id: string; title: string; projectId: string; status: string }[];
}

function GlobalSearch() {
  const { organization } = useWorkspace();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', organization.id, debounced],
    queryFn: () => api.get<SearchResults>(`/organizations/${organization.id}/search`, { q: debounced }),
    enabled: debounced.length >= 2,
  });

  const go = (to: string) => {
    setOpen(false);
    setTerm('');
    navigate(to);
  };
  const empty = data && data.projects.length + data.testCases.length + data.bugs.length === 0;

  return (
    <Popover open={open && debounced.length >= 2} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search projects, test cases, bugs…"
            aria-label="Global search"
            className="pl-9"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 text-[10px] text-muted-foreground sm:block">
            Ctrl K
          </kbd>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {isFetching && !data && <p className="p-2 text-sm text-muted-foreground">Searching…</p>}
        {empty && <p className="p-2 text-sm text-muted-foreground">No results for “{debounced}”.</p>}
        {data && (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {(
              [
                ['Projects', data.projects.map((p) => ({ id: p.id, label: p.name, to: `/projects/${p.id}` }))],
                ['Test cases', data.testCases.map((c) => ({ id: c.id, label: c.title, to: `/p/${c.projectId}/test-cases/${c.id}` }))],
                ['Bugs', data.bugs.map((b) => ({ id: b.id, label: b.title, to: `/p/${b.projectId}/bugs/${b.id}` }))],
              ] as const
            ).map(([group, rows]) =>
              rows.length ? (
                <div key={group}>
                  <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group}</p>
                  {rows.map((r) => (
                    <button key={r.id} type="button" onClick={() => go(r.to)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : null,
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ActivityBell() {
  const { organization } = useWorkspace();
  const { data } = useQuery({
    queryKey: ['dashboard', organization.id, null],
    queryFn: () => api.get<DashboardData>(`/organizations/${organization.id}/dashboard`),
    staleTime: 0,
  });
  const activity = data?.recentActivity ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Recent activity">
          <Bell />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-medium">Recent activity</p>
        {activity.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {activity.map((a) => (
              <li key={a.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{a.user?.name ?? 'System'}</span>{' '}
                <span className="text-muted-foreground">{humanize(a.action.replace('.', ' '))}</span>
                <p className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ProfileMenu() {
  const { me, organization, setOrganizationId } = useWorkspace();
  const { theme, toggle } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      queryClient.setQueryData(meQueryKey, null);
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
  const initials = me.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">{initials}</span>
          <span className="hidden max-w-32 truncate text-sm md:block">{me.user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium">{me.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organization</DropdownMenuLabel>
        {me.organizations.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => o.id !== organization.id && setOrganizationId(o.id)}>
            <span className="truncate">{o.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{humanize(o.role)}</span>
            {o.id === organization.id && <Check />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggle}>
          {theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar/80 backdrop-blur lg:block">
        <Brand />
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:gap-3 lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="hidden sm:block">
            <ProjectSelector />
          </div>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <ActivityBell />
            <ProfileMenu />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

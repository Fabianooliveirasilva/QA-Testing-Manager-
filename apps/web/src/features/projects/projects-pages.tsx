import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Archive, ArchiveRestore, Bug as BugIcon, ListChecks, PlayCircle, Copy, FolderKanban, KeyRound, Pencil, Plus, Trash2, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { projectCreateSchema, suiteCreateSchema } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, PageHeader, Panel, StatCard } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useSyncProject, useWorkspace } from '@/features/auth/session';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatPercent } from '@/lib/format';
import type { ApiToken, DashboardData, Member, Project } from '@/lib/types';
import { keys, useOrgMembers, useProject, useProjects, useSuites } from './queries';

import { canManage, canWrite } from './permissions';

type ProjectForm = z.input<typeof projectCreateSchema>;

function ProjectDialog({ project, trigger }: { project?: Project; trigger: React.ReactNode }) {
  const { organization, setProjectId } = useWorkspace();
  const members = useOrgMembers(organization.id);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectCreateSchema),
    values: { name: project?.name ?? '', description: project?.description ?? '', leadId: project?.leadId ?? null },
  });
  const save = useMutation({
    mutationFn: (v: ProjectForm) =>
      project ? api.patch<Project>(`/projects/${project.id}`, v) : api.post<Project>(`/organizations/${organization.id}/projects`, v),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: keys.projects(organization.id) });
      queryClient.invalidateQueries({ queryKey: keys.project(saved.id) });
      toast.success(project ? 'Project updated' : 'Project created');
      setOpen(false);
      if (!project) {
        setProjectId(saved.id);
        navigate(`/projects/${saved.id}`);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { errors } = form.formState;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
          <DialogDescription>A default “General” suite is created with new projects.</DialogDescription>
        </DialogHeader>
        <form
          id="project-form"
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => save.mutate({ ...v, leadId: v.leadId || null }))}
          noValidate
        >
          <Field label="Name" htmlFor="project-name" error={errors.name?.message}>
            <Input id="project-name" {...form.register('name')} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Description" htmlFor="project-description" error={errors.description?.message}>
            <Textarea id="project-description" rows={3} {...form.register('description')} />
          </Field>
          <Field label="Lead" htmlFor="project-lead" error={errors.leadId?.message}>
            <NativeSelect id="project-lead" {...form.register('leadId', { setValueAs: (v: unknown) => (v === '' ? null : v) })}>
              <option value="">No lead</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="project-form" disabled={save.isPending}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const { organization } = useWorkspace();
  const { data, isPending, error, refetch } = useProjects(organization.id);
  const [showArchived, setShowArchived] = useState(false);
  const manage = canManage(organization.role);
  const visible = data?.filter((p) => showArchived || p.status === 'ACTIVE') ?? [];
  const archivedCount = data?.filter((p) => p.status === 'ARCHIVED').length ?? 0;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own suites, test cases, plans, runs and bugs."
        crumbs={[{ label: organization.name }, { label: 'Projects' }]}
        actions={
          manage && (
            <ProjectDialog
              trigger={
                <Button>
                  <Plus /> New project
                </Button>
              }
            />
          )
        }
      />
      {archivedCount > 0 && (
        <label className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />
          Show {archivedCount} archived
        </label>
      )}
      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description={manage ? 'Create a project to start organizing your tests.' : 'Ask an admin to create a project.'}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="group rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold group-hover:text-primary">{p.name}</h2>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{p.description || 'No description'}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                <div>
                  <dt>Cases</dt>
                  <dd className="text-base font-semibold text-foreground tabular-nums">{p._count.testCases}</dd>
                </div>
                <div>
                  <dt>Runs</dt>
                  <dd className="text-base font-semibold text-foreground tabular-nums">{p._count.testRuns}</dd>
                </div>
                <div>
                  <dt>Bugs</dt>
                  <dd className="text-base font-semibold text-foreground tabular-nums">{p._count.bugs}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">Lead: {p.lead?.name ?? '—'}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  useSyncProject(projectId);
  const { organization } = useWorkspace();
  const queryClient = useQueryClient();
  const { data: project, isPending, error, refetch } = useProject(projectId);
  const metrics = useQuery({
    queryKey: ['project', projectId, 'metrics'],
    queryFn: () => api.get<DashboardData>(`/projects/${projectId}/metrics`),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.post<Project>(`/projects/${projectId}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: keys.projects(organization.id) });
      toast.success(p.status === 'ARCHIVED' ? 'Project archived (read-only)' : 'Project restored');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) return <LoadingRows rows={6} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const manage = canManage(project.role);
  const m = metrics.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {project.name} <StatusBadge status={project.status} />
          </span>
        }
        description={project.description || undefined}
        crumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
        actions={
          manage && (
            <>
              <ProjectDialog
                project={project}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
              {project.status === 'ACTIVE' ? (
                <ConfirmDialog
                  title="Archive project?"
                  description="Archived projects become read-only. You can restore them at any time."
                  confirmLabel="Archive"
                  onConfirm={() => archive.mutateAsync(true)}
                  trigger={
                    <Button variant="outline">
                      <Archive /> Archive
                    </Button>
                  }
                />
              ) : (
                <Button variant="outline" onClick={() => archive.mutate(false)}>
                  <ArchiveRestore /> Restore
                </Button>
              )}
            </>
          )
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Test cases" value={project._count.testCases} icon={<ListChecks />} />
        <StatCard label="Test runs" value={project._count.testRuns} icon={<PlayCircle />} />
        <StatCard label="Open bugs" value={m?.totals.openBugs ?? '—'} icon={<BugIcon />} tone="text-warning" />
        <StatCard label="Pass rate (30d)" value={formatPercent(m?.results.passRate)} icon={<Activity />} tone="text-primary" />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          ['Test cases', 'test-cases'],
          ['Test plans', 'test-plans'],
          ['Test runs', 'test-runs'],
          ['Bugs', 'bugs'],
          ['Automation', 'automation'],
        ].map(([label, path]) => (
          <Button key={path} asChild variant="secondary" size="sm">
            <Link to={`/p/${projectId}/${path}`}>{label}</Link>
          </Button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SuitesPanel projectId={projectId} writable={canWrite(project.role) && project.status === 'ACTIVE'} manage={manage} />
        <ProjectMembersPanel projectId={projectId} manage={manage && project.status === 'ACTIVE'} />
        {manage && <ApiTokensPanel projectId={projectId} active={project.status === 'ACTIVE'} />}
      </div>
    </>
  );
}

function SuitesPanel({ projectId, writable, manage }: { projectId: string; writable: boolean; manage: boolean }) {
  const { data: suites, isPending } = useSuites(projectId);
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof suiteCreateSchema>>({ resolver: zodResolver(suiteCreateSchema), defaultValues: { name: '' } });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
  const create = useMutation({
    mutationFn: (v: z.input<typeof suiteCreateSchema>) => api.post(`/projects/${projectId}/suites`, v),
    onSuccess: () => {
      invalidate();
      form.reset({ name: '' });
      toast.success('Suite created');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/suites/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Suite deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Panel title="Test suites">
      {isPending ? (
        <LoadingRows rows={2} />
      ) : (
        <ul className="divide-y">
          {suites?.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <Link to={`/p/${projectId}/test-cases?suiteId=${s.id}`} className="hover:text-primary">
                {s.name}
              </Link>
              <span className="flex items-center gap-2 text-muted-foreground">
                {s._count.testCases} cases
                {manage && (
                  <ConfirmDialog
                    title={`Delete suite “${s.name}”?`}
                    description="Only empty suites can be deleted."
                    onConfirm={() => remove.mutateAsync(s.id)}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Delete suite ${s.name}`}>
                        <Trash2 />
                      </Button>
                    }
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {writable && (
        <form className="mt-3 flex gap-2" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
          <Input placeholder="New suite name" aria-label="New suite name" {...form.register('name')} />
          <Button type="submit" variant="outline" disabled={create.isPending}>
            <Plus /> Add
          </Button>
        </form>
      )}
    </Panel>
  );
}

function ProjectMembersPanel({ projectId, manage }: { projectId: string; manage: boolean }) {
  const { organization } = useWorkspace();
  const queryClient = useQueryClient();
  const orgMembers = useOrgMembers(organization.id);
  const { data: members } = useQuery({
    queryKey: ['project', projectId, 'members'],
    queryFn: () => api.get<{ items: Member[] }>(`/projects/${projectId}/members`).then((r) => r.items),
  });
  const [userId, setUserId] = useState('');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'members'] });
  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/members`, { userId }),
    onSuccess: () => {
      invalidate();
      setUserId('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/members/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const candidates = orgMembers.data?.filter((m) => !members?.some((pm) => pm.userId === m.userId)) ?? [];
  return (
    <Panel title="Project team">
      <ul className="divide-y">
        {members?.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {m.user.name} <span className="text-muted-foreground">· {m.user.email}</span>
            </span>
            {manage && (
              <Button variant="ghost" size="icon" aria-label={`Remove ${m.user.name}`} onClick={() => remove.mutate(m.userId)}>
                <UserMinus />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {manage && candidates.length > 0 && (
        <div className="mt-3 flex gap-2">
          <NativeSelect aria-label="Add team member" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Add organization member…</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.user.name}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" disabled={!userId || add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Access is governed by organization roles; the team list identifies who works on this project.</p>
    </Panel>
  );
}

function ApiTokensPanel({ projectId, active }: { projectId: string; active: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const { data: tokens } = useQuery({
    queryKey: ['project', projectId, 'tokens'],
    queryFn: () => api.get<{ items: ApiToken[] }>(`/projects/${projectId}/tokens`).then((r) => r.items),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project', projectId, 'tokens'] });
  const create = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/projects/${projectId}/tokens`, { name }),
    onSuccess: (r) => {
      setSecret(r.token);
      setName('');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/projects/${projectId}/tokens/${id}`), onSuccess: invalidate });
  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-4" /> CI API tokens</span>} className="lg:col-span-2">
      <p className="mb-3 text-sm text-muted-foreground">
        Tokens only allow uploading Playwright reports to this project. See{' '}
        <Link to={`/p/${projectId}/automation`} className="text-primary hover:underline">
          Automation
        </Link>{' '}
        for the CI command.
      </p>
      {secret && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <p className="mb-2 font-medium">Copy this token now — it will not be shown again.</p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs" data-testid="new-token">
              {secret}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success('Copied'), () => toast.error('Clipboard unavailable'))}
            >
              <Copy /> Copy
            </Button>
          </div>
        </div>
      )}
      {active && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name (e.g. GitHub Actions)" aria-label="Token name" maxLength={80} />
          <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
            Create token
          </Button>
        </form>
      )}
      {tokens && tokens.length > 0 ? (
        <ul className="divide-y text-sm">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t.name}</span> <code className="text-xs text-muted-foreground">{t.prefix}…</code>
                <span className="block text-xs text-muted-foreground">
                  Created {formatDate(t.createdAt)} · last used {formatDateTime(t.lastUsedAt)}
                </span>
              </span>
              {t.revokedAt ? (
                <StatusBadge status="REVOKED" />
              ) : (
                <ConfirmDialog
                  title="Revoke token?"
                  description="CI jobs using it will stop uploading immediately."
                  confirmLabel="Revoke"
                  onConfirm={() => revoke.mutateAsync(t.id)}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Revoke
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      )}
    </Panel>
  );
}

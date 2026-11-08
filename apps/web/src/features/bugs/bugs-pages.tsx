import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug as BugIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { BUG_SEVERITIES, BUG_STATUSES, PRIORITIES, bugCreateSchema, type BugStatus } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, PageHeader, Pagination, Panel } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { PriorityBadge, ResultBadge, SeverityBadge, StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentsPanel } from '@/features/attachments/attachments-panel';
import { useWorkspace } from '@/features/auth/session';
import { useProjectScope } from '@/features/projects/project-scope';
import { useOrgMembers } from '@/features/projects/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, humanize, timeAgo } from '@/lib/format';
import type { Bug, BugDetail, Paginated } from '@/lib/types';

type BugFormValues = z.input<typeof bugCreateSchema>;
type BugFormOutput = z.output<typeof bugCreateSchema>;

export function BugsPage() {
  const { projectId, project, writable, base } = useProjectScope();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? 1);
  const query = { q: params.get('q') ?? undefined, status: params.get('status') ?? undefined, severity: params.get('severity') ?? undefined, page };
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) setParam('q', search);
    }, 300);
    return () => clearTimeout(id);
  });
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['bugs', projectId, query],
    queryFn: () => api.get<Paginated<Bug>>(`/projects/${projectId}/bugs`, { ...query, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Bugs"
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Bugs' }]}
        actions={
          writable && (
            <Button asChild>
              <Link to={`${base}/bugs/new`}>
                <Plus /> Report bug
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Search bugs…" aria-label="Search bugs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter by status" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Any status</option>
          {BUG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by severity" value={params.get('severity') ?? ''} onChange={(e) => setParam('severity', e.target.value)}>
          <option value="">Any severity</option>
          {BUG_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={BugIcon} title="No bugs found" description="Bugs reported here or from failed test results will show up in this list." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Assignee</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-md">
                      <Link to={`${base}/bugs/${b.id}`} className="font-medium hover:text-primary">
                        {b.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={b.severity} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={b.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{b.assignee?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{timeAgo(b.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParam('page', String(p))} />
        </>
      )}
    </>
  );
}

function BugForm({ defaultValues, submitLabel, pending, onSubmit }: { defaultValues: BugFormValues; submitLabel: string; pending: boolean; onSubmit: (v: BugFormOutput) => void }) {
  const { organization } = useWorkspace();
  const members = useOrgMembers(organization.id);
  const form = useForm<BugFormValues, unknown, BugFormOutput>({ resolver: zodResolver(bugCreateSchema), defaultValues });
  const { errors } = form.formState;
  const text = (name: 'description' | 'stepsToReproduce' | 'expectedResult' | 'actualResult', label: string, rows = 3) => (
    <Field label={label} htmlFor={`bug-${name}`} error={errors[name]?.message}>
      <Textarea id={`bug-${name}`} rows={rows} {...form.register(name)} />
    </Field>
  );
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => onSubmit({ ...v, assigneeId: v.assigneeId || null }))}>
      <Field label="Title" htmlFor="bug-title" error={errors.title?.message}>
        <Input id="bug-title" aria-invalid={!!errors.title} {...form.register('title')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Severity" htmlFor="bug-severity">
          <NativeSelect id="bug-severity" {...form.register('severity')}>
            {BUG_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Priority" htmlFor="bug-priority">
          <NativeSelect id="bug-priority" {...form.register('priority')}>
            {PRIORITIES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Assignee" htmlFor="bug-assignee" error={errors.assigneeId?.message}>
          <NativeSelect id="bug-assignee" {...form.register('assigneeId', { setValueAs: (v: unknown) => (v === '' ? null : v) })}>
            <option value="">Unassigned</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Environment" htmlFor="bug-environment">
          <Input id="bug-environment" placeholder="staging" {...form.register('environment')} />
        </Field>
        <Field label="Browser" htmlFor="bug-browser">
          <Input id="bug-browser" placeholder="Chrome 130" {...form.register('browser')} />
        </Field>
        <Field label="Version" htmlFor="bug-version">
          <Input id="bug-version" placeholder="1.4.2" {...form.register('version')} />
        </Field>
      </div>
      {text('description', 'Description')}
      {text('stepsToReproduce', 'Steps to reproduce', 4)}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('expectedResult', 'Expected result')}
        {text('actualResult', 'Actual result')}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function NewBugPage() {
  const { projectId, project, base } = useProjectScope();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const testResultId = params.get('testResultId');
  const testCaseId = params.get('testCaseId');
  const create = useMutation({
    mutationFn: (v: BugFormOutput) => api.post<Bug>(`/projects/${projectId}/bugs`, { ...v, testResultId, testCaseId }),
    onSuccess: (b) => {
      queryClient.invalidateQueries({ queryKey: ['bugs', projectId] });
      toast.success('Bug reported');
      navigate(`${base}/bugs/${b.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Report bug" crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Bugs', to: `${base}/bugs` }, { label: 'New' }]} />
      {testResultId && <p className="mb-4 text-sm text-muted-foreground">This bug will be linked to the failed test result{testCaseId ? ' and its test case' : ''}.</p>}
      <Panel>
        <BugForm
          defaultValues={{ title: params.get('title') ? `Failure: ${params.get('title')}`.slice(0, 250) : '', severity: 'MEDIUM', priority: 'MEDIUM' }}
          submitLabel="Report bug"
          pending={create.isPending}
          onSubmit={(v) => create.mutate(v)}
        />
      </Panel>
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  created: 'created the bug',
  assigneeId: 'assignee',
  testCaseId: 'linked test case',
  testResultId: 'linked result',
  stepsToReproduce: 'steps to reproduce',
  expectedResult: 'expected result',
  actualResult: 'actual result',
};

export function BugDetailPage() {
  const { bugId = '' } = useParams();
  const { projectId, project, writable, manage, base } = useProjectScope();
  const { organization } = useWorkspace();
  const members = useOrgMembers(organization.id);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: bug, isPending, error, refetch } = useQuery({
    queryKey: ['bug', projectId, bugId],
    queryFn: () => api.get<BugDetail>(`/projects/${projectId}/bugs/${bugId}`),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['bug', projectId, bugId] });
    queryClient.invalidateQueries({ queryKey: ['bugs', projectId] });
  };
  const update = useMutation({
    mutationFn: (v: Partial<BugFormOutput> & { status?: BugStatus }) => api.patch(`/projects/${projectId}/bugs/${bugId}`, v),
    onSuccess: () => {
      invalidate();
      setEditing(false);
      toast.success('Bug updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/bugs/${bugId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bugs', projectId] });
      navigate(`${base}/bugs`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const memberName = (id: string | null) => (id ? (members.data?.find((m) => m.userId === id)?.user.name ?? 'Unknown user') : 'none');
  const display = (field: string, value: string | null) => (field === 'assigneeId' ? memberName(value) : value ? (value.length > 60 ? `${value.slice(0, 60)}…` : humanize(value)) : 'empty');

  return (
    <>
      <PageHeader
        title={bug.title}
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Bugs', to: `${base}/bugs` }, { label: bug.title }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={bug.severity} /> <PriorityBadge priority={bug.priority} /> <StatusBadge status={bug.status} /> · reported by {bug.createdBy.name}{' '}
            {timeAgo(bug.createdAt)}
          </span>
        }
        actions={
          <>
            {writable && (
              <>
                <div className="w-40">
                  <NativeSelect aria-label="Change status" value={bug.status} onChange={(e) => update.mutate({ status: e.target.value as BugStatus })} disabled={update.isPending}>
                    {BUG_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {humanize(s)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                  <Pencil /> {editing ? 'Cancel' : 'Edit'}
                </Button>
              </>
            )}
            {manage && writable && (
              <ConfirmDialog
                title="Delete bug?"
                description="The bug, its history and its evidence files will be permanently deleted."
                onConfirm={() => remove.mutateAsync()}
                trigger={
                  <Button variant="outline">
                    <Trash2 /> Delete
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {editing ? (
            <Panel title="Edit bug">
              <BugForm
                defaultValues={{
                  title: bug.title,
                  description: bug.description,
                  stepsToReproduce: bug.stepsToReproduce,
                  expectedResult: bug.expectedResult,
                  actualResult: bug.actualResult,
                  severity: bug.severity,
                  priority: bug.priority,
                  environment: bug.environment,
                  browser: bug.browser,
                  version: bug.version,
                  assigneeId: bug.assigneeId,
                }}
                submitLabel="Save changes"
                pending={update.isPending}
                onSubmit={({ testCaseId: _tc, testResultId: _tr, ...v }) => update.mutate(v)}
              />
            </Panel>
          ) : (
            <Panel title="Details">
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['Description', bug.description, true],
                    ['Steps to reproduce', bug.stepsToReproduce, true],
                    ['Expected result', bug.expectedResult, false],
                    ['Actual result', bug.actualResult, false],
                  ] as const
                ).map(([label, value, wide]) => (
                  <div key={label} className={wide ? 'sm:col-span-2' : undefined}>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground uppercase">{label}</dt>
                    <dd className="whitespace-pre-wrap">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
          <AttachmentsPanel projectId={projectId} entityType="BUG" entityId={bug.id} writable={writable} />
        </div>
        <div className="space-y-4">
          <Panel title="Properties">
            <dl className="space-y-3 text-sm">
              {(
                [
                  ['Assignee', bug.assignee?.name ?? 'Unassigned'],
                  ['Environment', bug.environment || '—'],
                  ['Browser', bug.browser || '—'],
                  ['Version', bug.version || '—'],
                  ['Updated', formatDateTime(bug.updatedAt)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
              {bug.testCase && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Test case</dt>
                  <dd className="text-right">
                    {bug.testCase.deletedAt ? (
                      <span className="text-muted-foreground line-through">{bug.testCase.title}</span>
                    ) : (
                      <Link to={`${base}/test-cases/${bug.testCase.id}`} className="text-primary hover:underline">
                        {bug.testCase.title}
                      </Link>
                    )}
                  </dd>
                </div>
              )}
              {bug.testResult && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Execution</dt>
                  <dd className="flex items-center gap-2 text-right">
                    <Link to={`${base}/test-runs/${bug.testResult.testRunId}`} className="text-primary hover:underline">
                      View run
                    </Link>
                    <ResultBadge status={bug.testResult.status} />
                  </dd>
                </div>
              )}
            </dl>
          </Panel>
          <Panel title="History">
            <ol className="space-y-3 text-sm">
              {bug.history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">{h.user?.name ?? 'Someone'}</span>{' '}
                  {h.field === 'created' ? (
                    <span className="text-muted-foreground">created the bug</span>
                  ) : (
                    <span className="text-muted-foreground">
                      changed {FIELD_LABELS[h.field] ?? humanize(h.field).toLowerCase()} from <em>{display(h.field, h.fromValue)}</em> to <em>{display(h.field, h.toValue)}</em>
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

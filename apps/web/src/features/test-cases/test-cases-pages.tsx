import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Copy, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PRIORITIES, TEST_CASE_STATUSES, TEST_TYPES } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader, Pagination, Panel } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { AiBadge, PriorityBadge, ResultBadge, StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AttachmentsPanel } from '@/features/attachments/attachments-panel';
import { useProjectScope } from '@/features/projects/project-scope';
import { keys, useSuites } from '@/features/projects/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import type { Paginated, TestCase, TestCaseListItem } from '@/lib/types';
import { TestCaseForm, type TestCaseFormOutput } from './test-case-form';

const FILTERS = ['q', 'suiteId', 'priority', 'type', 'status', 'tag', 'sort', 'order', 'page'] as const;

export function TestCasesPage() {
  const { projectId, project, writable, base } = useProjectScope();
  const [params, setParams] = useSearchParams();
  const suites = useSuites(projectId);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const query = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? undefined]));
  const page = Number(params.get('page') ?? 1);

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

  const { data, isPending, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ['test-cases', projectId, query],
    queryFn: () => api.get<Paginated<TestCaseListItem>>(`/projects/${projectId}/test-cases`, { ...query, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (field: string) => {
    const next = new URLSearchParams(params);
    const sameField = (params.get('sort') ?? 'updatedAt') === field;
    next.set('sort', field);
    next.set('order', sameField && params.get('order') !== 'asc' ? 'asc' : 'desc');
    setParams(next, { replace: true });
  };
  const hasFilters = FILTERS.some((k) => k !== 'sort' && k !== 'order' && k !== 'page' && params.get(k));

  return (
    <>
      <PageHeader
        title="Test cases"
        crumbs={[{ label: 'Projects', to: '/projects' }, { label: project.name, to: `/projects/${projectId}` }, { label: 'Test cases' }]}
        actions={
          writable && (
            <Button asChild>
              <Link to={`${base}/test-cases/new`}>
                <Plus /> New test case
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input className="lg:col-span-2" placeholder="Search title or description…" aria-label="Search test cases" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter by suite" value={params.get('suiteId') ?? ''} onChange={(e) => setParam('suiteId', e.target.value)}>
          <option value="">All suites</option>
          {suites.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by priority" value={params.get('priority') ?? ''} onChange={(e) => setParam('priority', e.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by type" value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value)}>
          <option value="">Any type</option>
          {TEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by status" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Any status</option>
          {TEST_CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {params.get('tag') && (
        <p className="mb-3 text-sm">
          Tag: <code>{params.get('tag')}</code>{' '}
          <button type="button" className="text-primary hover:underline" onClick={() => setParam('tag', '')}>
            clear
          </button>
        </p>
      )}

      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={hasFilters ? 'No test cases match these filters' : 'No test cases yet'}
          description={hasFilters ? 'Try clearing filters.' : 'Document your first test case, or generate drafts with the AI Assistant.'}
          action={
            !hasFilters && writable ? (
              <Button asChild>
                <Link to={`${base}/test-cases/new`}>
                  <Plus /> New test case
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('title')}>
                      Title <ArrowDownUp className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead>Suite</TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('priority')}>
                      Priority <ArrowDownUp className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Assignee</TableHead>
                  <TableHead className="hidden lg:table-cell">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('updatedAt')}>
                      Updated <ArrowDownUp className="size-3" />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((tc) => (
                  <TableRow key={tc.id}>
                    <TableCell className="max-w-md">
                      <Link to={`${base}/test-cases/${tc.id}`} className="font-medium hover:text-primary">
                        {tc.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {tc.aiGenerated && <AiBadge />}
                        {tc.tags.map((t) => (
                          <button key={t} type="button" onClick={() => setParam('tag', t)} className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                            #{t}
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tc.suite.name}</TableCell>
                    <TableCell>
                      <PriorityBadge priority={tc.priority} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{humanize(tc.type)}</TableCell>
                    <TableCell>
                      <StatusBadge status={tc.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{tc.assignee?.name ?? '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(tc.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParam('page', String(p))} />
        </div>
      )}
    </>
  );
}

export function NewTestCasePage() {
  const { projectId, project, base } = useProjectScope();
  const suites = useSuites(projectId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const create = useMutation({
    mutationFn: (v: TestCaseFormOutput) => api.post<TestCase>(`/projects/${projectId}/test-cases`, v),
    onSuccess: (tc) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
      toast.success('Test case created');
      navigate(`${base}/test-cases/${tc.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (suites.isPending) return <LoadingRows />;
  const suiteId = params.get('suiteId') ?? suites.data?.[0]?.id ?? '';
  return (
    <>
      <PageHeader title="New test case" crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test cases', to: `${base}/test-cases` }, { label: 'New' }]} />
      <Panel>
        <TestCaseForm
          projectId={projectId}
          defaultValues={{ suiteId, title: '', priority: 'MEDIUM', type: 'FUNCTIONAL', status: 'DRAFT', tags: [], steps: [{ action: '', expectedResult: '' }] }}
          submitLabel="Create test case"
          pending={create.isPending}
          onSubmit={(v) => create.mutate(v)}
        />
      </Panel>
    </>
  );
}

function useTestCase(projectId: string, caseId: string) {
  return useQuery({ queryKey: ['test-case', projectId, caseId], queryFn: () => api.get<TestCase>(`/projects/${projectId}/test-cases/${caseId}`) });
}

export function EditTestCasePage() {
  const { caseId = '' } = useParams();
  const { projectId, base } = useProjectScope();
  const { data: tc, isPending, error } = useTestCase(projectId, caseId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (v: TestCaseFormOutput) => api.patch<TestCase>(`/projects/${projectId}/test-cases/${caseId}`, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
      queryClient.invalidateQueries({ queryKey: ['test-case', projectId, caseId] });
      toast.success('Test case saved');
      navigate(`${base}/test-cases/${caseId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} />;
  return (
    <>
      <PageHeader title="Edit test case" crumbs={[{ label: 'Test cases', to: `${base}/test-cases` }, { label: tc.title, to: `${base}/test-cases/${caseId}` }, { label: 'Edit' }]} />
      <Panel>
        <TestCaseForm
          projectId={projectId}
          defaultValues={{
            suiteId: tc.suiteId,
            title: tc.title,
            description: tc.description,
            preconditions: tc.preconditions,
            priority: tc.priority,
            type: tc.type,
            status: tc.status,
            environment: tc.environment,
            expectedResult: tc.expectedResult,
            tags: tc.tags,
            assigneeId: tc.assigneeId,
            automationKey: tc.automationKey,
            steps: tc.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult })),
            aiGenerated: tc.aiGenerated,
          }}
          submitLabel="Save changes"
          pending={save.isPending}
          onSubmit={(v) => save.mutate(v)}
        />
      </Panel>
    </>
  );
}

export function TestCaseDetailPage() {
  const { caseId = '' } = useParams();
  const { projectId, project, writable, base } = useProjectScope();
  const { data: tc, isPending, error, refetch } = useTestCase(projectId, caseId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const duplicate = useMutation({
    mutationFn: () => api.post<TestCase>(`/projects/${projectId}/test-cases/${caseId}/duplicate`),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
      toast.success('Test case duplicated');
      navigate(`${base}/test-cases/${copy.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/test-cases/${caseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
      toast.success('Test case deleted');
      navigate(`${base}/test-cases`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        title={tc.title}
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test cases', to: `${base}/test-cases` }, { label: tc.title }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={tc.priority} /> <StatusBadge status={tc.status} /> <span>{humanize(tc.type)}</span> · <span>{tc.suite.name}</span>
            {tc.aiGenerated && <AiBadge />}
          </span>
        }
        actions={
          writable && (
            <>
              <Button asChild variant="outline">
                <Link to={`${base}/test-cases/${caseId}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
              <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
                <Copy /> Duplicate
              </Button>
              <ConfirmDialog
                title="Delete test case?"
                description="It will be removed from active plans. Execution history and linked bugs are preserved."
                onConfirm={() => remove.mutateAsync()}
                trigger={
                  <Button variant="outline">
                    <Trash2 /> Delete
                  </Button>
                }
              />
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {tc.aiGenerated && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
              This test case was drafted by the AI assistant. Review it before marking it Ready.
            </p>
          )}
          <Panel title="Details">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <TextBlock label="Description" value={tc.description} wide />
              <TextBlock label="Preconditions" value={tc.preconditions} />
              <TextBlock label="Expected result" value={tc.expectedResult} />
            </dl>
          </Panel>
          <Panel title={`Steps (${tc.steps.length})`}>
            {tc.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps defined.</p>
            ) : (
              <ol className="space-y-3">
                {tc.steps.map((s) => (
                  <li key={s.id} className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[2rem_1fr_1fr]">
                    <span className="font-semibold text-muted-foreground tabular-nums">{s.position}.</span>
                    <p className="whitespace-pre-wrap">{s.action}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{s.expectedResult || '—'}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <AttachmentsPanel projectId={projectId} entityType="TEST_CASE" entityId={tc.id} writable={writable} />
        </div>
        <div className="space-y-4">
          <Panel title="Properties">
            <dl className="space-y-3 text-sm">
              {(
                [
                  ['Assignee', tc.assignee?.name ?? 'Unassigned'],
                  ['Environment', tc.environment || '—'],
                  ['Automation key', tc.automationKey ?? '—'],
                  ['Created by', tc.createdBy.name],
                  ['Created', formatDateTime(tc.createdAt)],
                  ['Updated', formatDateTime(tc.updatedAt)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right break-all">{v}</dd>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 pt-1">
                {tc.tags.map((t) => (
                  <Link key={t} to={`${base}/test-cases?tag=${encodeURIComponent(t)}`} className="rounded bg-muted px-1.5 text-xs text-muted-foreground hover:text-foreground">
                    #{t}
                  </Link>
                ))}
              </div>
            </dl>
          </Panel>
          <Panel title="Recent executions">
            {!tc.recentResults?.length ? (
              <p className="text-sm text-muted-foreground">Never executed.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {tc.recentResults.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link to={`${base}/test-runs/${r.testRun.id}`} className="min-w-0 truncate hover:text-primary">
                      {r.testRun.name}
                    </Link>
                    <ResultBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function TextBlock({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="mb-1 text-xs font-medium text-muted-foreground uppercase">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || '—'}</dd>
    </div>
  );
}

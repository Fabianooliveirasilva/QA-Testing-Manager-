import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { TEST_PLAN_STATUSES, type TestPlanStatus } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, PageHeader, Panel } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { PriorityBadge, StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useProjectScope } from '@/features/projects/project-scope';
import { useSuites } from '@/features/projects/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatPercent, humanize } from '@/lib/format';
import type { Paginated, TestCaseListItem, TestPlan, TestPlanDetail, TestRunSummary } from '@/lib/types';
import { passRateOf } from '@/features/test-runs/run-utils';

interface PlanDraft {
  name: string;
  description: string;
  scope: string;
  environment: string;
  status: TestPlanStatus;
  suiteIds: string[];
  testCaseIds: string[];
}

function PlanDialog({ plan, trigger }: { plan?: TestPlanDetail; trigger: React.ReactNode }) {
  const { projectId, base } = useProjectScope();
  const suites = useSuites(projectId);
  const cases = useQuery({
    queryKey: ['test-cases', projectId, 'all-for-plan'],
    queryFn: () => api.get<Paginated<TestCaseListItem>>(`/projects/${projectId}/test-cases`, { pageSize: 100, sort: 'title', order: 'asc' }),
  });
  const [open, setOpen] = useState(false);
  const initial: PlanDraft = {
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    scope: plan?.scope ?? '',
    environment: plan?.environment ?? '',
    status: plan?.status ?? 'DRAFT',
    suiteIds: [],
    testCaseIds: plan?.cases.filter((c) => !c.deletedAt).map((c) => c.id) ?? [],
  };
  const [draft, setDraft] = useState<PlanDraft>(initial);
  const [nameError, setNameError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () => (plan ? api.patch<TestPlan>(`/projects/${projectId}/test-plans/${plan.id}`, draft) : api.post<TestPlan>(`/projects/${projectId}/test-plans`, draft)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['test-plans', projectId] });
      queryClient.invalidateQueries({ queryKey: ['test-plan', projectId, saved.id] });
      toast.success(plan ? 'Plan updated' : 'Plan created');
      setOpen(false);
      if (!plan) navigate(`${base}/test-plans/${saved.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (key: 'suiteIds' | 'testCaseIds', id: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] }));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(initial);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit test plan' : 'New test plan'}</DialogTitle>
          <DialogDescription>Selecting a suite adds all of its active (non-deprecated) test cases.</DialogDescription>
        </DialogHeader>
        <form
          id="plan-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) {
              setNameError('Name is required');
              return;
            }
            setNameError('');
            save.mutate();
          }}
        >
          <Field label="Name" htmlFor="plan-name" error={nameError}>
            <Input id="plan-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={!!nameError} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Environment" htmlFor="plan-env">
              <Input id="plan-env" value={draft.environment} onChange={(e) => setDraft({ ...draft, environment: e.target.value })} placeholder="e.g. staging" />
            </Field>
            <Field label="Status" htmlFor="plan-status">
              <NativeSelect id="plan-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TestPlanStatus })}>
                {TEST_PLAN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Scope" htmlFor="plan-scope">
            <Textarea id="plan-scope" rows={2} value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} placeholder="What is in and out of scope" />
          </Field>
          <Field label="Description" htmlFor="plan-description">
            <Textarea id="plan-description" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Include suites</legend>
            <div className="flex flex-wrap gap-2">
              {suites.data?.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <input type="checkbox" className="accent-primary" checked={draft.suiteIds.includes(s.id)} onChange={() => toggle('suiteIds', s.id)} />
                  {s.name} <span className="text-muted-foreground">({s._count.testCases})</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Or pick individual test cases ({draft.testCaseIds.length} selected)</legend>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
              {cases.data?.items.length === 0 && <p className="p-2 text-sm text-muted-foreground">No test cases in this project yet.</p>}
              {cases.data?.items
                .filter((c) => c.status !== 'DEPRECATED')
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                    <input type="checkbox" className="accent-primary" checked={draft.testCaseIds.includes(c.id)} onChange={() => toggle('testCaseIds', c.id)} />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{c.suite.name}</span>
                  </label>
                ))}
            </div>
            {cases.data && cases.data.total > cases.data.items.length && (
              <p className="mt-1 text-xs text-muted-foreground">Showing the first 100 cases; use suites to include the rest.</p>
            )}
          </fieldset>
        </form>
        <DialogFooter>
          <Button type="submit" form="plan-form" disabled={save.isPending}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TestPlansPage() {
  const { projectId, project, writable, base } = useProjectScope();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['test-plans', projectId],
    queryFn: () => api.get<{ items: TestPlan[] }>(`/projects/${projectId}/test-plans`).then((r) => r.items),
  });
  return (
    <>
      <PageHeader
        title="Test plans"
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test plans' }]}
        actions={
          writable && (
            <PlanDialog
              trigger={
                <Button>
                  <Plus /> New plan
                </Button>
              }
            />
          )
        }
      />
      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No test plans yet" description="A plan groups test cases for a release or cycle. Start runs from a plan." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((p) => (
            <Link key={p.id} to={`${base}/test-plans/${p.id}`} className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium">{p.name}</h2>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.scope || p.description || 'No scope defined'}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {p._count.cases} cases · {p._count.runs ?? 0} runs {p.environment && `· ${p.environment}`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function TestPlanDetailPage() {
  const { planId = '' } = useParams();
  const { projectId, project, writable, base } = useProjectScope();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [runName, setRunName] = useState('');
  const { data: plan, isPending, error, refetch } = useQuery({
    queryKey: ['test-plan', projectId, planId],
    queryFn: () => api.get<TestPlanDetail>(`/projects/${projectId}/test-plans/${planId}`),
  });
  const start = useMutation({
    mutationFn: () => api.post<TestRunSummary>(`/projects/${projectId}/test-runs`, { testPlanId: planId, name: runName.trim() || `${plan?.name} run`, environment: plan?.environment ?? '' }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] });
      toast.success('Run started');
      navigate(`${base}/test-runs/${run.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/test-plans/${planId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-plans', projectId] });
      navigate(`${base}/test-plans`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const activeCases = plan.cases.filter((c) => !c.deletedAt);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {plan.name} <StatusBadge status={plan.status} />
          </span>
        }
        description={plan.environment ? `Environment: ${plan.environment}` : undefined}
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test plans', to: `${base}/test-plans` }, { label: plan.name }]}
        actions={
          writable && (
            <>
              <PlanDialog
                plan={plan}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
              {plan.runs.length === 0 && (
                <ConfirmDialog
                  title="Delete plan?"
                  description="This plan has no runs and will be permanently deleted."
                  onConfirm={() => remove.mutateAsync()}
                  trigger={
                    <Button variant="outline">
                      <Trash2 /> Delete
                    </Button>
                  }
                />
              )}
            </>
          )
        }
      />
      {writable && plan.status !== 'ARCHIVED' && (
        <Panel className="mb-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder={`Run name (default: “${plan.name} run”)`} aria-label="Run name" maxLength={150} />
            <Button type="submit" disabled={start.isPending || activeCases.length === 0}>
              <Play /> Start manual run
            </Button>
          </form>
          {activeCases.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Add test cases to this plan before starting a run.</p>}
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title={`Test cases (${activeCases.length})`} className="lg:col-span-3">
          {plan.scope && <p className="mb-3 text-sm whitespace-pre-wrap text-muted-foreground">{plan.scope}</p>}
          {activeCases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No test cases selected.</p>
          ) : (
            <ul className="divide-y">
              {activeCases.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link to={`${base}/test-cases/${c.id}`} className="min-w-0 truncate hover:text-primary">
                    {c.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{c.suite.name}</span>
                    <PriorityBadge priority={c.priority} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Runs (${plan.runs.length})`} className="lg:col-span-2">
          {plan.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not executed yet.</p>
          ) : (
            <ul className="divide-y">
              {plan.runs.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <Link to={`${base}/test-runs/${r.id}`} className="flex items-center justify-between gap-2 hover:text-primary">
                    <span className="min-w-0 truncate">{r.name}</span>
                    <StatusBadge status={r.status} />
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(r.startedAt)} · pass rate {formatPercent(passRateOf(r.summary))} · {r.summary.NOT_RUN} pending
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

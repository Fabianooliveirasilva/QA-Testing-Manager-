import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, OctagonAlert, PlayCircle, SkipForward, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ResultStatus } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader, Pagination, Panel } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Pill, ResultBadge, StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentsPanel } from '@/features/attachments/attachments-panel';
import { useProjectScope } from '@/features/projects/project-scope';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration, formatPercent } from '@/lib/format';
import type { Paginated, TestResult, TestRunDetail, TestRunSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { progressOf } from './run-utils';

function SummaryBar({ summary }: { summary: TestRunSummary['summary'] }) {
  const segments: [ResultStatus, string][] = [
    ['PASSED', 'bg-success'],
    ['FAILED', 'bg-destructive'],
    ['BLOCKED', 'bg-warning'],
    ['SKIPPED', 'bg-muted-foreground/50'],
  ];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Passed ${summary.PASSED}, failed ${summary.FAILED}, blocked ${summary.BLOCKED}, skipped ${summary.SKIPPED}, not run ${summary.NOT_RUN}`}>
      {segments.map(([k, cls]) => (summary[k] ? <span key={k} className={cls} style={{ width: `${(summary[k] / summary.total) * 100}%` }} /> : null))}
    </div>
  );
}

export function TestRunsPage() {
  const { projectId, project, base } = useProjectScope();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const source = params.get('source') ?? '';
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['test-runs', projectId, page, source],
    queryFn: () => api.get<Paginated<TestRunSummary>>(`/projects/${projectId}/test-runs`, { page, pageSize: 20, source: source || undefined }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Test runs"
        description="Manual executions started from plans and Playwright reports imported from CI."
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test runs' }]}
        actions={
          <div className="w-44">
            <NativeSelect aria-label="Filter by source" value={source} onChange={(e) => setParams(e.target.value ? { source: e.target.value } : {})}>
              <option value="">All sources</option>
              <option value="MANUAL">Manual</option>
              <option value="PLAYWRIGHT">Playwright</option>
            </NativeSelect>
          </div>
        }
      />
      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={PlayCircle}
          title="No runs yet"
          description="Start a run from a test plan, or import a Playwright report in Automation."
          action={
            <Button asChild variant="outline">
              <Link to={`${base}/test-plans`}>Go to test plans</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((r) => (
              <li key={r.id}>
                <Link to={`${base}/test-runs/${r.id}`} className="block rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      <Pill tone={r.source === 'PLAYWRIGHT' ? 'violet' : 'blue'}>{r.source === 'PLAYWRIGHT' ? 'Playwright' : 'Manual'}</Pill>
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.startedAt)} · {r.executedBy.name}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <SummaryBar summary={r.summary} />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {progressOf(r.summary)}% done · {formatPercent(r.passRate)} pass
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={(p) => setParams({ ...(source ? { source } : {}), page: String(p) })} />
        </>
      )}
    </>
  );
}

const STATUS_ACTIONS: { status: ResultStatus; label: string; icon: typeof CheckCircle2; cls: string }[] = [
  { status: 'PASSED', label: 'Pass', icon: CheckCircle2, cls: 'data-[active=true]:bg-success/15 data-[active=true]:text-success data-[active=true]:border-success/40' },
  { status: 'FAILED', label: 'Fail', icon: XCircle, cls: 'data-[active=true]:bg-destructive/15 data-[active=true]:text-destructive data-[active=true]:border-destructive/40' },
  { status: 'BLOCKED', label: 'Block', icon: OctagonAlert, cls: 'data-[active=true]:bg-warning/15 data-[active=true]:text-warning data-[active=true]:border-warning/40' },
  { status: 'SKIPPED', label: 'Skip', icon: SkipForward, cls: 'data-[active=true]:bg-muted data-[active=true]:text-foreground' },
];

function ResultRow({ result, run, editable }: { result: TestResult; run: TestRunDetail; editable: boolean }) {
  const { projectId, base, writable } = useProjectScope();
  const [expanded, setExpanded] = useState(false);
  const [actual, setActual] = useState(result.actualResult);
  const [notes, setNotes] = useState(result.notes);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useMutation({
    mutationFn: (status: ResultStatus) =>
      api.patch(`/projects/${projectId}/test-runs/${run.id}/results/${result.id}`, { status, actualResult: actual, notes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-run', projectId, run.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const automated = run.source === 'PLAYWRIGHT';

  return (
    <li className="rounded-lg border bg-card" data-testid="result-row">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="min-w-0 truncate text-sm font-medium">{result.title}</span>
          {result.metadata?.flaky && <Pill tone="amber">Flaky</Pill>}
          {result._count.bugs > 0 && <Pill tone="red">{result._count.bugs} bug</Pill>}
        </button>
        {editable ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label={`Set result for ${result.title}`}>
            {STATUS_ACTIONS.map((a) => (
              <Button
                key={a.status}
                size="sm"
                variant="outline"
                data-active={result.status === a.status}
                className={cn('h-8', a.cls)}
                disabled={update.isPending}
                onClick={() => update.mutate(a.status)}
              >
                <a.icon /> {a.label}
              </Button>
            ))}
          </div>
        ) : (
          <span className="flex items-center gap-2">
            {result.durationMs != null && <span className="text-xs text-muted-foreground">{formatDuration(result.durationMs)}</span>}
            <ResultBadge status={result.status} />
          </span>
        )}
      </div>
      {expanded && (
        <div className="space-y-4 border-t p-4 text-sm">
          {result.testCase ? (
            <div className="space-y-2">
              <Link to={`${base}/test-cases/${result.testCase.id}`} className="text-xs text-primary hover:underline">
                Open test case →
              </Link>
              {result.testCase.preconditions && <p className="text-muted-foreground">Preconditions: {result.testCase.preconditions}</p>}
              {result.testCase.steps.length > 0 && (
                <ol className="list-decimal space-y-1 pl-5">
                  {result.testCase.steps.map((s) => (
                    <li key={s.id}>
                      {s.action}
                      {s.expectedResult && <span className="text-muted-foreground"> → {s.expectedResult}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {result.testCase.expectedResult && <p>Expected: {result.testCase.expectedResult}</p>}
            </div>
          ) : (
            automated && <p className="text-xs text-muted-foreground">Not linked to a managed test case (automation key: {result.automationKey}).</p>
          )}
          {automated && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {result.metadata?.file} · {result.retries} {result.retries === 1 ? "retry" : "retries"} · {formatDuration(result.durationMs)}
              </p>
              {result.errorMessage && <pre className="max-h-64 overflow-auto rounded-md bg-destructive/10 p-3 text-xs whitespace-pre-wrap text-destructive">{result.errorMessage}</pre>}
              {result.errorStack && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Stack trace</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{result.errorStack}</pre>
                </details>
              )}
              {!!result.metadata?.attachments?.length && (
                <p className="text-xs text-muted-foreground">
                  Report attachments (stored on the CI runner, not uploaded): {result.metadata.attachments.map((a) => a.name).join(', ')}
                </p>
              )}
            </div>
          )}
          {editable ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor={`actual-${result.id}`} className="text-xs font-medium">
                  Actual result
                </label>
                <Textarea id={`actual-${result.id}`} rows={2} value={actual} onChange={(e) => setActual(e.target.value)} />
              </div>
              <div>
                <label htmlFor={`notes-${result.id}`} className="text-xs font-medium">
                  Notes
                </label>
                <Textarea id={`notes-${result.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground md:col-span-2">Notes are saved when you set a status.</p>
            </div>
          ) : (
            (result.actualResult || result.notes) && (
              <div className="space-y-1">
                {result.actualResult && <p>Actual: {result.actualResult}</p>}
                {result.notes && <p className="text-muted-foreground">Notes: {result.notes}</p>}
              </div>
            )
          )}
          {result.executedBy && (
            <p className="text-xs text-muted-foreground">
              Executed by {result.executedBy.name} · {formatDateTime(result.executedAt)}
            </p>
          )}
          {!automated && result.status !== 'NOT_RUN' && <AttachmentsPanel projectId={projectId} entityType="TEST_RESULT" entityId={result.id} writable={writable} />}
          {writable && result.status === 'FAILED' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate(`${base}/bugs/new?testResultId=${result.id}${result.testCase ? `&testCaseId=${result.testCase.id}` : ''}&title=${encodeURIComponent(result.title)}`)
              }
            >
              <Bug /> Report bug
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function TestRunDetailPage() {
  const { runId = '' } = useParams();
  const { projectId, project, writable, base } = useProjectScope();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ResultStatus | ''>('');
  const { data: run, isPending, error, refetch } = useQuery({
    queryKey: ['test-run', projectId, runId],
    queryFn: () => api.get<TestRunDetail>(`/projects/${projectId}/test-runs/${runId}`),
  });
  const close = useMutation({
    mutationFn: (action: 'complete' | 'abort') => api.post(`/projects/${projectId}/test-runs/${runId}/${action}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-run', projectId, runId] });
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] });
      toast.success('Run closed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isPending) return <LoadingRows rows={8} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const editable = writable && run.source === 'MANUAL' && run.status === 'IN_PROGRESS';
  const results = filter ? run.results.filter((r) => r.status === filter) : run.results;
  const s = run.summary;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {run.name} <StatusBadge status={run.status} />
            <Pill tone={run.source === 'PLAYWRIGHT' ? 'violet' : 'blue'}>{run.source === 'PLAYWRIGHT' ? 'Playwright' : 'Manual'}</Pill>
          </span>
        }
        description={`Started ${formatDateTime(run.startedAt)} by ${run.executedBy.name}${run.environment ? ` · ${run.environment}` : ''}${run.finishedAt ? ` · finished ${formatDateTime(run.finishedAt)}` : ''}`}
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Test runs', to: `${base}/test-runs` }, { label: run.name }]}
        actions={
          editable && (
            <>
              <ConfirmDialog
                title="Abort run?"
                description="The run will be closed as aborted; pending results stay Not run."
                confirmLabel="Abort"
                onConfirm={() => close.mutateAsync('abort')}
                trigger={
                  <Button variant="outline">
                    <CircleSlash /> Abort
                  </Button>
                }
              />
              <ConfirmDialog
                title="Complete run?"
                description={s.NOT_RUN > 0 ? `${s.NOT_RUN} test(s) are still Not run. Results can no longer be changed after completion.` : 'Results can no longer be changed after completion.'}
                confirmLabel="Complete"
                onConfirm={() => close.mutateAsync('complete')}
                trigger={
                  <Button>
                    <CheckCircle2 /> Complete run
                  </Button>
                }
              />
            </>
          )
        }
      />
      <Panel className="mb-4">
        <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
          {(
            [
              ['Total', s.total, ''],
              ['Passed', s.PASSED, 'text-success'],
              ['Failed', s.FAILED, 'text-destructive'],
              ['Blocked', s.BLOCKED, 'text-warning'],
              ['Skipped', s.SKIPPED, 'text-muted-foreground'],
              ['Not run', s.NOT_RUN, 'text-muted-foreground'],
            ] as const
          ).map(([label, value, cls]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('text-xl font-semibold tabular-nums', cls)}>{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SummaryBar summary={s} />
          <span className="shrink-0 text-sm tabular-nums">
            Pass rate <strong>{formatPercent(run.passRate)}</strong>
          </span>
        </div>
        {run.automation && (
          <p className="mt-3 text-xs text-muted-foreground">
            Imported from Playwright {run.automation.reportMetadata.playwrightVersion ?? ''} via {run.automation.executionSource} · {run.automation.flaky} flaky ·{' '}
            {run.automation.matched}/{run.automation.totalTests} linked to test cases · duration {formatDuration(run.automation.durationMs)}
          </p>
        )}
      </Panel>
      {run.automation?.reportMetadata.globalErrors.length ? (
        <Panel title="Global errors" className="mb-4">
          {run.automation.reportMetadata.globalErrors.map((e, i) => (
            <pre key={i} className="mb-2 rounded bg-destructive/10 p-2 text-xs whitespace-pre-wrap text-destructive">
              {e}
            </pre>
          ))}
        </Panel>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Results</h2>
        <div className="w-40">
          <NativeSelect aria-label="Filter results" value={filter} onChange={(e) => setFilter(e.target.value as ResultStatus | '')}>
            <option value="">All results</option>
            {(['NOT_RUN', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const).map((st) => (
              <option key={st} value={st}>
                {st === 'NOT_RUN' ? 'Not run' : st.charAt(0) + st.slice(1).toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results match this filter.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <ResultRow key={r.id} result={r} run={run} editable={editable} />
          ))}
        </ul>
      )}
    </>
  );
}

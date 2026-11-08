import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, UploadCloud, Workflow } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { MAX_PLAYWRIGHT_REPORT_BYTES } from '@qtm/shared';
import { Field, PageHeader, Pagination, Panel } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProjectScope } from '@/features/projects/project-scope';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import type { AutomationExecution, Paginated } from '@/lib/types';

export function AutomationPage() {
  const { projectId, project, writable, manage, base } = useProjectScope();
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [runName, setRunName] = useState('');
  const [environment, setEnvironment] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['automation', projectId, page],
    queryFn: () => api.get<Paginated<AutomationExecution>>(`/projects/${projectId}/automation`, { page, pageSize: 20 }),
  });
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (runName.trim()) form.append('runName', runName.trim());
      if (environment.trim()) form.append('environment', environment.trim());
      form.append('report', file as File);
      return api.upload<AutomationExecution>(`/projects/${projectId}/automation/playwright`, form);
    },
    onSuccess: (exec) => {
      queryClient.invalidateQueries({ queryKey: ['automation', projectId] });
      queryClient.invalidateQueries({ queryKey: ['test-runs', projectId] });
      toast.success(`Imported ${exec.totalTests} tests (${exec.passed} passed, ${exec.failed} failed)`);
      navigate(`${base}/test-runs/${exec.testRunId}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const origin = window.location.origin;
  const curl = `npx playwright test --reporter=json > report.json
curl -fsS -X POST "${origin}/api/automation/playwright?runName=CI%20%23$GITHUB_RUN_NUMBER&environment=ci" \\
  -H "Authorization: Bearer $QTM_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data-binary @report.json`;

  return (
    <>
      <PageHeader
        title="Automation"
        description="Import Playwright JSON reports. QA Testing Manager does not execute your tests — it records the results your runner produced."
        crumbs={[{ label: project.name, to: `/projects/${projectId}` }, { label: 'Automation' }]}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {writable && (
          <Panel title="Upload a report">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (file) upload.mutate();
              }}
            >
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  setFile(e.dataTransfer.files[0] ?? null);
                }}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground transition hover:border-primary/50 hover:bg-accent/40"
              >
                {file ? <FileJson className="size-6 text-primary" /> : <UploadCloud className="size-6" />}
                {file ? (
                  <span className="text-foreground">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                ) : (
                  <span>Drop report.json here or click to choose (max {formatBytes(MAX_PLAYWRIGHT_REPORT_BYTES)})</span>
                )}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="Playwright JSON report"
                data-testid="report-input"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Run name (optional)" htmlFor="auto-name">
                  <Input id="auto-name" value={runName} onChange={(e) => setRunName(e.target.value)} maxLength={150} />
                </Field>
                <Field label="Environment (optional)" htmlFor="auto-env">
                  <Input id="auto-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} maxLength={120} />
                </Field>
              </div>
              <Button type="submit" disabled={!file || upload.isPending}>
                <UploadCloud /> {upload.isPending ? 'Importing…' : 'Import report'}
              </Button>
            </form>
          </Panel>
        )}
        <Panel title="Send reports from CI">
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              {manage ? (
                <>
                  Create a token in{' '}
                  <Link to={`/projects/${projectId}`} className="text-primary hover:underline">
                    project settings
                  </Link>{' '}
                  and store it as the <code>QTM_TOKEN</code> secret.
                </>
              ) : (
                <>Ask a project admin for an API token and store it as the <code>QTM_TOKEN</code> secret.</>
              )}
            </li>
            <li>Generate the JSON report and upload it:</li>
          </ol>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{curl}</pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Link a test to a test case with <code>{`test('…', { annotation: { type: 'qtm', description: 'LOGIN-001' } }, …)`}</code> and set the same automation key on the test case.
            Re-uploading the same report is rejected to avoid duplicates.
          </p>
        </Panel>
      </div>

      <h2 className="mb-3 text-sm font-semibold">Import history</h2>
      {isPending ? (
        <LoadingRows />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={Workflow} title="No imports yet" description="Upload a Playwright JSON report to see automated results here." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead className="text-right">Passed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Flaky</TableHead>
                  <TableHead className="hidden md:table-cell">Duration</TableHead>
                  <TableHead className="hidden lg:table-cell">Source</TableHead>
                  <TableHead className="hidden lg:table-cell">Imported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link to={`${base}/test-runs/${e.testRunId}`} className="font-medium hover:text-primary">
                        {e.testRun?.name ?? 'Run'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.totalTests}</TableCell>
                    <TableCell className="text-right text-success tabular-nums">{e.passed}</TableCell>
                    <TableCell className="text-right text-destructive tabular-nums">{e.failed}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.skipped}</TableCell>
                    <TableCell className="text-right text-warning tabular-nums">{e.flaky}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatDuration(e.durationMs)}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{e.executionSource}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDateTime(e.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

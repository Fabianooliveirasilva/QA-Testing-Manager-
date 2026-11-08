import { useQuery } from '@tanstack/react-query';
import { Activity, Bug, CheckCircle2, FolderKanban, ListChecks, OctagonAlert, PlayCircle, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PageHeader, StatCard } from '@/components/page';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { NativeSelect } from '@/components/ui/native-select';
import { useWorkspace } from '@/features/auth/session';
import { useProjects } from '@/features/projects/queries';
import { api } from '@/lib/api';
import { formatPercent, humanize, timeAgo } from '@/lib/format';
import type { DashboardData } from '@/lib/types';

const STATUS_COLORS = {
  PASSED: 'var(--color-chart-1)',
  FAILED: 'var(--color-chart-2)',
  BLOCKED: 'var(--color-chart-3)',
  SKIPPED: 'var(--color-chart-4)',
} as const;
const SEVERITY_COLORS = { CRITICAL: 'var(--color-chart-2)', HIGH: 'var(--color-chart-3)', MEDIUM: 'var(--color-chart-5)', LOW: 'var(--color-chart-4)' } as const;

const tooltipStyle = {
  contentStyle: { background: 'var(--color-popover)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--color-foreground)' },
};

export function DashboardPage() {
  const { organization } = useWorkspace();
  const [projectId, setProjectId] = useState('');
  const projects = useProjects(organization.id);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['dashboard', organization.id, projectId || null],
    queryFn: () => api.get<DashboardData>(`/organizations/${organization.id}/dashboard`, { projectId: projectId || undefined }),
    // Metrics must reflect the latest persisted data whenever the page is opened.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Quality overview for ${organization.name}`}
        actions={
          <div className="w-56">
            <NativeSelect aria-label="Filter by project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
      />
      {isPending ? (
        <LoadingRows rows={8} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <DashboardContent data={data} hasProjects={(projects.data?.length ?? 0) > 0} />
      )}
    </>
  );
}

function DashboardContent({ data, hasProjects }: { data: DashboardData; hasProjects: boolean }) {
  if (!hasProjects) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="Create your first project"
        description="Projects group your suites, test cases, plans, runs and bugs. Metrics appear here once you start executing tests."
        action={
          <Link to="/projects" className="text-sm font-medium text-primary hover:underline">
            Go to projects →
          </Link>
        }
      />
    );
  }
  const { totals, results } = data;
  const donut = (['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const).map((s) => ({ name: humanize(s), key: s, value: results[s] })).filter((d) => d.value > 0);
  const history = data.executionHistory.map((d) => ({ ...d, label: d.date.slice(5) }));
  const hasHistory = history.some((d) => d.PASSED + d.FAILED + d.BLOCKED + d.SKIPPED > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active projects" value={totals.projects} icon={<FolderKanban />} />
        <StatCard label="Test cases" value={totals.testCases} icon={<ListChecks />} />
        <StatCard label="Open bugs" value={totals.openBugs} icon={<Bug />} tone="text-warning" />
        <StatCard label="Critical bugs" value={totals.criticalBugs} icon={<ShieldAlert />} tone="text-destructive" />
        <StatCard label="Passed" value={results.PASSED} hint={`last ${results.windowDays} days`} icon={<CheckCircle2 />} tone="text-success" />
        <StatCard label="Failed" value={results.FAILED} hint={`last ${results.windowDays} days`} icon={<XCircle />} tone="text-destructive" />
        <StatCard label="Blocked" value={results.BLOCKED} hint={`last ${results.windowDays} days`} icon={<OctagonAlert />} tone="text-warning" />
        <StatCard
          label="Pass rate"
          value={formatPercent(results.passRate)}
          hint="passed ÷ (passed + failed + blocked)"
          icon={<Activity />}
          tone="text-primary"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Execution history (14 days)" className="lg:col-span-2">
          {hasHistory ? (
            <div className="h-64" role="img" aria-label="Stacked bar chart of executed results per day">
              <ResponsiveContainer>
                <BarChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--color-accent)', opacity: 0.4 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {(Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]).map((s) => (
                    <Bar key={s} dataKey={s} name={humanize(s)} stackId="a" fill={STATUS_COLORS[s]} radius={s === 'SKIPPED' ? [3, 3, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={PlayCircle} title="No executions in the last 14 days" description="Run a test plan or import a Playwright report." />
          )}
        </Panel>

        <Panel title={`Results (${results.windowDays} days)`}>
          {donut.length ? (
            <div className="h-64" role="img" aria-label="Donut chart of result statuses">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="none">
                    {donut.map((d) => (
                      <Cell key={d.key} fill={STATUS_COLORS[d.key]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">No executed results yet.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Open bugs by severity">
          {data.bugsBySeverity.length ? (
            <div className="h-52">
              <ResponsiveContainer>
                <BarChart data={data.bugsBySeverity.map((b) => ({ ...b, label: humanize(b.severity) }))} layout="vertical">
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis type="category" dataKey="label" width={70} tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: 'var(--color-accent)', opacity: 0.4 }} />
                  <Bar dataKey="count" name="Bugs" radius={[0, 4, 4, 0]}>
                    {data.bugsBySeverity.map((b) => (
                      <Cell key={b.severity} fill={SEVERITY_COLORS[b.severity]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No open bugs. 🎉</p>
          )}
        </Panel>

        <Panel title="Recent runs">
          {data.recentRuns.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {data.recentRuns.map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link to={`/p/${r.projectId}/test-runs/${r.id}`} className="flex items-center justify-between gap-2 hover:text-primary">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.project.name} · {r.source === 'PLAYWRIGHT' ? 'Playwright' : 'Manual'} · {timeAgo(r.startedAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1 text-xs tabular-nums">
                      <span className="text-success">{r.summary.PASSED}✓</span>
                      <span className="text-destructive">{r.summary.FAILED}✗</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity">
          {data.recentActivity.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.recentActivity.slice(0, 7).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{a.user?.name ?? 'System'}</span>{' '}
                    <span className="text-muted-foreground">{humanize(a.action.replace('.', ' '))}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {data.recentRuns.some((r) => r.status === 'IN_PROGRESS') && (
        <p className="text-xs text-muted-foreground">
          <StatusBadge status="IN_PROGRESS" /> runs are still open; their pending results are not counted yet.
        </p>
      )}
    </div>
  );
}

import { Prisma, type PrismaClient, type ResultStatus } from '@prisma/client';
import { emptyCounts, passRate, runSummaries } from '../test-runs/run-summary.js';

const OPEN_BUG_STATUSES = ['OPEN', 'IN_PROGRESS', 'REOPENED'] as const;
const RESULT_WINDOW_DAYS = 30;
const HISTORY_DAYS = 14;

/** All figures are computed from persisted data; nothing here is estimated or synthesized. */
export async function dashboardMetrics(prisma: PrismaClient, organizationId: string, projectId?: string) {
  const projectFilter = projectId ? { id: projectId, organizationId } : { organizationId };
  const resultsSince = new Date(Date.now() - RESULT_WINDOW_DAYS * 86_400_000);
  const historySince = new Date();
  historySince.setUTCHours(0, 0, 0, 0);
  historySince.setUTCDate(historySince.getUTCDate() - (HISTORY_DAYS - 1));

  const [
    totalProjects,
    totalTestCases,
    openBugs,
    criticalBugs,
    resultGroups,
    bugsBySeverity,
    recentRuns,
    recentActivity,
    history,
  ] = await Promise.all([
    prisma.project.count({ where: { ...projectFilter, status: 'ACTIVE' } }),
    prisma.testCase.count({ where: { deletedAt: null, project: projectFilter } }),
    prisma.bug.count({ where: { project: projectFilter, status: { in: [...OPEN_BUG_STATUSES] } } }),
    prisma.bug.count({
      where: { project: projectFilter, status: { in: [...OPEN_BUG_STATUSES] }, severity: 'CRITICAL' },
    }),
    prisma.testResult.groupBy({
      by: ['status'],
      where: { executedAt: { gte: resultsSince }, testRun: { project: projectFilter } },
      _count: { _all: true },
    }),
    prisma.bug.groupBy({
      by: ['severity'],
      where: { project: projectFilter, status: { in: [...OPEN_BUG_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.testRun.findMany({
      where: { project: projectFilter },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        source: true,
        startedAt: true,
        projectId: true,
        project: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { organizationId, ...(projectId ? { metadata: { path: ['projectId'], equals: projectId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.$queryRaw<{ day: Date; status: ResultStatus; count: number }[]>(Prisma.sql`
      SELECT date_trunc('day', r.executed_at) AS day, r.status, count(*)::int AS count
      FROM test_results r
      JOIN test_runs t ON t.id = r.test_run_id
      JOIN projects p ON p.id = t.project_id
      WHERE p.organization_id = ${organizationId}::uuid
        ${projectId ? Prisma.sql`AND p.id = ${projectId}::uuid` : Prisma.empty}
        AND r.executed_at >= ${historySince}
        AND r.status <> 'NOT_RUN'
      GROUP BY 1, 2
      ORDER BY 1`),
  ]);

  const results = emptyCounts();
  for (const g of resultGroups) {
    results[g.status] += g._count._all;
    results.total += g._count._all;
  }

  const days = new Map<string, { date: string; PASSED: number; FAILED: number; BLOCKED: number; SKIPPED: number }>();
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = new Date(historySince.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    days.set(d, { date: d, PASSED: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0 });
  }
  for (const row of history) {
    const bucket = days.get(new Date(row.day).toISOString().slice(0, 10));
    if (bucket && row.status !== 'NOT_RUN') bucket[row.status] += row.count;
  }

  const summaries = await runSummaries(
    prisma,
    recentRuns.map((r) => r.id),
  );

  return {
    totals: { projects: totalProjects, testCases: totalTestCases, openBugs, criticalBugs },
    results: { windowDays: RESULT_WINDOW_DAYS, ...results, passRate: passRate(results) },
    executionHistory: [...days.values()],
    bugsBySeverity: bugsBySeverity.map((b) => ({ severity: b.severity, count: b._count._all })),
    recentRuns: recentRuns.map((r) => ({ ...r, summary: summaries.get(r.id) ?? emptyCounts() })),
    recentActivity,
  };
}

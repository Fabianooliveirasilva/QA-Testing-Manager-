import type { PrismaClient, ResultStatus } from '@prisma/client';

export type StatusCounts = Record<ResultStatus, number> & { total: number };

export const emptyCounts = (): StatusCounts => ({
  NOT_RUN: 0,
  PASSED: 0,
  FAILED: 0,
  BLOCKED: 0,
  SKIPPED: 0,
  total: 0,
});

/** Pass rate over executed, decisive results; SKIPPED and NOT_RUN do not count. Null when nothing ran. */
export function passRate(counts: Pick<StatusCounts, 'PASSED' | 'FAILED' | 'BLOCKED'>): number | null {
  const denominator = counts.PASSED + counts.FAILED + counts.BLOCKED;
  return denominator === 0 ? null : Math.round((counts.PASSED / denominator) * 1000) / 10;
}

export async function runSummaries(prisma: PrismaClient, runIds: string[]): Promise<Map<string, StatusCounts>> {
  const map = new Map<string, StatusCounts>(runIds.map((id) => [id, emptyCounts()]));
  if (runIds.length === 0) return map;
  const groups = await prisma.testResult.groupBy({
    by: ['testRunId', 'status'],
    where: { testRunId: { in: runIds } },
    _count: { _all: true },
  });
  for (const g of groups) {
    const counts = map.get(g.testRunId);
    if (!counts) continue;
    counts[g.status] += g._count._all;
    counts.total += g._count._all;
  }
  return map;
}

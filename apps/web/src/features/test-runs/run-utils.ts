import type { StatusCounts } from '@/lib/types';

/** Mirrors the API definition: passed ÷ (passed + failed + blocked); null when nothing decisive ran. */
export function passRateOf(c: Pick<StatusCounts, 'PASSED' | 'FAILED' | 'BLOCKED'>): number | null {
  const d = c.PASSED + c.FAILED + c.BLOCKED;
  return d === 0 ? null : Math.round((c.PASSED / d) * 1000) / 10;
}

export function progressOf(c: StatusCounts): number {
  return c.total === 0 ? 0 : Math.round(((c.total - c.NOT_RUN) / c.total) * 100);
}

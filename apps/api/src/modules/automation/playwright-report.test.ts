import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePlaywrightReport, playwrightReportSchema } from './playwright-report.js';

const real = JSON.parse(readFileSync(new URL('../../../tests/fixtures/playwright-report.json', import.meta.url), 'utf-8'));

const minimal = (tests: unknown[], extra: Record<string, unknown> = {}) => ({
  suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'spec', file: 'a.spec.ts', tests }] }],
  errors: [],
  stats: { startTime: '2026-01-01T00:00:00.000Z', duration: 10, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
  ...extra,
});
const test = (status: string, results: unknown[], expectedStatus = 'passed') => ({
  annotations: [],
  expectedStatus,
  projectName: '',
  results,
  status,
});
const result = (status: string, retry = 0, extra: Record<string, unknown> = {}) => ({
  status,
  duration: 100,
  retry,
  errors: [],
  attachments: [],
  annotations: [],
  ...extra,
});

describe('parsePlaywrightReport — real report', () => {
  const parsed = parsePlaywrightReport(playwrightReportSchema.parse(real));

  it('matches the reporter stats', () => {
    expect(parsed.totals).toEqual({ total: 5, passed: 3, failed: 1, skipped: 1, flaky: 1 });
    expect(parsed.playwrightVersion).toBe('1.65.0');
    expect(parsed.startedAt?.toISOString()).toBe(real.stats.startTime);
  });

  it('uses qtm annotations as automation keys and title paths otherwise', () => {
    const keys = parsed.tests.map((t) => t.automationKey);
    expect(keys).toContain('LOGIN-001');
    expect(keys).toContain('LOGIN-002');
    expect(keys).toContain('login.spec.ts > Login > remember-me checkbox is available');
  });

  it('captures error, stack without ANSI codes, retries and attachments of failures', () => {
    const failed = parsed.tests.find((t) => t.status === 'FAILED')!;
    expect(failed.errorMessage).toMatch(/toHaveTitle/);
    expect(failed.errorStack).toBeTruthy();
    expect(failed.errorMessage?.includes('\u001b')).toBe(false);
    expect(failed.retries).toBe(1);
    expect(failed.attachments.some((a) => a.contentType === 'image/png')).toBe(true);
    expect(failed.durationMs).toBeGreaterThan(0);
  });
});

describe('parsePlaywrightReport — status mapping', () => {
  const statusOf = (t: unknown) => parsePlaywrightReport(playwrightReportSchema.parse(minimal([t]))).tests[0]!;

  it('expected → PASSED, unexpected → FAILED, skipped → SKIPPED', () => {
    expect(statusOf(test('expected', [result('passed')])).status).toBe('PASSED');
    expect(statusOf(test('unexpected', [result('failed')])).status).toBe('FAILED');
    expect(statusOf(test('skipped', [result('skipped')], 'skipped')).status).toBe('SKIPPED');
  });

  it('flaky counts as PASSED but keeps the flaky flag and error of the failed attempt', () => {
    const t = statusOf(test('flaky', [result('failed', 0, { error: { message: 'boom' } }), result('passed', 1)]));
    expect(t).toMatchObject({ status: 'PASSED', flaky: true, retries: 1, errorMessage: 'boom', durationMs: 200 });
  });

  it('test.fail() that fails as expected is a PASS', () => {
    expect(statusOf(test('expected', [result('failed')], 'failed')).status).toBe('PASSED');
  });

  it('flags interrupted runs', () => {
    const parsed = parsePlaywrightReport(playwrightReportSchema.parse(minimal([test('unexpected', [result('interrupted')])])));
    expect(parsed.interrupted).toBe(true);
  });

  it('prefixes the Playwright project name and nests describe titles', () => {
    const report = minimal([]);
    report.suites[0]!.specs = [];
    Object.assign(report.suites[0]!, {
      suites: [{ title: 'Cart', file: 'a.spec.ts', specs: [{ title: 'adds item', file: 'a.spec.ts', tests: [{ ...test('expected', [result('passed')]), projectName: 'firefox' }] }] }],
    });
    const t = parsePlaywrightReport(playwrightReportSchema.parse(report)).tests[0]!;
    expect(t.title).toBe('[firefox] Cart > adds item');
    expect(t.automationKey).toBe('a.spec.ts > Cart > adds item');
  });
});

describe('playwrightReportSchema', () => {
  it.each([
    ['missing stats', { suites: [], errors: [] }],
    ['wrong suites type', { suites: 'x', stats: {} }],
    ['bad test status', minimal([test('weird', [])])],
  ])('rejects %s', (_name, value) => {
    expect(playwrightReportSchema.safeParse(value).success).toBe(false);
  });
});

import { z } from 'zod';
import type { ResultStatus } from '@qtm/shared';

/**
 * Validation for the Playwright JSON reporter output (`--reporter=json`), modelled on
 * the `JSONReport` types shipped in playwright/types/testReporter.d.ts. Unknown keys are ignored.
 */
const errorSchema = z.object({ message: z.string().optional(), stack: z.string().optional() }).loose();
const annotationSchema = z.object({ type: z.string(), description: z.string().optional() }).loose();

const resultSchema = z
  .object({
    status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']).optional(),
    duration: z.number().nonnegative(),
    retry: z.number().int().nonnegative().default(0),
    error: errorSchema.optional(),
    errors: z.array(errorSchema).default([]),
    startTime: z.string().optional(),
    attachments: z
      .array(z.object({ name: z.string(), contentType: z.string(), path: z.string().optional() }).loose())
      .default([]),
    annotations: z.array(annotationSchema).default([]),
  })
  .loose();

const testSchema = z
  .object({
    annotations: z.array(annotationSchema).default([]),
    expectedStatus: z.string(),
    projectName: z.string().default(''),
    results: z.array(resultSchema),
    status: z.enum(['skipped', 'expected', 'unexpected', 'flaky']),
  })
  .loose();

const specSchema = z
  .object({
    title: z.string(),
    file: z.string(),
    line: z.number().optional(),
    tags: z.array(z.string()).default([]),
    tests: z.array(testSchema),
  })
  .loose();

interface ReportSuite {
  title: string;
  file: string;
  specs: z.infer<typeof specSchema>[];
  suites?: ReportSuite[] | undefined;
}

const suiteSchema: z.ZodType<ReportSuite> = z.lazy(() =>
  z
    .object({
      title: z.string(),
      file: z.string(),
      specs: z.array(specSchema).default([]),
      suites: z.array(suiteSchema).optional(),
    })
    .loose(),
);

export const playwrightReportSchema = z
  .object({
    config: z.object({ version: z.string().optional() }).loose().optional(),
    suites: z.array(suiteSchema),
    errors: z.array(errorSchema).default([]),
    stats: z
      .object({
        startTime: z.string(),
        duration: z.number().nonnegative(),
        expected: z.number().int().nonnegative(),
        unexpected: z.number().int().nonnegative(),
        flaky: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();

export type PlaywrightReport = z.infer<typeof playwrightReportSchema>;

export interface ParsedTestResult {
  title: string;
  automationKey: string;
  file: string;
  projectName: string;
  status: Extract<ResultStatus, 'PASSED' | 'FAILED' | 'SKIPPED'>;
  flaky: boolean;
  durationMs: number;
  retries: number;
  errorMessage: string | null;
  errorStack: string | null;
  tags: string[];
  attachments: { name: string; contentType: string; path?: string | undefined }[];
}

export interface ParsedReport {
  startedAt: Date | null;
  durationMs: number;
  playwrightVersion: string | null;
  globalErrors: string[];
  interrupted: boolean;
  tests: ParsedTestResult[];
  totals: { total: number; passed: number; failed: number; skipped: number; flaky: number };
}

// eslint-disable-next-line no-control-regex -- intentionally matches ANSI escape sequences
const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (value: string | undefined) => (value ? value.replace(ANSI, '') : null);
const MAX_ERROR_LENGTH = 10_000;
const truncate = (value: string | null) => (value && value.length > MAX_ERROR_LENGTH ? value.slice(0, MAX_ERROR_LENGTH) : value);

/** Explicit link to a managed test case: `test('...', { annotation: { type: 'qtm', description: 'KEY' } })`. */
function annotationKey(test: z.infer<typeof testSchema>): string | null {
  const all = [...test.annotations, ...test.results.flatMap((r) => r.annotations)];
  const found = all.find((a) => a.type === 'qtm' && a.description?.trim());
  return found?.description?.trim() ?? null;
}

function mapStatus(test: z.infer<typeof testSchema>): ParsedTestResult['status'] {
  switch (test.status) {
    case 'expected':
      return test.expectedStatus === 'skipped' ? 'SKIPPED' : 'PASSED';
    case 'flaky':
      return 'PASSED';
    case 'unexpected':
      return 'FAILED';
    case 'skipped':
      return 'SKIPPED';
  }
}

export function parsePlaywrightReport(report: PlaywrightReport): ParsedReport {
  const tests: ParsedTestResult[] = [];
  let interrupted = false;

  const walk = (suite: ReportSuite, titlePath: string[]) => {
    for (const spec of suite.specs) {
      const path = [...titlePath, spec.title];
      for (const test of spec.tests) {
        const last = test.results.at(-1);
        if (test.results.some((r) => r.status === 'interrupted')) interrupted = true;
        const failing = [...test.results].reverse().find((r) => r.error || r.errors.length > 0);
        const error = failing?.error ?? failing?.errors[0];
        const fullTitle = path.join(' > ');
        tests.push({
          title: (test.projectName ? `[${test.projectName}] ${fullTitle}` : fullTitle).slice(0, 1000),
          automationKey: annotationKey(test) ?? `${spec.file} > ${fullTitle}`,
          file: spec.file,
          projectName: test.projectName,
          status: mapStatus(test),
          flaky: test.status === 'flaky',
          durationMs: Math.round(test.results.reduce((sum, r) => sum + r.duration, 0)),
          retries: last ? last.retry : 0,
          errorMessage: test.status === 'unexpected' || test.status === 'flaky' ? truncate(stripAnsi(error?.message)) : null,
          errorStack: test.status === 'unexpected' || test.status === 'flaky' ? truncate(stripAnsi(error?.stack)) : null,
          tags: spec.tags,
          attachments: test.results.flatMap((r) =>
            r.attachments.map((a) => ({ name: a.name, contentType: a.contentType, path: a.path })),
          ),
        });
      }
    }
    // Top-level suites represent files; nested suites are describe() blocks.
    for (const child of suite.suites ?? []) walk(child, [...titlePath, child.title]);
  };
  for (const fileSuite of report.suites) walk(fileSuite, []);

  const started = new Date(report.stats.startTime);
  return {
    startedAt: Number.isNaN(started.getTime()) ? null : started,
    durationMs: Math.round(report.stats.duration),
    playwrightVersion: report.config?.version ?? null,
    globalErrors: report.errors.map((e) => stripAnsi(e.message) ?? 'Unknown error').slice(0, 20),
    interrupted,
    tests,
    totals: {
      total: tests.length,
      passed: tests.filter((t) => t.status === 'PASSED').length,
      failed: tests.filter((t) => t.status === 'FAILED').length,
      skipped: tests.filter((t) => t.status === 'SKIPPED').length,
      flaky: tests.filter((t) => t.flaky).length,
    },
  };
}

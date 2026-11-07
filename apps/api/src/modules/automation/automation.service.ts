import type { Prisma } from '@prisma/client';
import { MAX_PLAYWRIGHT_REPORT_BYTES } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../services/audit.js';
import { sha256 } from '../../utils/crypto.js';
import { AppError, badRequest, conflict } from '../../utils/errors.js';
import { parsePlaywrightReport, playwrightReportSchema } from './playwright-report.js';

export interface ImportRequest {
  projectId: string;
  organizationId: string;
  userId: string;
  /** "upload" (web UI, session) or "api-token:<prefix>" (CI). */
  source: string;
  runName?: string | undefined;
  environment?: string | undefined;
  raw: Buffer | string;
}

export async function importPlaywrightReport(ctx: AppContext, request: ImportRequest) {
  const size = Buffer.byteLength(request.raw);
  if (size === 0) throw badRequest('Report is empty');
  if (size > MAX_PLAYWRIGHT_REPORT_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Report exceeds 20 MB');

  let json: unknown;
  try {
    json = JSON.parse(request.raw.toString());
  } catch {
    throw badRequest('Report is not valid JSON');
  }
  const validated = playwrightReportSchema.safeParse(json);
  if (!validated.success) {
    throw new AppError(
      422,
      'INVALID_REPORT',
      'File is not a Playwright JSON report (expected output of --reporter=json)',
      validated.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const report = parsePlaywrightReport(validated.data);
  if (report.tests.length === 0 && report.globalErrors.length === 0) {
    throw badRequest('Report contains no tests');
  }

  // Identity of a report: its start time plus the test content. Re-uploading the same file is rejected.
  const reportHash = sha256(JSON.stringify([validated.data.stats.startTime, validated.data.suites]));
  const duplicate = await ctx.prisma.automationExecution.findUnique({
    where: { projectId_reportHash: { projectId: request.projectId, reportHash } },
    select: { id: true, testRunId: true },
  });
  if (duplicate) throw conflict('This report has already been imported', duplicate);

  const keys = [...new Set(report.tests.map((t) => t.automationKey))];
  const cases = await ctx.prisma.testCase.findMany({
    where: { projectId: request.projectId, deletedAt: null, automationKey: { in: keys } },
    select: { id: true, automationKey: true },
  });
  const caseByKey = new Map(cases.flatMap((c) => (c.automationKey ? [[c.automationKey, c.id] as const] : [])));

  const startedAt = report.startedAt ?? new Date();
  const finishedAt = new Date(startedAt.getTime() + report.durationMs);
  const status = report.interrupted ? 'INTERRUPTED' : report.totals.failed > 0 || report.globalErrors.length > 0 ? 'FAILED' : 'PASSED';
  const matched = report.tests.filter((t) => caseByKey.has(t.automationKey)).length;

  const execution = await ctx.prisma.$transaction(async (tx) => {
    const run = await tx.testRun.create({
      data: {
        projectId: request.projectId,
        name: request.runName?.trim() || `Playwright run ${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        environment: request.environment?.trim() ?? '',
        source: 'PLAYWRIGHT',
        status: report.interrupted ? 'ABORTED' : 'COMPLETED',
        startedAt,
        finishedAt,
        executedById: request.userId,
      },
    });
    await tx.testResult.createMany({
      data: report.tests.map((t) => ({
        testRunId: run.id,
        testCaseId: caseByKey.get(t.automationKey) ?? null,
        title: t.title,
        status: t.status,
        durationMs: t.durationMs,
        retries: t.retries,
        errorMessage: t.errorMessage,
        errorStack: t.errorStack,
        automationKey: t.automationKey,
        executedAt: finishedAt,
        metadata: {
          file: t.file,
          projectName: t.projectName,
          flaky: t.flaky,
          tags: t.tags,
          attachments: t.attachments,
        } as Prisma.InputJsonValue,
      })),
    });
    const created = await tx.automationExecution.create({
      data: {
        projectId: request.projectId,
        testRunId: run.id,
        executionSource: request.source,
        status,
        totalTests: report.totals.total,
        passed: report.totals.passed,
        failed: report.totals.failed,
        skipped: report.totals.skipped,
        flaky: report.totals.flaky,
        matched,
        durationMs: report.durationMs,
        reportHash,
        startedAt: report.startedAt,
        reportMetadata: {
          playwrightVersion: report.playwrightVersion,
          globalErrors: report.globalErrors,
          stats: validated.data.stats,
        } as Prisma.InputJsonValue,
      },
    });
    await audit(tx, {
      organizationId: request.organizationId,
      userId: request.userId,
      action: 'automation.imported',
      entityType: 'automation_execution',
      entityId: created.id,
      metadata: { projectId: request.projectId, source: request.source, total: report.totals.total, status },
    });
    return created;
  });
  return execution;
}

import { Router } from 'express';
import { z } from 'zod';
import { RUN_SOURCES, paginationSchema, testResultUpdateSchema, testRunCreateSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { badRequest, conflict, notFound, parse } from '../../utils/errors.js';
import { paginate, userSummary, uuidParam } from '../../utils/guards.js';
import { projectAudit } from '../projects/project-audit.js';
import { emptyCounts, passRate, runSummaries } from './run-summary.js';
import { projectOf, userOf } from '../../utils/request-context.js';

const listQuery = paginationSchema.extend({ source: z.enum(RUN_SOURCES).optional() });

export function testRunsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const write = [requirePermission('test:write'), requireActiveProject];

  const findRun = async (projectId: string, runId: unknown) => {
    const run = await ctx.prisma.testRun.findFirst({ where: { id: uuidParam(runId, 'Test run'), projectId } });
    if (!run) throw notFound('Test run');
    return run;
  };

  router.get('/', async (req, res) => {
    const { page, pageSize, source } = parse(listQuery, req.query);
    const where = { projectId: projectOf(req).id, ...(source ? { source } : {}) };
    const [runs, total] = await Promise.all([
      ctx.prisma.testRun.findMany({
        where,
        include: { executedBy: userSummary, testPlan: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        ...paginate(page, pageSize),
      }),
      ctx.prisma.testRun.count({ where }),
    ]);
    const summaries = await runSummaries(ctx.prisma, runs.map((r) => r.id));
    res.json({
      items: runs.map((r) => {
        const summary = summaries.get(r.id) ?? emptyCounts();
        return { ...r, summary, passRate: passRate(summary) };
      }),
      total,
      page,
      pageSize,
    });
  });

  router.post('/', ...write, async (req, res) => {
    const input = parse(testRunCreateSchema, req.body);
    const plan = await ctx.prisma.testPlan.findFirst({
      where: { id: input.testPlanId, projectId: projectOf(req).id },
      include: { cases: { include: { testCase: { select: { id: true, title: true, deletedAt: true } } } } },
    });
    if (!plan) throw badRequest('Test plan does not belong to this project');
    if (plan.status === 'ARCHIVED') throw conflict('Archived plans cannot be executed');
    const cases = plan.cases.map((c) => c.testCase).filter((c) => c.deletedAt === null);
    if (cases.length === 0) throw badRequest('Test plan has no test cases to execute');

    const run = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.testRun.create({
        data: {
          projectId: projectOf(req).id,
          testPlanId: plan.id,
          name: input.name,
          environment: input.environment || plan.environment,
          executedById: userOf(req).id,
          results: { create: cases.map((c) => ({ testCaseId: c.id, title: c.title })) },
        },
      });
      if (plan.status === 'DRAFT') await tx.testPlan.update({ where: { id: plan.id }, data: { status: 'ACTIVE' } });
      return created;
    });
    await projectAudit(ctx, req, 'test_run.started', 'test_run', run.id, { name: run.name, planId: plan.id });
    res.status(201).json(run);
  });

  router.get('/:runId', async (req, res) => {
    const run = await findRun(projectOf(req).id, req.params.runId);
    const [details, results] = await Promise.all([
      ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { executedBy: userSummary, testPlan: { select: { id: true, name: true } }, automation: true },
      }),
      ctx.prisma.testResult.findMany({
        where: { testRunId: run.id },
        include: {
          executedBy: userSummary,
          testCase: {
            select: {
              id: true,
              title: true,
              priority: true,
              preconditions: true,
              expectedResult: true,
              steps: { orderBy: { position: 'asc' } },
            },
          },
          _count: { select: { bugs: true } },
        },
        orderBy: { title: 'asc' },
      }),
    ]);
    const summary = (await runSummaries(ctx.prisma, [run.id])).get(run.id) ?? emptyCounts();
    res.json({ ...details, results, summary, passRate: passRate(summary) });
  });

  router.patch('/:runId/results/:resultId', ...write, async (req, res) => {
    const run = await findRun(projectOf(req).id, req.params.runId);
    if (run.source !== 'MANUAL') throw conflict('Automated results are imported and cannot be edited');
    const resultId = uuidParam(req.params.resultId, 'Result');
    const input = parse(testResultUpdateSchema, req.body);
    const executed = input.status !== 'NOT_RUN';
    const updated = await ctx.prisma.$transaction(async (tx) => {
      // Lock the run row so completion/abort cannot interleave with a result write.
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM test_runs WHERE id = ${run.id}::uuid FOR UPDATE`;
      if (locked?.status !== 'IN_PROGRESS') throw conflict('Run is closed; results can no longer change');
      const existing = await tx.testResult.findFirst({ where: { id: resultId, testRunId: run.id } });
      if (!existing) throw notFound('Result');
      return tx.testResult.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          actualResult: input.actualResult,
          notes: input.notes,
          durationMs: input.durationSeconds == null ? null : input.durationSeconds * 1000,
          executedById: executed ? userOf(req).id : null,
          executedAt: executed ? new Date() : null,
        },
        include: { executedBy: userSummary },
      });
    });
    await projectAudit(ctx, req, 'test_result.recorded', 'test_result', updated.id, {
      runId: run.id,
      status: updated.status,
    });
    res.json(updated);
  });

  for (const [path, status] of [
    ['/:runId/complete', 'COMPLETED'],
    ['/:runId/abort', 'ABORTED'],
  ] as const) {
    router.post(path, ...write, async (req, res) => {
      const run = await findRun(projectOf(req).id, req.params.runId);
      // Conditional update: only one concurrent close can win.
      const { count } = await ctx.prisma.testRun.updateMany({
        where: { id: run.id, status: 'IN_PROGRESS' },
        data: { status, finishedAt: new Date() },
      });
      if (count !== 1) throw conflict('Run is already closed');
      const updated = await ctx.prisma.testRun.findUniqueOrThrow({ where: { id: run.id } });
      await projectAudit(ctx, req, `test_run.${status.toLowerCase()}`, 'test_run', run.id);
      res.json(updated);
    });
  }

  return router;
}

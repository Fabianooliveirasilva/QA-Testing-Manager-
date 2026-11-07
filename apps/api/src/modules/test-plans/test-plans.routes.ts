import { Router } from 'express';
import { testPlanCreateSchema, testPlanUpdateSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { badRequest, conflict, notFound, parse } from '../../utils/errors.js';
import { userSummary, uuidParam } from '../../utils/guards.js';
import { projectAudit } from '../projects/project-audit.js';
import { emptyCounts, runSummaries } from '../test-runs/run-summary.js';
import { projectOf } from '../../utils/request-context.js';

export function testPlansRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const write = [requirePermission('test:write'), requireActiveProject];

  /** Expands selected suites into their active test cases and validates explicit case ids belong to the project. */
  const resolveCaseIds = async (projectId: string, suiteIds: string[], testCaseIds: string[]) => {
    if (suiteIds.length > 0) {
      const suites = await ctx.prisma.testSuite.count({ where: { id: { in: suiteIds }, projectId } });
      if (suites !== new Set(suiteIds).size) throw badRequest('One or more suites do not belong to this project');
    }
    const cases = await ctx.prisma.testCase.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: { not: 'DEPRECATED' },
        OR: [{ suiteId: { in: suiteIds } }, { id: { in: testCaseIds } }],
      },
      select: { id: true },
    });
    const found = new Set(cases.map((c) => c.id));
    if (testCaseIds.some((id) => !found.has(id))) {
      throw badRequest('One or more test cases do not exist, are deprecated or belong to another project');
    }
    return [...found];
  };

  const findPlan = async (projectId: string, planId: unknown) => {
    const plan = await ctx.prisma.testPlan.findFirst({ where: { id: uuidParam(planId, 'Test plan'), projectId } });
    if (!plan) throw notFound('Test plan');
    return plan;
  };

  router.get('/', async (req, res) => {
    const plans = await ctx.prisma.testPlan.findMany({
      where: { projectId: projectOf(req).id },
      include: { _count: { select: { cases: true, runs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ items: plans });
  });

  router.post('/', ...write, async (req, res) => {
    const { suiteIds, testCaseIds, ...data } = parse(testPlanCreateSchema, req.body);
    const caseIds = await resolveCaseIds(projectOf(req).id, suiteIds, testCaseIds);
    const plan = await ctx.prisma.testPlan.create({
      data: { ...data, projectId: projectOf(req).id, cases: { create: caseIds.map((testCaseId) => ({ testCaseId })) } },
      include: { _count: { select: { cases: true } } },
    });
    await projectAudit(ctx, req, 'test_plan.created', 'test_plan', plan.id, { name: plan.name });
    res.status(201).json(plan);
  });

  router.get('/:planId', async (req, res) => {
    const plan = await findPlan(projectOf(req).id, req.params.planId);
    const [cases, runs] = await Promise.all([
      ctx.prisma.testPlanCase.findMany({
        where: { testPlanId: plan.id },
        include: {
          testCase: {
            select: {
              id: true,
              title: true,
              priority: true,
              type: true,
              status: true,
              deletedAt: true,
              suite: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { testCase: { title: 'asc' } },
      }),
      ctx.prisma.testRun.findMany({
        where: { testPlanId: plan.id },
        include: { executedBy: userSummary },
        orderBy: { startedAt: 'desc' },
      }),
    ]);
    const summaries = await runSummaries(ctx.prisma, runs.map((r) => r.id));
    res.json({
      ...plan,
      cases: cases.map((c) => c.testCase),
      runs: runs.map((r) => ({ ...r, summary: summaries.get(r.id) ?? emptyCounts() })),
    });
  });

  router.patch('/:planId', ...write, async (req, res) => {
    const plan = await findPlan(projectOf(req).id, req.params.planId);
    const { suiteIds, testCaseIds, ...data } = parse(testPlanUpdateSchema, req.body);
    const replaceCases = suiteIds !== undefined || testCaseIds !== undefined;
    const caseIds = replaceCases ? await resolveCaseIds(projectOf(req).id, suiteIds ?? [], testCaseIds ?? []) : [];
    const updated = await ctx.prisma.$transaction(async (tx) => {
      if (replaceCases) {
        await tx.testPlanCase.deleteMany({ where: { testPlanId: plan.id } });
        await tx.testPlanCase.createMany({ data: caseIds.map((testCaseId) => ({ testPlanId: plan.id, testCaseId })) });
      }
      return tx.testPlan.update({
        where: { id: plan.id },
        data,
        include: { _count: { select: { cases: true, runs: true } } },
      });
    });
    await projectAudit(ctx, req, 'test_plan.updated', 'test_plan', plan.id);
    res.json(updated);
  });

  router.delete('/:planId', ...write, async (req, res) => {
    const plan = await findPlan(projectOf(req).id, req.params.planId);
    const runs = await ctx.prisma.testRun.count({ where: { testPlanId: plan.id } });
    if (runs > 0) throw conflict('Plan has execution history; archive it instead of deleting');
    await ctx.prisma.testPlan.delete({ where: { id: plan.id } });
    await projectAudit(ctx, req, 'test_plan.deleted', 'test_plan', plan.id, { name: plan.name });
    res.status(204).end();
  });

  return router;
}

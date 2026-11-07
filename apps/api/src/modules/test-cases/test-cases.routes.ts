import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { testCaseCreateSchema, testCaseListQuerySchema, testCaseUpdateSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, parse } from '../../utils/errors.js';
import { assertOrgMember, paginate, userSummary, uuidParam } from '../../utils/guards.js';
import { projectAudit } from '../projects/project-audit.js';
import { projectOf, userOf } from '../../utils/request-context.js';

const detailInclude = {
  suite: { select: { id: true, name: true } },
  assignee: userSummary,
  createdBy: userSummary,
  steps: { orderBy: { position: 'asc' } },
} satisfies Prisma.TestCaseInclude;

export function testCasesRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const write = [requirePermission('test:write'), requireActiveProject];

  const assertSuite = async (projectId: string, suiteId: string) => {
    const suite = await ctx.prisma.testSuite.findFirst({ where: { id: suiteId, projectId }, select: { id: true } });
    if (!suite) throw badRequest('Suite does not belong to this project');
  };

  const findCase = async (projectId: string, caseId: unknown) => {
    const testCase = await ctx.prisma.testCase.findFirst({
      where: { id: uuidParam(caseId, 'Test case'), projectId, deletedAt: null },
      include: detailInclude,
    });
    if (!testCase) throw notFound('Test case');
    return testCase;
  };

  router.get('/', async (req, res) => {
    const query = parse(testCaseListQuerySchema, req.query);
    const where: Prisma.TestCaseWhereInput = {
      projectId: projectOf(req).id,
      deletedAt: null,
      ...(query.suiteId ? { suiteId: query.suiteId } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      ctx.prisma.testCase.findMany({
        where,
        include: { suite: { select: { id: true, name: true } }, assignee: userSummary, _count: { select: { steps: true } } },
        orderBy: [{ [query.sort]: query.order }, { id: 'asc' }],
        ...paginate(query.page, query.pageSize),
      }),
      ctx.prisma.testCase.count({ where }),
    ]);
    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  });

  router.post('/', ...write, async (req, res) => {
    const input = parse(testCaseCreateSchema, req.body);
    await assertSuite(projectOf(req).id, input.suiteId);
    await assertOrgMember(ctx, projectOf(req).organizationId, input.assigneeId);
    const { steps, ...data } = input;
    const created = await ctx.prisma.testCase.create({
      data: {
        ...data,
        tags: [...new Set(data.tags)],
        automationKey: data.automationKey || null,
        assigneeId: data.assigneeId ?? null,
        projectId: projectOf(req).id,
        createdById: userOf(req).id,
        steps: { create: steps.map((s, i) => ({ ...s, position: i + 1 })) },
      },
      include: detailInclude,
    });
    await projectAudit(ctx, req, 'test_case.created', 'test_case', created.id, {
      title: created.title,
      aiGenerated: created.aiGenerated,
    });
    res.status(201).json(created);
  });

  router.get('/:caseId', async (req, res) => {
    const testCase = await findCase(projectOf(req).id, req.params.caseId);
    const recentResults = await ctx.prisma.testResult.findMany({
      where: { testCaseId: testCase.id, status: { not: 'NOT_RUN' } },
      orderBy: { executedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        executedAt: true,
        testRun: { select: { id: true, name: true, source: true } },
        executedBy: userSummary,
      },
    });
    res.json({ ...testCase, recentResults });
  });

  router.patch('/:caseId', ...write, async (req, res) => {
    const existing = await findCase(projectOf(req).id, req.params.caseId);
    const input = parse(testCaseUpdateSchema, req.body);
    if (input.suiteId) await assertSuite(projectOf(req).id, input.suiteId);
    await assertOrgMember(ctx, projectOf(req).organizationId, input.assigneeId);
    const { steps, ...data } = input;
    const updated = await ctx.prisma.$transaction(async (tx) => {
      if (steps) {
        await tx.testStep.deleteMany({ where: { testCaseId: existing.id } });
        await tx.testStep.createMany({
          data: steps.map((s, i) => ({ ...s, position: i + 1, testCaseId: existing.id })),
        });
      }
      return tx.testCase.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(data.tags ? { tags: [...new Set(data.tags)] } : {}),
          ...(data.automationKey !== undefined ? { automationKey: data.automationKey || null } : {}),
        },
        include: detailInclude,
      });
    });
    await projectAudit(ctx, req, 'test_case.updated', 'test_case', updated.id, { fields: Object.keys(input) });
    res.json(updated);
  });

  router.post('/:caseId/duplicate', ...write, async (req, res) => {
    const source = await findCase(projectOf(req).id, req.params.caseId);
    const copy = await ctx.prisma.testCase.create({
      data: {
        projectId: source.projectId,
        suiteId: source.suiteId,
        title: `${source.title} (copy)`.slice(0, 250),
        description: source.description,
        preconditions: source.preconditions,
        priority: source.priority,
        type: source.type,
        status: 'DRAFT',
        environment: source.environment,
        expectedResult: source.expectedResult,
        tags: source.tags,
        assigneeId: source.assigneeId,
        createdById: userOf(req).id,
        // automationKey is unique per project, so the copy starts without one.
        steps: {
          create: source.steps.map((s) => ({
            position: s.position,
            action: s.action,
            expectedResult: s.expectedResult,
          })),
        },
      },
      include: detailInclude,
    });
    await projectAudit(ctx, req, 'test_case.duplicated', 'test_case', copy.id, { sourceId: source.id });
    res.status(201).json(copy);
  });

  // Soft delete keeps execution history and bug links intact.
  router.delete('/:caseId', ...write, async (req, res) => {
    const testCase = await findCase(projectOf(req).id, req.params.caseId);
    await ctx.prisma.$transaction([
      ctx.prisma.testCase.update({
        where: { id: testCase.id },
        data: { deletedAt: new Date(), automationKey: null },
      }),
      ctx.prisma.testPlanCase.deleteMany({
        where: { testCaseId: testCase.id, testPlan: { status: { in: ['DRAFT', 'ACTIVE'] } } },
      }),
    ]);
    await projectAudit(ctx, req, 'test_case.deleted', 'test_case', testCase.id, { title: testCase.title });
    res.status(204).end();
  });

  return router;
}

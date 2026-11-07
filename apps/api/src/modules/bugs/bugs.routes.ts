import type { Bug, Prisma } from '@prisma/client';
import { Router } from 'express';
import { bugCreateSchema, bugListQuerySchema, bugUpdateSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { badRequest, notFound, parse } from '../../utils/errors.js';
import { assertOrgMember, paginate, userSummary, uuidParam } from '../../utils/guards.js';
import { projectAudit } from '../projects/project-audit.js';
import { projectOf, userOf } from '../../utils/request-context.js';

const TRACKED_FIELDS = [
  'title',
  'description',
  'stepsToReproduce',
  'expectedResult',
  'actualResult',
  'severity',
  'priority',
  'status',
  'environment',
  'browser',
  'version',
  'assigneeId',
  'testCaseId',
  'testResultId',
] as const satisfies readonly (keyof Bug)[];

export function bugsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const write = [requirePermission('test:write'), requireActiveProject];

  /** Linked test cases/results must belong to the same project (prevents cross-tenant references). */
  const assertLinks = async (projectId: string, testCaseId?: string | null, testResultId?: string | null) => {
    if (testCaseId) {
      const tc = await ctx.prisma.testCase.findFirst({ where: { id: testCaseId, projectId }, select: { id: true } });
      if (!tc) throw badRequest('Linked test case does not belong to this project');
    }
    if (testResultId) {
      const tr = await ctx.prisma.testResult.findFirst({
        where: { id: testResultId, testRun: { projectId } },
        select: { id: true },
      });
      if (!tr) throw badRequest('Linked test result does not belong to this project');
    }
  };

  const findBug = async (projectId: string, bugId: unknown) => {
    const bug = await ctx.prisma.bug.findFirst({ where: { id: uuidParam(bugId, 'Bug'), projectId } });
    if (!bug) throw notFound('Bug');
    return bug;
  };

  router.get('/', async (req, res) => {
    const query = parse(bugListQuerySchema, req.query);
    const where: Prisma.BugWhereInput = {
      projectId: projectOf(req).id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      ctx.prisma.bug.findMany({
        where,
        include: { assignee: userSummary, createdBy: userSummary },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        ...paginate(query.page, query.pageSize),
      }),
      ctx.prisma.bug.count({ where }),
    ]);
    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  });

  router.post('/', ...write, async (req, res) => {
    const input = parse(bugCreateSchema, req.body);
    await assertOrgMember(ctx, projectOf(req).organizationId, input.assigneeId);
    await assertLinks(projectOf(req).id, input.testCaseId, input.testResultId);
    const bug = await ctx.prisma.bug.create({
      data: {
        ...input,
        assigneeId: input.assigneeId ?? null,
        testCaseId: input.testCaseId ?? null,
        testResultId: input.testResultId ?? null,
        projectId: projectOf(req).id,
        createdById: userOf(req).id,
        history: { create: { userId: userOf(req).id, field: 'created', toValue: 'OPEN' } },
      },
    });
    await projectAudit(ctx, req, 'bug.created', 'bug', bug.id, { title: bug.title, severity: bug.severity });
    res.status(201).json(bug);
  });

  router.get('/:bugId', async (req, res) => {
    const bug = await findBug(projectOf(req).id, req.params.bugId);
    const details = await ctx.prisma.bug.findUniqueOrThrow({
      where: { id: bug.id },
      include: {
        assignee: userSummary,
        createdBy: userSummary,
        testCase: { select: { id: true, title: true, deletedAt: true } },
        testResult: { select: { id: true, title: true, status: true, testRunId: true } },
        history: { include: { user: userSummary }, orderBy: { createdAt: 'desc' } },
      },
    });
    res.json(details);
  });

  router.patch('/:bugId', ...write, async (req, res) => {
    const bug = await findBug(projectOf(req).id, req.params.bugId);
    const input = parse(bugUpdateSchema, req.body);
    await assertOrgMember(ctx, projectOf(req).organizationId, input.assigneeId);
    await assertLinks(projectOf(req).id, input.testCaseId, input.testResultId);

    const changes = TRACKED_FIELDS.filter(
      (field) => input[field] !== undefined && (input[field] ?? null) !== (bug[field] ?? null),
    ).map((field) => ({
      userId: userOf(req).id,
      field,
      fromValue: bug[field] == null ? null : String(bug[field]),
      toValue: input[field] == null ? null : String(input[field]),
    }));

    const updated = await ctx.prisma.bug.update({
      where: { id: bug.id },
      data: { ...input, history: { create: changes } },
    });
    if (changes.length > 0) {
      await projectAudit(ctx, req, 'bug.updated', 'bug', bug.id, { fields: changes.map((c) => c.field) });
    }
    res.json(updated);
  });

  router.delete('/:bugId', requirePermission('bug:delete'), requireActiveProject, async (req, res) => {
    const bug = await findBug(projectOf(req).id, req.params.bugId);
    const attachments = await ctx.prisma.attachment.findMany({
      where: { projectId: projectOf(req).id, entityType: 'BUG', entityId: bug.id },
      select: { id: true, storageKey: true },
    });
    await ctx.prisma.$transaction([
      ctx.prisma.attachment.deleteMany({ where: { id: { in: attachments.map((a) => a.id) } } }),
      ctx.prisma.bug.delete({ where: { id: bug.id } }),
    ]);
    await Promise.all(attachments.map((a) => ctx.storage.delete(a.storageKey)));
    await projectAudit(ctx, req, 'bug.deleted', 'bug', bug.id, { title: bug.title });
    res.status(204).end();
  });

  return router;
}

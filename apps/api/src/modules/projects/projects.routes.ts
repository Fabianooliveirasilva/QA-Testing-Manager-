import { Router } from 'express';
import { z } from 'zod';
import { projectMemberAddSchema, projectUpdateSchema, suiteCreateSchema, suiteUpdateSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { conflict, notFound, parse } from '../../utils/errors.js';
import { assertOrgMember, userSummary, uuidParam } from '../../utils/guards.js';
import { dashboardMetrics } from '../organizations/dashboard.service.js';
import { projectAudit } from './project-audit.js';
import { membershipOf, projectOf, userOf } from '../../utils/request-context.js';

const tokenCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const API_TOKEN_PREFIX = 'qtm_';

export function projectRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const manage = requirePermission('project:manage');
  const write = requirePermission('test:write');

  router.get('/', async (req, res) => {
    const project = await ctx.prisma.project.findUniqueOrThrow({
      where: { id: projectOf(req).id },
      include: {
        lead: userSummary,
        _count: { select: { testCases: { where: { deletedAt: null } }, bugs: true, testRuns: true, testPlans: true } },
      },
    });
    res.json({ ...project, role: membershipOf(req).role });
  });

  router.patch('/', manage, requireActiveProject, async (req, res) => {
    const input = parse(projectUpdateSchema, req.body);
    await assertOrgMember(ctx, projectOf(req).organizationId, input.leadId);
    const updated = await ctx.prisma.project.update({ where: { id: projectOf(req).id }, data: input });
    await projectAudit(ctx, req, 'project.updated', 'project', updated.id, { fields: Object.keys(input) });
    res.json(updated);
  });

  for (const [path, status] of [
    ['/archive', 'ARCHIVED'],
    ['/unarchive', 'ACTIVE'],
  ] as const) {
    router.post(path, manage, async (req, res) => {
      const updated = await ctx.prisma.project.update({ where: { id: projectOf(req).id }, data: { status } });
      await projectAudit(ctx, req, `project.${status === 'ARCHIVED' ? 'archived' : 'unarchived'}`, 'project', updated.id);
      res.json(updated);
    });
  }

  router.get('/metrics', async (req, res) => {
    res.json(await dashboardMetrics(ctx.prisma, projectOf(req).organizationId, projectOf(req).id));
  });

  // ---- Project members (team roster; access itself is governed by organization role) ----
  router.get('/members', async (req, res) => {
    const members = await ctx.prisma.projectMember.findMany({
      where: { projectId: projectOf(req).id },
      include: { user: userSummary },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: members });
  });

  router.post('/members', manage, requireActiveProject, async (req, res) => {
    const { userId } = parse(projectMemberAddSchema, req.body);
    await assertOrgMember(ctx, projectOf(req).organizationId, userId);
    const exists = await ctx.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: projectOf(req).id, userId } },
    });
    if (exists) throw conflict('User is already a project member');
    const member = await ctx.prisma.projectMember.create({
      data: { projectId: projectOf(req).id, userId },
      include: { user: userSummary },
    });
    await projectAudit(ctx, req, 'project.member_added', 'project', projectOf(req).id, { userId });
    res.status(201).json(member);
  });

  router.delete('/members/:userId', manage, requireActiveProject, async (req, res) => {
    const userId = uuidParam(req.params.userId, 'Member');
    const { count } = await ctx.prisma.projectMember.deleteMany({ where: { projectId: projectOf(req).id, userId } });
    if (count === 0) throw notFound('Member');
    await projectAudit(ctx, req, 'project.member_removed', 'project', projectOf(req).id, { userId });
    res.status(204).end();
  });

  // ---- Suites ----
  router.get('/suites', async (req, res) => {
    const suites = await ctx.prisma.testSuite.findMany({
      where: { projectId: projectOf(req).id },
      include: { _count: { select: { testCases: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
    });
    res.json({ items: suites });
  });

  router.post('/suites', write, requireActiveProject, async (req, res) => {
    const input = parse(suiteCreateSchema, req.body);
    const suite = await ctx.prisma.testSuite.create({ data: { ...input, projectId: projectOf(req).id } });
    await projectAudit(ctx, req, 'suite.created', 'suite', suite.id, { name: suite.name });
    res.status(201).json(suite);
  });

  const findSuite = async (projectId: string, suiteId: unknown) => {
    const suite = await ctx.prisma.testSuite.findFirst({ where: { id: uuidParam(suiteId, 'Suite'), projectId } });
    if (!suite) throw notFound('Suite');
    return suite;
  };

  router.patch('/suites/:suiteId', write, requireActiveProject, async (req, res) => {
    const suite = await findSuite(projectOf(req).id, req.params.suiteId);
    const input = parse(suiteUpdateSchema, req.body);
    const updated = await ctx.prisma.testSuite.update({ where: { id: suite.id }, data: input });
    await projectAudit(ctx, req, 'suite.updated', 'suite', suite.id);
    res.json(updated);
  });

  router.delete('/suites/:suiteId', manage, requireActiveProject, async (req, res) => {
    const suite = await findSuite(projectOf(req).id, req.params.suiteId);
    const active = await ctx.prisma.testCase.count({ where: { suiteId: suite.id, deletedAt: null } });
    if (active > 0) throw conflict('Suite still contains test cases; move or delete them first');
    const deleted = await ctx.prisma.testCase.count({ where: { suiteId: suite.id } });
    if (deleted > 0) throw conflict('Suite has deleted test cases kept for execution history and cannot be removed');
    await ctx.prisma.testSuite.delete({ where: { id: suite.id } });
    await projectAudit(ctx, req, 'suite.deleted', 'suite', suite.id, { name: suite.name });
    res.status(204).end();
  });

  // ---- API tokens (CI uploads) ----
  router.get('/tokens', manage, async (req, res) => {
    const tokens = await ctx.prisma.apiToken.findMany({
      where: { projectId: projectOf(req).id },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true, createdBy: userSummary },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items: tokens });
  });

  router.post('/tokens', manage, requireActiveProject, async (req, res) => {
    const { name } = parse(tokenCreateSchema, req.body);
    const secret = `${API_TOKEN_PREFIX}${randomToken(32)}`;
    const token = await ctx.prisma.apiToken.create({
      data: {
        projectId: projectOf(req).id,
        name,
        prefix: secret.slice(0, 10),
        tokenHash: sha256(secret),
        createdById: userOf(req).id,
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    await projectAudit(ctx, req, 'api_token.created', 'api_token', token.id, { name });
    // The plaintext secret is returned exactly once.
    res.status(201).json({ ...token, token: secret });
  });

  router.delete('/tokens/:tokenId', manage, async (req, res) => {
    const id = uuidParam(req.params.tokenId, 'Token');
    const { count } = await ctx.prisma.apiToken.updateMany({
      where: { id, projectId: projectOf(req).id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound('Token');
    await projectAudit(ctx, req, 'api_token.revoked', 'api_token', id);
    res.status(204).end();
  });

  return router;
}

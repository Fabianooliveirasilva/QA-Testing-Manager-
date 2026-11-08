import { Router } from 'express';
import { z } from 'zod';
import {
  memberAddSchema,
  memberUpdateSchema,
  organizationCreateSchema,
  organizationSettingsSchema,
  PROJECT_STATUSES,
  paginationSchema,
  projectCreateSchema,
} from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { loadOrganization, requirePermission } from '../../middleware/access.js';
import { audit } from '../../services/audit.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../utils/errors.js';
import { assertOrgMember, paginate, userSummary } from '../../utils/guards.js';
import { uniqueSlug } from '../auth/auth.service.js';
import { dashboardMetrics } from './dashboard.service.js';
import { membershipOf, userOf } from '../../utils/request-context.js';

const projectListQuery = z.object({ status: z.enum(PROJECT_STATUSES).optional() });
const searchQuery = z.object({ q: z.string().trim().min(2).max(100) });
const dashboardQuery = z.object({ projectId: z.string().uuid().optional() });

export function organizationsRouter(ctx: AppContext): Router {
  const router = Router();
  const org = loadOrganization(ctx);

  router.get('/', async (req, res) => {
    const memberships = await ctx.prisma.organizationMember.findMany({
      where: { userId: userOf(req).id },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: memberships.map((m) => ({ ...m.organization, role: m.role })) });
  });

  router.post('/', async (req, res) => {
    const { name } = parse(organizationCreateSchema, req.body);
    const slug = await uniqueSlug(ctx, name);
    const created = await ctx.prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({
        data: { name, slug, members: { create: { userId: userOf(req).id, role: 'OWNER' } } },
      });
      await audit(tx, {
        organizationId: o.id,
        userId: userOf(req).id,
        action: 'organization.created',
        entityType: 'organization',
        entityId: o.id,
      });
      return o;
    });
    res.status(201).json({ ...created, role: 'OWNER' });
  });

  router.get('/:orgId', org, async (req, res) => {
    const o = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: membershipOf(req).organizationId } });
    res.json({ ...o, role: membershipOf(req).role });
  });

  router.patch('/:orgId', org, requirePermission('org:manage'), async (req, res) => {
    const input = parse(organizationSettingsSchema, req.body);
    const updated = await ctx.prisma.organization.update({
      where: { id: membershipOf(req).organizationId },
      data: input,
    });
    await audit(ctx.prisma, {
      organizationId: updated.id,
      userId: userOf(req).id,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: updated.id,
      metadata: input,
    });
    res.json({ ...updated, role: membershipOf(req).role });
  });

  // ---- Members ----
  router.get('/:orgId/members', org, async (req, res) => {
    const members = await ctx.prisma.organizationMember.findMany({
      where: { organizationId: membershipOf(req).organizationId },
      include: { user: userSummary },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: members });
  });

  router.post('/:orgId/members', org, requirePermission('members:manage'), async (req, res) => {
    const input = parse(memberAddSchema, req.body);
    const user = await ctx.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    // Only already-registered users can be added; no invitation e-mail flow exists yet.
    if (!user) throw notFound('User with this email');
    const organizationId = membershipOf(req).organizationId;
    const existing = await ctx.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (existing) throw conflict('User is already a member');
    const member = await ctx.prisma.organizationMember.create({
      data: { organizationId, userId: user.id, role: input.role },
      include: { user: userSummary },
    });
    await audit(ctx.prisma, {
      organizationId,
      userId: userOf(req).id,
      action: 'member.added',
      entityType: 'member',
      entityId: member.id,
      metadata: { userId: user.id, role: input.role },
    });
    res.status(201).json(member);
  });

  const loadTargetMember = async (organizationId: string, memberId: unknown) => {
    const id = z.string().uuid().safeParse(memberId);
    if (!id.success) throw notFound('Member');
    const member = await ctx.prisma.organizationMember.findFirst({ where: { id: id.data, organizationId } });
    if (!member) throw notFound('Member');
    if (member.role === 'OWNER') throw forbidden('The organization owner cannot be modified');
    return member;
  };

  router.patch('/:orgId/members/:memberId', org, requirePermission('members:manage'), async (req, res) => {
    const { role } = parse(memberUpdateSchema, req.body);
    const organizationId = membershipOf(req).organizationId;
    const target = await loadTargetMember(organizationId, req.params.memberId);
    if (target.userId === userOf(req).id) throw badRequest('You cannot change your own role');
    const updated = await ctx.prisma.organizationMember.update({
      where: { id: target.id },
      data: { role },
      include: { user: userSummary },
    });
    await audit(ctx.prisma, {
      organizationId,
      userId: userOf(req).id,
      action: 'member.role_changed',
      entityType: 'member',
      entityId: target.id,
      metadata: { from: target.role, to: role },
    });
    res.json(updated);
  });

  router.delete('/:orgId/members/:memberId', org, requirePermission('members:manage'), async (req, res) => {
    const organizationId = membershipOf(req).organizationId;
    const target = await loadTargetMember(organizationId, req.params.memberId);
    // A departing member must not stay referenced as lead/assignee or keep working CI tokens.
    const inOrg = { project: { organizationId } };
    const [, , leads, cases, bugs, tokens] = await ctx.prisma.$transaction([
      ctx.prisma.projectMember.deleteMany({ where: { userId: target.userId, ...inOrg } }),
      ctx.prisma.organizationMember.delete({ where: { id: target.id } }),
      ctx.prisma.project.updateMany({ where: { organizationId, leadId: target.userId }, data: { leadId: null } }),
      ctx.prisma.testCase.updateMany({ where: { assigneeId: target.userId, ...inOrg }, data: { assigneeId: null } }),
      ctx.prisma.bug.updateMany({ where: { assigneeId: target.userId, ...inOrg }, data: { assigneeId: null } }),
      ctx.prisma.apiToken.updateMany({
        where: { createdById: target.userId, revokedAt: null, ...inOrg },
        data: { revokedAt: new Date() },
      }),
    ]);
    await audit(ctx.prisma, {
      organizationId,
      userId: userOf(req).id,
      action: 'member.removed',
      entityType: 'member',
      entityId: target.id,
      metadata: {
        userId: target.userId,
        projectsUnled: leads.count,
        testCasesUnassigned: cases.count,
        bugsUnassigned: bugs.count,
        tokensRevoked: tokens.count,
      },
    });
    res.status(204).end();
  });

  // ---- Projects ----
  router.get('/:orgId/projects', org, async (req, res) => {
    const { status } = parse(projectListQuery, req.query);
    const projects = await ctx.prisma.project.findMany({
      where: { organizationId: membershipOf(req).organizationId, ...(status ? { status } : {}) },
      include: {
        lead: userSummary,
        _count: { select: { testCases: { where: { deletedAt: null } }, bugs: true, testRuns: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    res.json({ items: projects });
  });

  router.post('/:orgId/projects', org, requirePermission('project:manage'), async (req, res) => {
    const input = parse(projectCreateSchema, req.body);
    const organizationId = membershipOf(req).organizationId;
    await assertOrgMember(ctx, organizationId, input.leadId);
    const project = await ctx.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description,
          leadId: input.leadId ?? null,
          members: { create: { userId: userOf(req).id } },
          suites: { create: { name: 'General', description: 'Default suite' } },
        },
      });
      await audit(tx, {
        organizationId,
        userId: userOf(req).id,
        action: 'project.created',
        entityType: 'project',
        entityId: p.id,
        metadata: { name: p.name },
      });
      return p;
    });
    res.status(201).json(project);
  });

  // ---- Dashboard / audit / search ----
  router.get('/:orgId/dashboard', org, async (req, res) => {
    const { projectId } = parse(dashboardQuery, req.query);
    const organizationId = membershipOf(req).organizationId;
    if (projectId) {
      const p = await ctx.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
      if (!p) throw notFound('Project');
    }
    res.json(await dashboardMetrics(ctx.prisma, organizationId, projectId));
  });

  router.get('/:orgId/audit-logs', org, requirePermission('audit:read'), async (req, res) => {
    const { page, pageSize } = parse(paginationSchema, req.query);
    const where = { organizationId: membershipOf(req).organizationId };
    const [items, total] = await Promise.all([
      ctx.prisma.auditLog.findMany({
        where,
        include: { user: userSummary },
        orderBy: { createdAt: 'desc' },
        ...paginate(page, pageSize),
      }),
      ctx.prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  });

  router.get('/:orgId/search', org, async (req, res) => {
    const { q } = parse(searchQuery, req.query);
    const organizationId = membershipOf(req).organizationId;
    const contains = { contains: q, mode: 'insensitive' as const };
    const [projects, testCases, bugs] = await Promise.all([
      ctx.prisma.project.findMany({
        where: { organizationId, name: contains },
        select: { id: true, name: true, status: true },
        take: 5,
      }),
      ctx.prisma.testCase.findMany({
        where: { project: { organizationId }, deletedAt: null, title: contains },
        select: { id: true, title: true, projectId: true },
        take: 8,
      }),
      ctx.prisma.bug.findMany({
        where: { project: { organizationId }, title: contains },
        select: { id: true, title: true, projectId: true, status: true, severity: true },
        take: 8,
      }),
    ]);
    res.json({ projects, testCases, bugs });
  });

  return router;
}

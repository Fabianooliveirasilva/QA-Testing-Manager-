import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { forbidden, notFound, unauthorized } from '../utils/errors.js';
import { hasPermission, type Permission } from '../utils/permissions.js';

const uuid = z.string().uuid();

/**
 * Loads the caller's membership for :orgId. Non-members get 404 rather than 403
 * so organization IDs cannot be probed.
 */
export function loadOrganization(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const orgId = uuid.safeParse(req.params.orgId);
    if (!orgId.success) return next(notFound('Organization'));
    const membership = await ctx.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId.data, userId: req.user.id } },
    });
    if (!membership) return next(notFound('Organization'));
    req.membership = membership;
    next();
  };
}

/** Loads :projectId and verifies the caller belongs to the owning organization. */
export function loadProject(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const projectId = uuid.safeParse(req.params.projectId);
    if (!projectId.success) return next(notFound('Project'));
    const project = await ctx.prisma.project.findUnique({ where: { id: projectId.data } });
    if (!project) return next(notFound('Project'));
    const membership = await ctx.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: project.organizationId, userId: req.user.id } },
    });
    if (!membership) return next(notFound('Project'));
    req.project = project;
    req.membership = membership;
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.membership || !hasPermission(req.membership.role, permission)) return next(forbidden());
    next();
  };
}

/** Blocks writes to archived projects (they are read-only until unarchived). */
export const requireActiveProject: RequestHandler = (req, _res, next) => {
  if (req.project?.status === 'ARCHIVED' && !['GET', 'HEAD'].includes(req.method)) {
    return next(forbidden('Project is archived; unarchive it to make changes'));
  }
  next();
};

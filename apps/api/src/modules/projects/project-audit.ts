import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { AppContext } from '../../context.js';
import { audit } from '../../services/audit.js';
import { projectOf } from '../../utils/request-context.js';

/** Audit helper for project-scoped actions; always records projectId so activity can be filtered per project. */
export function projectAudit(
  ctx: AppContext,
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  extra: Record<string, Prisma.InputJsonValue | null> = {},
) {
  return audit(ctx.prisma, {
    organizationId: projectOf(req).organizationId,
    userId: req.user?.id ?? null,
    action,
    entityType,
    entityId,
    metadata: { projectId: projectOf(req).id, ...extra },
  });
}

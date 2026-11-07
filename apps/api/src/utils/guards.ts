import type { AppContext } from '../context.js';
import { z } from 'zod';
import { badRequest, notFound } from './errors.js';

/** Ensures a referenced user (assignee, lead, member) belongs to the organization. */
export async function assertOrgMember(ctx: AppContext, organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const member = await ctx.prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true },
  });
  if (!member) throw badRequest('Referenced user is not a member of this organization');
}

export const paginate = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });

export const userSummary = { select: { id: true, name: true, email: true } } as const;

/** Validates a route id; malformed ids are reported as 404 like unknown ones. */
export function uuidParam(value: unknown, resource: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw notFound(resource);
  return parsed.data;
}

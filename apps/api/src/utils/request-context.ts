import type { OrganizationMember, Project, Session } from '@prisma/client';
import type { Request } from 'express';
import type { SafeUser } from '../context.js';
import { AppError, unauthorized } from './errors.js';

// Accessors for values attached by middleware. A missing value means a route was mounted
// without its guard, which is a programming error and must never fall through silently.
const missing = (what: string) => new AppError(500, 'INTERNAL_ERROR', `Request context missing ${what}`);

export function userOf(req: Request): SafeUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function sessionOf(req: Request): Session {
  if (!req.session) throw unauthorized();
  return req.session;
}

export function membershipOf(req: Request): OrganizationMember {
  if (!req.membership) throw missing('membership');
  return req.membership;
}

export function projectOf(req: Request): Project {
  if (!req.project) throw missing('project');
  return req.project;
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { safeEqual, sha256 } from '../utils/crypto.js';

export const SESSION_COOKIE = 'qtm_session';
export const CSRF_COOKIE = 'qtm_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Resolves the session cookie into req.user/req.session when present and valid.
 * Applies sliding expiration capped by the absolute expiry.
 */
export function loadSession(ctx: AppContext): RequestHandler {
  const ttlMs = ctx.config.SESSION_TTL_HOURS * 3600 * 1000;
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) return next();

    const session = await ctx.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
    const now = new Date();
    if (!session || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      if (session) await ctx.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return next();
    }

    if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(now.getTime() + ttlMs, session.absoluteExpiresAt.getTime()));
      await ctx.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: now, expiresAt } });
    }

    const { user, ...rest } = session;
    req.user = user;
    req.session = rest;
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user || !req.session) return next(unauthorized());
  next();
};

/**
 * Double-submit CSRF protection for cookie-authenticated, state-changing requests.
 * The token is bound to the server-side session, so a forged cookie is useless.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.session) return next();
  const header = req.get(CSRF_HEADER);
  if (!header || !safeEqual(header, req.session.csrfToken)) {
    return next(forbidden('Invalid or missing CSRF token'));
  }
  next();
};

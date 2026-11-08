import { Router, type CookieOptions, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { CSRF_COOKIE, SESSION_COOKIE, requireAuth } from '../../middleware/auth.js';
import { forbidden, parse } from '../../utils/errors.js';
import * as auth from './auth.service.js';
import { sessionOf, userOf } from '../../utils/request-context.js';

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const isTest = ctx.config.NODE_ENV === 'test';

  // Per-IP limiter on credential endpoints, complementing the per-account lockout.
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isTest ? 1000 : 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, try again later' } },
  });

  const baseCookie: CookieOptions = {
    secure: ctx.config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  };

  const setSessionCookies = (res: Response, session: auth.IssuedSession) => {
    res.cookie(SESSION_COOKIE, session.token, { ...baseCookie, httpOnly: true, expires: session.expiresAt });
    res.cookie(CSRF_COOKIE, session.csrfToken, { ...baseCookie, httpOnly: false, expires: session.expiresAt });
  };
  const clearSessionCookies = (res: Response) => {
    res.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true });
    res.clearCookie(CSRF_COOKIE, baseCookie);
  };
  const meta = (req: Request) => ({ userAgent: req.get('user-agent'), ip: req.ip });

  // Public: lets the UI hide flows the server cannot provide.
  router.get('/capabilities', (_req, res) => {
    res.json({ registration: ctx.config.REGISTRATION_ENABLED, passwordRecovery: ctx.mailer !== null });
  });

  router.post('/register', credentialLimiter, async (req, res) => {
    if (!ctx.config.REGISTRATION_ENABLED) throw forbidden('Self-registration is disabled on this server. Ask an administrator for access.');
    const input = parse(registerSchema, req.body);
    const { user, session } = await auth.register(ctx, input, meta(req));
    setSessionCookies(res, session);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  router.post('/login', credentialLimiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const { user, session } = await auth.login(ctx, input.email, input.password, meta(req));
    setSessionCookies(res, session);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  router.post('/logout', async (req, res) => {
    if (req.session) await ctx.prisma.session.deleteMany({ where: { id: req.session.id } });
    clearSessionCookies(res);
    res.status(204).end();
  });

  router.post('/logout-all', requireAuth, async (req, res) => {
    await ctx.prisma.session.deleteMany({ where: { userId: userOf(req).id } });
    clearSessionCookies(res);
    res.status(204).end();
  });

  router.post('/forgot-password', credentialLimiter, async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    await auth.requestPasswordReset(ctx, email);
    // Same response whether or not the account exists (no user enumeration); it makes no delivery claim.
    res.status(202).json({ message: 'If an account exists for this email, we will send a reset link.' });
  });

  router.post('/reset-password', credentialLimiter, async (req, res) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await auth.resetPassword(ctx, token, password);
    clearSessionCookies(res);
    res.status(204).end();
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    await auth.changePassword(ctx, userOf(req).id, sessionOf(req).id, input.currentPassword, input.newPassword);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    const memberships = await ctx.prisma.organizationMember.findMany({
      where: { userId: userOf(req).id },
      include: { organization: { select: { id: true, name: true, slug: true, aiEnabled: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      user: req.user,
      csrfToken: sessionOf(req).csrfToken,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
    });
  });

  return router;
}

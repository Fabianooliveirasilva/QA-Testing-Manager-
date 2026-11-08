import argon2 from 'argon2';
import type { RegisterInput } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { randomToken, sha256, slugify } from '../../utils/crypto.js';
import { AppError, badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { audit } from '../../services/audit.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// Verifying against a real hash for unknown e-mails keeps response timing uniform.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash(randomToken(), HASH_OPTIONS));

export const hashPassword = (password: string) => argon2.hash(password, HASH_OPTIONS);

export interface SessionMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function uniqueSlug(ctx: AppContext, name: string): Promise<string> {
  const base = slugify(name) || 'org';
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const exists = await ctx.prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createSession(ctx: AppContext, userId: string, meta: SessionMeta): Promise<IssuedSession> {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + ctx.config.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000);
  const expiresAt = new Date(Math.min(now + ctx.config.SESSION_TTL_HOURS * 3_600_000, absoluteExpiresAt.getTime()));
  await ctx.prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfToken,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      expiresAt,
      absoluteExpiresAt,
    },
  });
  return { token, csrfToken, expiresAt };
}

export async function register(ctx: AppContext, input: RegisterInput, meta: SessionMeta) {
  const existing = await ctx.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(ctx, input.organizationName);
  const user = await ctx.prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug, members: { create: { userId: created.id, role: 'OWNER' } } },
    });
    await audit(tx, {
      organizationId: org.id,
      userId: created.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: org.id,
    });
    return created;
  });
  return { user, session: await createSession(ctx, user.id, meta) };
}

export async function login(ctx: AppContext, email: string, password: string, meta: SessionMeta) {
  const user = await ctx.prisma.user.findUnique({ where: { email } });
  const invalid = unauthorized('Invalid email or password, or account temporarily locked');

  if (!user) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Same work as a normal attempt so response time does not reveal the lock.
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    throw invalid;
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await ctx.prisma.user.update({
      where: { id: user.id },
      data:
        failed >= MAX_FAILED_LOGINS
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
          : { failedLoginCount: failed },
    });
    throw invalid;
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await ctx.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }
  if (argon2.needsRehash(user.passwordHash, HASH_OPTIONS)) {
    await ctx.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }
  return { user, session: await createSession(ctx, user.id, meta) };
}

export async function requestPasswordReset(ctx: AppContext, email: string): Promise<void> {
  const user = await ctx.prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) return;
  const token = randomToken();
  await ctx.prisma.$transaction([
    ctx.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    ctx.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
      },
    }),
  ]);
  const link = `${ctx.config.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await ctx.mailer.send({
    to: user.email,
    subject: 'QA Testing Manager — password reset',
    text: `Use the link below to reset your password. It expires in ${RESET_TOKEN_MINUTES} minutes.\n\n${link}\n\nIf you did not request this, ignore this email.`,
  });
}

export async function resetPassword(ctx: AppContext, token: string, password: string): Promise<void> {
  const record = await ctx.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw badRequest('Reset link is invalid or has expired');
  }
  const passwordHash = await hashPassword(password);
  await ctx.prisma.$transaction(async (tx) => {
    // Claim the token atomically: concurrent requests with the same token cannot both succeed.
    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw badRequest('Reset link is invalid or has expired');
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    // Invalidate every existing session after a reset.
    await tx.session.deleteMany({ where: { userId: record.userId } });
  });
}

export async function changePassword(
  ctx: AppContext,
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await argon2.verify(user.passwordHash, currentPassword))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }
  await ctx.prisma.$transaction([
    ctx.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    ctx.prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
  ]);
}

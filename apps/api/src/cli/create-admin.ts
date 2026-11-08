/**
 * Creates the first administrator (user + organization with OWNER role) without exposing a
 * public password. Usage:
 *   ADMIN_PASSWORD='…' pnpm --filter @qtm/api admin:create -- --email a@b.com --name "Ana" --org "Acme"
 * Without ADMIN_PASSWORD a strong random password is generated and printed once.
 * Docker: docker compose exec api node dist/cli/create-admin.js --email … --name … --org …
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { registerSchema } from '@qtm/shared';
import { audit } from '../services/audit.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { slugify } from '../utils/crypto.js';

export interface AdminInput {
  email: string;
  name: string;
  organizationName: string;
  password: string;
}

/** Strong random password that satisfies the password policy (upper, lower, digit, ≥ 12). */
export function generatePassword(): string {
  return `${randomBytes(18).toString('base64url')}Aa1`;
}

export async function createAdmin(prisma: PrismaClient, raw: AdminInput) {
  const input = registerSchema.parse(raw);
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new Error(`A user with email ${input.email} already exists; refusing to modify it`);
  }
  const base = slugify(input.organizationName) || 'org';
  const slug = (await prisma.organization.findUnique({ where: { slug: base } })) ? `${base}-${randomBytes(3).toString('hex')}` : base;
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
    const org = await tx.organization.create({
      data: { name: input.organizationName, slug, members: { create: { userId: user.id, role: 'OWNER' } } },
    });
    await audit(tx, { organizationId: org.id, userId: null, action: 'admin.created_via_cli', entityType: 'user', entityId: user.id });
    return { userId: user.id, organizationId: org.id };
  });
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, org: { type: 'string' } },
  });
  if (!values.email || !values.name || !values.org) {
    console.error('Usage: create-admin --email <email> --name <name> --org <organization name>');
    process.exit(2);
  }
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? generatePassword();
  const prisma = new PrismaClient();
  try {
    const created = await createAdmin(prisma, { email: values.email, name: values.name, organizationName: values.org, password });
    console.info(`Created owner ${values.email} (user ${created.userId}) in organization ${created.organizationId}.`);
    if (generated) console.info(`Generated password (shown once, change it after first login): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

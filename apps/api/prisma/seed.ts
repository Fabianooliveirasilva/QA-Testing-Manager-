/**
 * Development seed: creates a clearly labelled "Demo Workspace" with sample users,
 * a project, test cases, a plan, one manual run and an imported Playwright report
 * (the genuine report produced by examples/playwright-sample).
 *
 * Refuses to run when NODE_ENV=production. Idempotent: does nothing if the demo org exists.
 * Demo password: SEED_PASSWORD env var, or the documented development default.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import { loadConfig } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { importPlaywrightReport } from '../src/modules/automation/automation.service.js';
import { NoopFileScanner } from '../src/services/file-scanner.js';
import { LocalDiskStorage } from '../src/services/storage.js';

const DEMO_SLUG = 'demo-workspace';
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'DemoPassw0rd!2026';

async function main() {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production environment');
  const prisma = new PrismaClient();
  const logger = pino({ level: 'info' });
  try {
    if (await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } })) {
      logger.info('Demo workspace already exists; nothing to do');
      return;
    }
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const user = (name: string, email: string) =>
      prisma.user.upsert({ where: { email }, update: {}, create: { name, email, passwordHash } });
    const owner = await user('Olivia Owner', 'owner@demo.qtm.local');
    const member = await user('Max Member', 'member@demo.qtm.local');
    const viewer = await user('Vera Viewer', 'viewer@demo.qtm.local');
    const org = await prisma.organization.create({
      data: {
        name: 'Demo Workspace',
        slug: DEMO_SLUG,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
            { userId: viewer.id, role: 'VIEWER' },
          ],
        },
      },
    });

    const project = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Sample Login App',
        description: 'Demo project. Its automated results come from examples/playwright-sample.',
        leadId: owner.id,
        members: { create: [{ userId: owner.id }, { userId: member.id }] },
      },
    });
    const auth = await prisma.testSuite.create({ data: { projectId: project.id, name: 'Authentication' } });
    const checkout = await prisma.testSuite.create({ data: { projectId: project.id, name: 'Checkout' } });

    const caseData = [
      { suite: auth, title: 'Login with valid credentials', priority: 'CRITICAL', type: 'E2E', key: 'LOGIN-001', tags: ['smoke', 'auth'] },
      { suite: auth, title: 'Login with wrong password shows an error', priority: 'HIGH', type: 'E2E', key: 'LOGIN-002', tags: ['auth', 'negative'] },
      { suite: auth, title: 'Account locks after 5 failed attempts', priority: 'HIGH', type: 'SECURITY', key: null, tags: ['auth', 'security'] },
      { suite: checkout, title: 'Pay with a valid card', priority: 'CRITICAL', type: 'FUNCTIONAL', key: null, tags: ['smoke', 'payments'] },
      { suite: checkout, title: 'Expired card is rejected', priority: 'MEDIUM', type: 'REGRESSION', key: null, tags: ['payments', 'negative'] },
    ] as const;
    const cases = [];
    for (const c of caseData) {
      cases.push(
        await prisma.testCase.create({
          data: {
            projectId: project.id,
            suiteId: c.suite.id,
            title: c.title,
            priority: c.priority,
            type: c.type,
            status: 'READY',
            tags: [...c.tags],
            automationKey: c.key,
            createdById: owner.id,
            assigneeId: member.id,
            expectedResult: 'Behaviour matches the acceptance criteria.',
            steps: {
              create: [
                { position: 1, action: 'Open the application', expectedResult: 'Home page is displayed' },
                { position: 2, action: `Perform: ${c.title.toLowerCase()}`, expectedResult: 'Expected outcome is shown' },
              ],
            },
          },
        }),
      );
    }

    const plan = await prisma.testPlan.create({
      data: {
        projectId: project.id,
        name: 'Release 1.0 regression',
        scope: 'Authentication and checkout critical paths',
        environment: 'staging',
        status: 'ACTIVE',
        cases: { create: cases.map((c) => ({ testCaseId: c.id })) },
      },
    });
    const statuses = ['PASSED', 'PASSED', 'FAILED', 'PASSED', 'BLOCKED'] as const;
    const statusAt = (i: number) => statuses[i % statuses.length] ?? 'PASSED';
    const now = new Date();
    const run = await prisma.testRun.create({
      data: {
        projectId: project.id,
        testPlanId: plan.id,
        name: 'Demo manual run',
        environment: 'staging',
        status: 'COMPLETED',
        executedById: member.id,
        finishedAt: now,
        results: {
          create: cases.map((c, i) => ({
            testCaseId: c.id,
            title: c.title,
            status: statusAt(i),
            executedById: member.id,
            executedAt: now,
            actualResult: statusAt(i) === 'FAILED' ? 'Account was not locked after 5 attempts' : '',
          })),
        },
      },
      include: { results: true },
    });
    const failed = run.results.find((r) => r.status === 'FAILED');
    if (!failed) throw new Error('Seed invariant: demo run must contain a failed result');
    await prisma.bug.create({
      data: {
        projectId: project.id,
        testCaseId: failed.testCaseId,
        testResultId: failed.id,
        title: 'Account lockout not triggered after 5 failed logins',
        severity: 'HIGH',
        priority: 'HIGH',
        environment: 'staging',
        stepsToReproduce: '1. Enter a wrong password 5 times\n2. Try again with the right password',
        expectedResult: 'Account is temporarily locked',
        actualResult: 'Login succeeds',
        createdById: member.id,
        assigneeId: owner.id,
        history: { create: { userId: member.id, field: 'created', toValue: 'OPEN' } },
      },
    });

    const ctx: AppContext = {
      config,
      prisma,
      logger,
      storage: new LocalDiskStorage(config.STORAGE_LOCAL_DIR),
      mailer: null,
      ai: null,
      scanner: new NoopFileScanner(),
    };
    await importPlaywrightReport(ctx, {
      projectId: project.id,
      organizationId: org.id,
      userId: owner.id,
      source: 'seed',
      runName: 'Sample project — Playwright',
      environment: 'local',
      raw: readFileSync(new URL('../tests/fixtures/playwright-report.json', import.meta.url)),
    });

    logger.info({ users: ['owner@demo.qtm.local', 'member@demo.qtm.local', 'viewer@demo.qtm.local'] }, 'Demo workspace created (password: SEED_PASSWORD or the documented default)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

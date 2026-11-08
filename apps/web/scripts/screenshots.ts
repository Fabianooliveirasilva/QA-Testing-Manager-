/**
 * Captures README screenshots from a running instance with the demo seed loaded.
 *   pnpm --filter @qtm/web screenshots   (BASE_URL defaults to http://localhost:5173)
 * Credentials come from DEMO_EMAIL / SEED_PASSWORD (defaults: seeded demo owner).
 * Creates one extra in-progress manual run in the demo project to show the execution screen.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EMAIL = process.env.DEMO_EMAIL ?? 'owner@demo.qtm.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'DemoPassw0rd!2026';
const OUT = new URL('../../../docs/screenshots/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function first<T>(items: T[], what: string): T {
  const item = items[0];
  if (!item) throw new Error(`Demo data missing: ${what}. Run \`pnpm db:seed\` first.`);
  return item;
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.mouse.move(1, 1); // avoid hover tooltips in the capture
  await page.waitForTimeout(2000); // let chart entry animations (≈1.5 s) finish
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)) });
  console.info(`saved ${name}.png`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC' });

await page.goto(`${BASE}/login`);
await shot(page, '01-login');
await page.getByLabel('Email').fill(EMAIL);
await page.getByLabel('Password').fill(PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
await shot(page, '02-dashboard');

const api = async <T>(method: string, path: string, data?: unknown): Promise<T> => {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'qtm_csrf')?.value ?? '';
  const res = await page.request.fetch(`${BASE}/api${path}`, { method, data, headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}`);
  return res.json() as Promise<T>;
};
const me = await api<{ organizations: { id: string }[] }>('GET', '/auth/me');
const projects = await api<{ items: { id: string; name: string }[] }>('GET', `/organizations/${first(me.organizations, 'organization').id}/projects`);
const project = projects.items.find((p) => p.name === 'Sample Login App') ?? first(projects.items, 'project');
const base = `${BASE}/p/${project.id}`;

await page.goto(`${base}/test-cases`);
await shot(page, '03-test-cases');
await page.getByRole('link', { name: 'Login with valid credentials' }).click();
await shot(page, '04-test-case-detail');

const RUN_NAME = 'Release 1.0 — RC2 (screenshot)';
const manualRuns = await api<{ items: { id: string; name: string; status: string }[] }>('GET', `/projects/${project.id}/test-runs?source=MANUAL`);
const plans = await api<{ items: { id: string }[] }>('GET', `/projects/${project.id}/test-plans`);
const run =
  manualRuns.items.find((r) => r.name === RUN_NAME && r.status === 'IN_PROGRESS') ??
  (await api<{ id: string }>('POST', `/projects/${project.id}/test-runs`, { testPlanId: first(plans.items, 'test plan').id, name: RUN_NAME }));
await page.goto(`${base}/test-runs/${run.id}`);
const row = (text: string) => page.getByTestId('result-row').filter({ hasText: text });
await row('Login with valid credentials').getByRole('button', { name: 'Pass', exact: true }).click();
await row('Pay with a valid card').getByRole('button', { name: 'Pass', exact: true }).click();
await row('Account locks').getByRole('button', { name: 'Fail', exact: true }).click();
await row('Account locks').getByRole('button', { name: /Account locks/ }).click();
await shot(page, '05-manual-run');

const runs = await api<{ items: { id: string; source: string }[] }>('GET', `/projects/${project.id}/test-runs?source=PLAYWRIGHT`);
await page.goto(`${base}/test-runs/${first(runs.items, 'Playwright run').id}`);
await page.getByTestId('result-row').filter({ hasText: 'intentionally failing' }).getByRole('button', { name: /intentionally failing/ }).click();
await shot(page, '06-playwright-run');

await page.goto(`${base}/automation`);
await shot(page, '07-automation');

const bugs = await api<{ items: { id: string }[] }>('GET', `/projects/${project.id}/bugs`);
await page.goto(`${base}/bugs/${first(bugs.items, 'bug').id}`);
await shot(page, '08-bug-detail');

await page.goto(`${BASE}/ai`);
await shot(page, '09-ai-assistant');

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/`);
await shot(page, '10-mobile-dashboard');

await browser.close();

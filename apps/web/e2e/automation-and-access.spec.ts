import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { apiCall, createProjectViaApi, expect, registerViaApi, test } from './fixtures';

// Genuine Playwright JSON report produced by examples/playwright-sample.
const REPORT = readFileSync(new URL('../../api/tests/fixtures/playwright-report.json', import.meta.url));

test('imports a Playwright JSON report and shows linked, failed, flaky and skipped results', async ({ page }) => {
  const account = await registerViaApi(page, 'Automation Owner');
  const project = await createProjectViaApi(page, account.orgId, 'Sample Login');
  const suites = await (await page.request.get(`/api/projects/${project.id}/suites`)).json();
  await apiCall(page, 'POST', `/api/projects/${project.id}/test-cases`, {
    suiteId: suites.items[0].id,
    title: 'Login with valid credentials',
    automationKey: 'LOGIN-001',
  });

  await page.goto(`/p/${project.id}/automation`);
  await page.getByTestId('report-input').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: REPORT });
  await page.getByLabel('Run name (optional)').fill('Nightly #1');
  await page.getByRole('button', { name: 'Import report' }).click();

  await expect(page.getByRole('heading', { name: /Nightly #1/ })).toBeVisible();
  await expect(page.getByText('1/5 linked to test cases')).toBeVisible();
  const rows = page.getByTestId('result-row');
  await expect(rows).toHaveCount(5);
  await expect(rows.filter({ hasText: 'flaky on first attempt' }).getByText('Flaky', { exact: true })).toBeVisible();
  const failed = rows.filter({ hasText: 'intentionally failing' });
  await expect(failed.getByText('Failed')).toBeVisible();
  await failed.getByRole('button', { name: /intentionally failing/ }).click();
  await expect(failed.getByText(/toHaveTitle/).first()).toBeVisible();

  // Re-import is rejected as a duplicate
  await page.goto(`/p/${project.id}/automation`);
  await page.getByTestId('report-input').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: REPORT });
  await page.getByRole('button', { name: 'Import report' }).click();
  await expect(page.getByText('This report has already been imported')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);

  // Imported results show on the linked test case
  await page.goto(`/p/${project.id}/test-cases`);
  await page.getByRole('link', { name: 'Login with valid credentials' }).click();
  await expect(page.getByRole('region', { name: 'Recent executions' })).toContainText('Nightly #1');
});

test('viewers get a read-only UI and outsiders cannot open another organization’s project', async ({ page, browser }) => {
  const owner = await registerViaApi(page, 'Access Owner', 'Tenant A');
  const project = await createProjectViaApi(page, owner.orgId, 'Private Project');

  const viewerPage = await browser.newPage();
  const viewer = await registerViaApi(viewerPage, 'Viewer Person', 'Viewer Home');
  await apiCall(page, 'POST', `/api/organizations/${owner.orgId}/members`, { email: viewer.email, role: 'VIEWER' });

  // Outsider (viewer before switching org has no access through their own org) — direct URL shows not found
  const outsiderPage = await browser.newPage();
  await registerViaApi(outsiderPage, 'Outsider', 'Tenant B');
  await outsiderPage.goto(`/p/${project.id}/test-cases`);
  await expect(outsiderPage.getByText('Project not found')).toBeVisible();
  await outsiderPage.close();

  // Viewer switches to Tenant A and sees no write actions
  await viewerPage.goto('/');
  await viewerPage.getByRole('button', { name: 'Account menu' }).click();
  await viewerPage.getByRole('menuitem', { name: /Tenant A/ }).click();
  await viewerPage.goto(`/p/${project.id}/test-cases`);
  await expect(viewerPage.getByRole('heading', { name: 'Test cases', exact: true })).toBeVisible();
  await expect(viewerPage.getByRole('link', { name: 'New test case' })).toHaveCount(0);
  await viewerPage.goto(`/p/${project.id}/bugs`);
  await expect(viewerPage.getByRole('link', { name: 'Report bug' })).toHaveCount(0);
  await viewerPage.close();
});

test('key pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const scan = async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length} node(s)`);
  };
  expect(await scan()).toEqual([]);

  const account = await registerViaApi(page, 'A11y User');
  const project = await createProjectViaApi(page, account.orgId, 'A11y Project');
  for (const path of ['/', '/projects', `/p/${project.id}/test-cases`, `/p/${project.id}/test-cases/new`, `/p/${project.id}/bugs/new`, '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await scan(), `violations on ${path}`).toEqual([]);
  }
});

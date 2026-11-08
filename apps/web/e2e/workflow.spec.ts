import { expect, registerViaApi, test } from './fixtures';

// Full manual-testing lifecycle through the UI against the real API and database.
test('project → suite → test case → plan → run → bug → evidence → dashboard', async ({ page }) => {
  await registerViaApi(page, 'Flow Owner', 'Flow Org');

  // Project
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Checkout');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: /Checkout/ })).toBeVisible();

  // Suite
  await page.getByLabel('New suite name').fill('Payments');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByRole('link', { name: 'Payments' })).toBeVisible();

  // Test case with two steps
  await page.getByRole('link', { name: 'Test cases' }).first().click();
  await page.getByRole('link', { name: 'New test case' }).first().click();
  await page.getByLabel('Title').fill('Pay with a valid card');
  await page.getByLabel('Suite').selectOption({ label: 'Payments' });
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByLabel('Type').selectOption('E2E');
  await page.getByLabel('Tags').fill('smoke, payments');
  await page.getByLabel('Step 1 action').fill('Open checkout');
  await page.getByLabel('Step 1 expected result').fill('Payment form is visible');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step 2 action').fill('Submit a valid card');
  await page.getByLabel('Step 2 expected result').fill('Order is confirmed');
  await page.getByRole('button', { name: 'Create test case' }).click();
  await expect(page.getByRole('heading', { name: 'Pay with a valid card' })).toBeVisible();
  await expect(page.getByText('Submit a valid card')).toBeVisible();

  // Second case via duplicate
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Pay with a valid card (copy)' })).toBeVisible();

  // Search & filter the list
  await page.getByRole('link', { name: 'Test cases' }).first().click();
  await page.getByLabel('Search test cases').fill('copy');
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Search test cases').fill('');
  await expect(page.getByRole('row')).toHaveCount(3);

  // Plan from suite
  await page.getByRole('link', { name: 'Test Plans' }).click();
  await page.getByRole('button', { name: 'New plan' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Release 1.0');
  await page.getByLabel('Environment').fill('staging');
  await page.getByRole('group', { name: 'Include suites' }).getByRole('checkbox', { name: 'Payments (2)' }).check();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('heading', { name: /Release 1\.0/ })).toBeVisible();
  await expect(page.getByText('Test cases (2)')).toBeVisible();

  // Manual run
  await page.getByLabel('Run name').fill('RC1');
  await page.getByRole('button', { name: 'Start manual run' }).click();
  await expect(page.getByRole('heading', { name: /RC1/ })).toBeVisible();
  const rows = page.getByTestId('result-row');
  await expect(rows).toHaveCount(2);

  const failing = rows.filter({ hasText: '(copy)' });
  await failing.getByRole('button', { name: 'Fail' }).click();
  await expect(failing.getByRole('button', { name: 'Fail' })).toHaveAttribute('data-active', 'true');
  const passing = rows.filter({ hasNotText: '(copy)' });
  await passing.getByRole('button', { name: 'Pass' }).click();
  await expect(passing.getByRole('button', { name: 'Pass' })).toHaveAttribute('data-active', 'true');
  await expect(page.getByText('50%', { exact: false }).first()).toBeVisible();

  // Evidence on the failed result, then report a bug from it
  await failing.getByRole('button', { name: /Pay with a valid card \(copy\)/ }).click();
  await failing.getByTestId('upload-test_result').setInputFiles({
    name: 'console.log',
    mimeType: 'text/plain',
    buffer: Buffer.from('TypeError: card.token is undefined\n'),
  });
  await expect(failing.getByText('console.log', { exact: true })).toBeVisible();
  await failing.getByRole('button', { name: 'Report bug' }).click();
  await expect(page.getByRole('heading', { name: 'Report bug' })).toBeVisible();
  await page.getByLabel('Severity').selectOption('CRITICAL');
  await page.getByLabel('Steps to reproduce').fill('1. Open checkout\n2. Submit card');
  await page.getByRole('button', { name: 'Report bug' }).click();
  await expect(page.getByText('created the bug')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View run' })).toBeVisible();

  // Bug evidence (image) and status change with history
  await page.getByTestId('upload-bug').setInputFiles({
    name: 'screenshot.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByRole('region', { name: 'Evidence' }).getByText('screenshot.png', { exact: true })).toBeVisible();
  await page.getByLabel('Change status').selectOption('IN_PROGRESS');
  await expect(page.getByText(/changed status from/)).toBeVisible();

  // Rejected upload: content does not match extension
  await page.getByTestId('upload-bug').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') });
  await expect(page.getByText('File content does not match its extension')).toBeVisible();

  // Complete the run
  await page.getByRole('link', { name: 'View run' }).click();
  await page.getByRole('button', { name: 'Complete run' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByRole('heading', { name: /RC1/ }).getByText('Completed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pass' })).toHaveCount(0);

  // Dashboard reflects persisted data
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('group', { name: 'Critical bugs' })).toContainText('1');
  await expect(page.getByRole('group', { name: 'Pass rate' })).toContainText('50%');
  await expect(page.getByRole('link', { name: /RC1/ })).toBeVisible();
});

import { expect, test } from '@playwright/test';

// The `qtm` annotation links a test to a QA Testing Manager test case with the same automation key.
test.describe('Login', () => {
  test('valid credentials show welcome message', { annotation: { type: 'qtm', description: 'LOGIN-001' } }, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('qa@example.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status')).toHaveText('Welcome back');
  });

  test('invalid credentials show an error', { annotation: { type: 'qtm', description: 'LOGIN-002' } }, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('qa@example.com');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status')).toHaveText('Invalid credentials');
  });

  test('remember-me checkbox is available', async ({ page }) => {
    test.skip(true, 'Feature not implemented in the sample site yet');
    await page.goto('/');
  });
});

// Deliberate demonstrations so an imported report contains every outcome type.
test.describe('Demonstration outcomes', () => {
  test('DEMO: intentionally failing assertion', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Dashboard', { timeout: 1000 });
  });

  test('DEMO: flaky on first attempt, passes on retry', async ({ page }, testInfo) => {
    await page.goto('/');
    expect(testInfo.retry, 'fails on purpose on the first attempt').toBeGreaterThan(0);
  });
});

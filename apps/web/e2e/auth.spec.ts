import { PASSWORD, expect, registerViaApi, test, uniqueEmail } from './fixtures';

test.describe('authentication', () => {
  test('registers through the UI and lands on the dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Riley Tester');
    await page.getByLabel('Work email').fill(uniqueEmail('riley'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Organization name').fill('Riley QA');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Quality overview for Riley QA')).toBeVisible();
    await expect(page.getByText('Create your first project')).toBeVisible();
  });

  test('shows validation errors for invalid registration data', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Password must have at least 12 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('logs out and back in; wrong password shows a generic error', async ({ page }) => {
    const account = await registerViaApi(page, 'Login User');
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill('Wrong-Password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('protected routes redirect anonymous users to login and back after sign-in', async ({ page, browser }) => {
    const account = await registerViaApi(page, 'Redirect User');
    const anonymous = await browser.newPage();
    await anonymous.goto('/settings');
    await expect(anonymous).toHaveURL(/\/login$/);
    await anonymous.getByLabel('Email').fill(account.email);
    await anonymous.getByLabel('Password').fill(PASSWORD);
    await anonymous.getByRole('button', { name: 'Sign in' }).click();
    await expect(anonymous.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await anonymous.close();
  });
});

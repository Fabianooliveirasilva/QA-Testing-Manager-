import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'E2e-Strong-Passw0rd';
let seq = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${++seq}@e2e.test`;

export interface Account {
  email: string;
  name: string;
  orgId: string;
}

function csrfHeader(cookies: { name: string; value: string }[]) {
  const csrf = cookies.find((c) => c.name === 'qtm_csrf')?.value ?? '';
  return { 'x-csrf-token': decodeURIComponent(csrf) };
}

/** Registers through the API (same origin via the Vite proxy) so the browser context holds the session. */
export async function registerViaApi(page: Page, name = 'E2E User', organizationName = 'E2E Org'): Promise<Account> {
  const email = uniqueEmail(name.toLowerCase().replace(/\W+/g, '-'));
  const res = await page.request.post('/api/auth/register', { data: { name, email, password: PASSWORD, organizationName } });
  expect(res.status(), await res.text()).toBe(201);
  const me = await (await page.request.get('/api/auth/me')).json();
  return { email, name, orgId: me.organizations[0].id };
}

/** Authenticated JSON call from the page's browser context (sends cookies + CSRF header). */
export async function apiCall(page: Page, method: 'POST' | 'PATCH' | 'DELETE', url: string, data?: unknown) {
  const request: APIRequestContext = page.request;
  const headers = csrfHeader(await page.context().cookies());
  const res = await request.fetch(url, { method, data, headers });
  expect(res.ok(), `${method} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return res.status() === 204 ? null : res.json();
}

export async function createProjectViaApi(page: Page, orgId: string, name: string) {
  const project = await apiCall(page, 'POST', `/api/organizations/${orgId}/projects`, { name });
  return project as { id: string; name: string };
}

export const test = base;
export { expect };

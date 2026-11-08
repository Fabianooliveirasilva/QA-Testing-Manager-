import { describe, expect, it } from 'vitest';
import { passRate } from '../modules/test-runs/run-summary.js';
import { loadConfig } from '../config/env.js';
import { safeEqual, slugify } from './crypto.js';
import { hasPermission } from './permissions.js';

describe('hasPermission', () => {
  it('maps roles to the documented permission matrix', () => {
    expect(hasPermission('VIEWER', 'read')).toBe(true);
    expect(hasPermission('VIEWER', 'test:write')).toBe(false);
    expect(hasPermission('MEMBER', 'test:write')).toBe(true);
    expect(hasPermission('MEMBER', 'project:manage')).toBe(false);
    expect(hasPermission('MEMBER', 'bug:delete')).toBe(false);
    expect(hasPermission('ADMIN', 'members:manage')).toBe(true);
    expect(hasPermission('OWNER', 'audit:read')).toBe(true);
  });
});

describe('passRate', () => {
  it('is null when nothing decisive ran', () => {
    expect(passRate({ PASSED: 0, FAILED: 0, BLOCKED: 0 })).toBeNull();
  });
  it('excludes skipped/not-run and rounds to one decimal', () => {
    expect(passRate({ PASSED: 2, FAILED: 1, BLOCKED: 0 })).toBe(66.7);
    expect(passRate({ PASSED: 1, FAILED: 0, BLOCKED: 0 })).toBe(100);
  });
});

describe('crypto helpers', () => {
  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('slugifies names', () => {
    expect(slugify('Ação & Qualidade QA!')).toBe('acao-qualidade-qa');
  });
});

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it('refuses insecure cookies in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).toThrow(/COOKIE_SECURE/);
  });
  it('parses comma-separated origins', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', WEB_ORIGIN: 'http://a.test, http://b.test' });
    expect(c.WEB_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });
});

describe('loadConfig — production safety', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', COOKIE_SECURE: 'true' };
  it('requires APP_URL and WEB_ORIGIN to be explicit in production', () => {
    expect(() => loadConfig(prod)).toThrow(/APP_URL, WEB_ORIGIN must be set explicitly/);
    expect(() => loadConfig({ ...prod, APP_URL: 'https://qa.example.com', WEB_ORIGIN: 'https://qa.example.com' })).not.toThrow();
  });
  it('defaults: registration enabled, org AI quota 500', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(c.REGISTRATION_ENABLED).toBe(true);
    expect(c.AI_DAILY_LIMIT_PER_ORG).toBe(500);
  });
});

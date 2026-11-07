import { describe, expect, it } from 'vitest';
import { bugUpdateSchema, passwordSchema, registerSchema, testCaseCreateSchema, testCaseUpdateSchema } from './schemas.js';

describe('passwordSchema', () => {
  it.each(['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsHereAtAll'])('rejects %s', (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
  it('accepts a strong password', () => {
    expect(passwordSchema.safeParse('Str0ngPassword!').success).toBe(true);
  });
});

describe('registerSchema', () => {
  it('normalizes email casing and whitespace', () => {
    const parsed = registerSchema.parse({
      name: ' Ana ',
      email: '  Ana@Example.COM ',
      password: 'Str0ngPassword!',
      organizationName: 'Org',
    });
    expect(parsed.email).toBe('ana@example.com');
    expect(parsed.name).toBe('Ana');
  });
});

describe('PATCH schemas (regression: defaults must not reset omitted fields)', () => {
  it('bug update with only status leaves severity and text fields undefined', () => {
    const parsed = bugUpdateSchema.parse({ status: 'IN_PROGRESS' });
    expect(parsed).toEqual({ status: 'IN_PROGRESS' });
  });

  it('test case update with only a title does not touch priority, tags or steps', () => {
    expect(testCaseUpdateSchema.parse({ title: 'New title' })).toEqual({ title: 'New title' });
  });

  it('create schema still applies defaults', () => {
    const parsed = testCaseCreateSchema.parse({ suiteId: '7f1b1c5e-8e47-4c63-9d0a-1d7c5e0f6a11', title: 'x' });
    expect(parsed).toMatchObject({ priority: 'MEDIUM', type: 'FUNCTIONAL', status: 'DRAFT', tags: [], steps: [] });
  });

  it('rejects invalid tags', () => {
    const res = testCaseCreateSchema.safeParse({ suiteId: '7f1b1c5e-8e47-4c63-9d0a-1d7c5e0f6a11', title: 'x', tags: ['bad tag!'] });
    expect(res.success).toBe(false);
  });
});

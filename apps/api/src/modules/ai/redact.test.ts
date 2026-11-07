import { describe, expect, it } from 'vitest';
import { redactSensitive } from './redact.js';

describe('redactSensitive', () => {
  it.each([
    ['email', 'contact john.doe@corp.io now', 'john.doe@corp.io'],
    ['anthropic key', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'sk-ant-api03'],
    ['project token', 'qtm_ABCDEFGHIJKLMNOPQRSTUVWXYZ123', 'qtm_ABCDEF'],
    ['aws key', 'AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnop', 'eyJzdWIi'],
    ['password assignment', 'password=Sup3rSecret', 'Sup3rSecret'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', 'MIIabc'],
  ])('removes %s', (_name, input, secret) => {
    expect(redactSensitive(input)).not.toContain(secret);
  });

  it('keeps ordinary requirement text intact', () => {
    const text = 'As a user I want to reset my password so that I can log in again.';
    expect(redactSensitive(text)).toBe(text);
  });
});

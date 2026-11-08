import { describe, expect, it } from 'vitest';
import { passwordResetEmail } from './email-templates.js';

describe('passwordResetEmail', () => {
  const link = 'https://qa.example.com/reset-password?token=abc_DEF-123';

  it('contains the link, validity and a safe fallback in both text and HTML', () => {
    const email = passwordResetEmail({ link, minutes: 30, name: 'Ana' });
    expect(email.subject).toBe('Reset your QA Testing Manager password');
    expect(email.text).toContain(link);
    expect(email.text).toContain('30 minutes');
    expect(email.html).toContain(`href="${link}"`);
    expect(email.html).toContain('Hi Ana,');
  });

  it('escapes user-controlled values in HTML (no markup injection through the name)', () => {
    const email = passwordResetEmail({ link, minutes: 30, name: '<img src=x onerror=alert(1)>"Eve"' });
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;Eve&quot;');
  });
});

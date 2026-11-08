const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function passwordResetEmail({ link, minutes, name }: { link: string; minutes: number; name: string }): EmailContent {
  const greeting = `Hi ${name},`;
  const text = [
    greeting,
    '',
    'We received a request to reset your QA Testing Manager password.',
    `Use the link below within ${minutes} minutes. It can only be used once.`,
    '',
    link,
    '',
    'If you did not request this, you can ignore this email; your password will not change.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2330">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <tr><td>
      <p style="margin:0 0 16px;font-size:16px">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 16px;font-size:15px">We received a request to reset your QA Testing Manager password.
        The link is valid for ${minutes} minutes and can only be used once.</p>
      <p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#6366f1;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Reset password</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
      <p style="margin:0;font-size:13px;color:#555">If you did not request this, ignore this email — your password will not change.</p>
    </td></tr>
  </table>
</body></html>`;
  return { subject: 'Reset your QA Testing Manager password', text, html };
}

import { beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, registerAccount, resetDatabase, type Account } from './helpers.js';

const { app } = createTestApp();
let qa: Account;
let outsider: Account;
let projectId: string;
let bugId: string;

// Minimal valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  await resetDatabase();
  qa = await registerAccount(app);
  outsider = await registerAccount(app, 'Outsider', 'Other');
  ({ projectId } = await createProject(qa));
  bugId = (await qa.client.post(`/api/projects/${projectId}/bugs`, { title: 'Visual glitch' })).body.id;
});

const upload = (file: Buffer, name: string, contentType: string, entityId = bugId) =>
  qa.client
    .post(`/api/projects/${projectId}/attachments`)
    .field('entityType', 'BUG')
    .field('entityId', entityId)
    .attach('file', file, { filename: name, contentType });

describe('evidence uploads', () => {
  it('accepts a real PNG and serves it back with safe headers', async () => {
    const res = await upload(PNG, 'screenshot.png', 'image/png');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fileName: 'screenshot.png', mimeType: 'image/png', size: PNG.length });

    const list = await qa.client.get(`/api/projects/${projectId}/attachments?entityType=BUG&entityId=${bugId}`);
    expect(list.body.items).toHaveLength(1);

    const dl = await qa.client.get(`/api/projects/${projectId}/attachments/${res.body.id}/download`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
  });

  it('accepts PDF and UTF-8 text logs', async () => {
    expect((await upload(PDF, 'report.pdf', 'application/pdf')).status).toBe(201);
    expect((await upload(Buffer.from('line 1\nERROR boom\n'), 'console.log', 'application/octet-stream')).status).toBe(201);
  });

  it('rejects content that does not match the extension (spoofed PNG)', async () => {
    const res = await upload(Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png');
    expect(res.status).toBe(415);
  });

  it.each([
    ['page.html', 'text/html', '<html><script>alert(1)</script></html>'],
    ['icon.svg', 'image/svg+xml', '<svg onload="alert(1)"/>'],
    ['run.exe', 'application/octet-stream', 'MZ'],
    ['noext', 'text/plain', 'hello'],
  ])('rejects disallowed type %s', async (name, type, body) => {
    expect((await upload(Buffer.from(body), name, type)).status).toBe(415);
  });

  it('rejects binary content disguised as text and mismatched declared MIME', async () => {
    expect((await upload(PNG, 'notes.txt', 'text/plain')).status).toBe(415);
    expect((await upload(PNG, 'shot.png', 'application/pdf')).status).toBe(415);
  });

  it('rejects files above the 10 MB limit with 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    expect((await upload(big, 'big.txt', 'text/plain')).status).toBe(413);
  });

  it('neutralizes path traversal in file names', async () => {
    const res = await upload(Buffer.from('ok'), '../../etc/passwd.txt', 'text/plain');
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe('passwd.txt');
  });

  it('requires the target entity to belong to the project', async () => {
    const other = await createProject(outsider, 'Other');
    const foreignBug = await outsider.client.post(`/api/projects/${other.projectId}/bugs`, { title: 'x' });
    expect((await upload(PNG, 'x.png', 'image/png', foreignBug.body.id)).status).toBe(404);
  });

  it('outsiders cannot download or delete evidence', async () => {
    const res = await upload(PNG, 'private.png', 'image/png');
    const url = `/api/projects/${projectId}/attachments/${res.body.id}`;
    expect((await outsider.client.get(`${url}/download`)).status).toBe(404);
    expect((await outsider.client.delete(url)).status).toBe(404);
    expect((await qa.client.delete(url)).status).toBe(204);
    expect((await qa.client.get(`${url}/download`)).status).toBe(404);
  });
});

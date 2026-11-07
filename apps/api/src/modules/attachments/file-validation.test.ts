import { describe, expect, it } from 'vitest';
import { sanitizeFileName, validateUpload } from './file-validation.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('validateUpload', () => {
  it('accepts matching binary content', async () => {
    await expect(validateUpload('a.png', 'image/png', PNG)).resolves.toBe('image/png');
    await expect(validateUpload('a.JPG', 'image/jpeg', JPEG)).resolves.toBe('image/jpeg');
  });

  it('accepts UTF-8 text and valid JSON', async () => {
    await expect(validateUpload('run.log', 'application/octet-stream', Buffer.from('ok ✓'))).resolves.toBe('text/plain');
    await expect(validateUpload('data.json', 'application/json', Buffer.from('{"a":1}'))).resolves.toBe('application/json');
  });

  it.each([
    ['empty file', 'a.txt', 'text/plain', Buffer.alloc(0)],
    ['extension not allowed', 'a.html', 'text/html', Buffer.from('<p>')],
    ['spoofed image', 'a.png', 'image/png', Buffer.from('not an image')],
    ['JPEG renamed to PNG', 'a.png', 'image/png', JPEG],
    ['binary in .txt', 'a.txt', 'text/plain', PNG],
    ['NUL byte in text', 'a.txt', 'text/plain', Buffer.from('a\u0000b')],
    ['invalid UTF-8', 'a.txt', 'text/plain', Buffer.from([0xc3, 0x28])],
    ['invalid JSON', 'a.json', 'application/json', Buffer.from('{oops')],
    ['declared type mismatch', 'a.png', 'text/plain', PNG],
  ])('rejects %s', async (_name, file, mime, buf) => {
    await expect(validateUpload(file, mime, buf)).rejects.toMatchObject({ status: 415 });
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\win.ini', 'win.ini'],
    ['.hidden', 'hidden'],
    ['report<script>.txt', 'report_script_.txt'],
    ['', 'file'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});

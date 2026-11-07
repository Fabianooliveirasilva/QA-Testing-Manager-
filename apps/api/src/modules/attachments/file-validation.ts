import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_UPLOADS } from '@qtm/shared';
import { AppError } from '../../utils/errors.js';

type Extension = keyof typeof ALLOWED_UPLOADS;
const BINARY_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

const reject = (message: string) => new AppError(415, 'UNSUPPORTED_FILE', message);

export function sanitizeFileName(original: string): string {
  const base = path.basename(original.replace(/\\/g, '/'));
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/^\.+/, '')
    .slice(-150);
  return cleaned || 'file';
}

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an upload by extension, declared MIME type and actual content (magic bytes).
 * Returns the canonical MIME type that will be stored and served.
 */
export async function validateUpload(fileName: string, declaredMime: string, buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw reject('File is empty');
  const ext = path.extname(fileName).toLowerCase();
  if (!(ext in ALLOWED_UPLOADS)) {
    throw reject(`File type not allowed. Allowed: ${Object.keys(ALLOWED_UPLOADS).join(', ')}`);
  }
  const expectedMime = ALLOWED_UPLOADS[ext as Extension];
  const declared = (declaredMime.split(';')[0] ?? '').trim().toLowerCase();
  // Browsers commonly report .log as octet-stream and some tools send JSON as text/plain.
  const acceptedDeclared = BINARY_TYPES.has(expectedMime)
    ? [expectedMime]
    : [expectedMime, 'text/plain', 'application/octet-stream'];
  if (!acceptedDeclared.includes(declared)) {
    throw reject('Declared content type does not match the file extension');
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (BINARY_TYPES.has(expectedMime)) {
    if (detected?.mime !== expectedMime) throw reject('File content does not match its extension');
    return expectedMime;
  }

  // Text formats have no magic bytes: they must be valid UTF-8 without binary signatures.
  if (detected || !isUtf8Text(buffer)) throw reject('Text file contains binary content');
  if (expectedMime === 'application/json') {
    try {
      JSON.parse(buffer.toString('utf-8'));
    } catch {
      throw reject('JSON file is not valid JSON');
    }
  }
  return expectedMime;
}

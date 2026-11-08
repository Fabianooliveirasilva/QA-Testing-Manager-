import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClamAvScanner, ScannerError } from './clamav-scanner.js';

/**
 * Local stand-in for clamd (external engine). It decodes the INSTREAM framing and replies according to
 * `mode`, so the adapter's protocol handling is exercised byte for byte. Real detection is verified by
 * tests-live/clamav.live.test.ts against a real clamd.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
type Mode = 'detect' | 'silent' | 'garbage' | 'size-limit' | 'close';
let mode: Mode = 'detect';
let received: Buffer[] = [];
let server: Server;
let port = 0;

function handle(socket: Socket) {
  let buffer = Buffer.alloc(0);
  let command: string | null = null;
  const chunks: Buffer[] = [];
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    if (command === null) {
      const nul = buffer.indexOf(0);
      if (nul === -1) return;
      command = buffer.subarray(0, nul).toString();
      buffer = buffer.subarray(nul + 1);
      if (command === 'zPING') return void socket.end('PONG\0');
    }
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) return;
      if (length === 0) {
        const file = Buffer.concat(chunks);
        received.push(file);
        if (mode === 'silent') return;
        if (mode === 'close') return void socket.destroy();
        if (mode === 'garbage') return void socket.end('\u0001\u0002 weird \u0000');
        if (mode === 'size-limit') return void socket.end('INSTREAM size limit exceeded. ERROR\0');
        return void socket.end(file.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
      }
      chunks.push(buffer.subarray(4, 4 + length));
      buffer = buffer.subarray(4 + length);
    }
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  mode = 'detect';
  received = [];
});

const scanner = (timeoutMs = 2_000) => new ClamAvScanner({ host: '127.0.0.1', port, timeoutMs });

describe('ClamAvScanner (local clamd protocol double)', () => {
  it('streams the exact bytes in chunks and reports a clean file', async () => {
    const file = Buffer.alloc(200 * 1024, 7); // spans several 64 KiB chunks
    await expect(scanner().scan(file)).resolves.toEqual({ status: 'CLEAN' });
    expect(Buffer.compare(received[0]!, file)).toBe(0);
  });

  it('reports the EICAR test signature as infected', async () => {
    await expect(scanner().scan(Buffer.from(EICAR))).resolves.toEqual({ status: 'INFECTED', signature: 'Eicar-Test-Signature' });
  });

  it('answers PING', async () => {
    await expect(scanner().ping()).resolves.toBe(true);
  });

  it('scanner unavailable → ScannerError(unavailable), never CLEAN', async () => {
    const down = new ClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 1_000 });
    await expect(down.scan(Buffer.from('x'))).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('no reply within the timeout → ScannerError(timeout)', async () => {
    mode = 'silent';
    await expect(scanner(300).scan(Buffer.from('x'))).rejects.toMatchObject({ kind: 'timeout' });
  });

  it.each(['garbage', 'size-limit', 'close'] as const)('unexpected reply (%s) → ScannerError(unexpected_response)', async (m) => {
    mode = m;
    const error = await scanner().scan(Buffer.from('payload-secret-content')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScannerError);
    expect(error).toMatchObject({ kind: 'unexpected_response' });
    expect((error as Error).message).not.toContain('payload-secret-content');
  });
});

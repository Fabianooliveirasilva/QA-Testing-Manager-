import { createConnection } from 'node:net';
import type { FileScanner, ScanVerdict } from './file-scanner.js';

/** The scan could not produce a verdict. Callers must fail closed (never treat the file as clean). */
export class ScannerError extends Error {
  constructor(
    public readonly kind: 'unavailable' | 'timeout' | 'unexpected_response',
    message: string,
  ) {
    super(message);
    this.name = 'ScannerError';
  }
}

export interface ClamAvOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

const CHUNK = 64 * 1024;

/**
 * clamd adapter using the INSTREAM command over TCP (clamd(8)): `zINSTREAM\0`, then chunks of
 * <4-byte big-endian length><data>, terminated by a zero-length chunk. Replies: `stream: OK`,
 * `stream: <signature> FOUND`, or an error line.
 */
export class ClamAvScanner implements FileScanner {
  readonly name = 'clamav';
  private readonly timeoutMs: number;

  constructor(private readonly options: ClamAvOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private exchange(write: (send: (chunk: Buffer) => void) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.options.host, port: this.options.port });
      const parts: Buffer[] = [];
      let settled = false;
      const finish = (error: ScannerError | null, reply = '') => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(reply);
      };
      socket.setTimeout(this.timeoutMs, () => finish(new ScannerError('timeout', `Malware scanner did not answer within ${this.timeoutMs} ms`)));
      socket.on('error', () => finish(new ScannerError('unavailable', 'Malware scanner is unreachable')));
      socket.on('data', (data) => {
        parts.push(data);
        const reply = Buffer.concat(parts);
        const end = reply.indexOf(0);
        if (end !== -1) finish(null, reply.subarray(0, end).toString('utf8').trim());
      });
      socket.on('end', () => finish(null, Buffer.concat(parts).toString('utf8').replace(/\0/g, '').trim()));
      socket.on('connect', () => write((chunk) => socket.write(chunk)));
    });
  }

  async ping(): Promise<boolean> {
    const reply = await this.exchange((send) => send(Buffer.from('zPING\0')));
    return reply === 'PONG';
  }

  async scan(data: Buffer): Promise<ScanVerdict> {
    const reply = await this.exchange((send) => {
      send(Buffer.from('zINSTREAM\0'));
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const chunk = data.subarray(offset, offset + CHUNK);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        send(length);
        send(chunk);
      }
      send(Buffer.alloc(4)); // zero-length terminator
    });
    if (reply === 'stream: OK') return { status: 'CLEAN' };
    const found = /^stream: (.+) FOUND$/.exec(reply);
    if (found?.[1]) return { status: 'INFECTED', signature: found[1].slice(0, 200) };
    // Never echo more than a short, sanitized fragment (the reply never contains file content).
    throw new ScannerError('unexpected_response', `Unexpected malware scanner reply: ${reply.replace(/[^\x20-\x7e]/g, '?').slice(0, 80)}`);
  }
}

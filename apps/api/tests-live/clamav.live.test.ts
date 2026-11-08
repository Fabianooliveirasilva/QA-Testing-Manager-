/**
 * LIVE ClamAV test against a real clamd (official clamav/clamav image).
 *   docker compose --profile antivirus up -d clamav   (or any clamd on TCP 3310)
 *   CLAMAV_HOST=localhost pnpm --filter @qtm/api test:live:clamav
 * Uses only the harmless EICAR test string, which every engine detects by design.
 */
import { describe, expect, it } from 'vitest';
import { ClamAvScanner } from '../src/services/clamav-scanner.js';
import { createProject, createTestApp, registerAccount, resetDatabase, testPrisma } from '../tests/helpers.js';

const HOST = process.env.CLAMAV_HOST ?? '';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
if (!HOST) console.warn('[live] CLAMAV_HOST is not set — live ClamAV tests are SKIPPED (not verified).');

describe.skipIf(!HOST)('ClamAV live (real clamd)', () => {
  const scanner = new ClamAvScanner({ host: HOST, port: PORT, timeoutMs: 30_000 });

  it('responds to PING', async () => {
    await expect(scanner.ping()).resolves.toBe(true);
  });

  it('detects EICAR and passes a clean file', async () => {
    const infected = await scanner.scan(EICAR);
    expect(infected.status).toBe('INFECTED');
    console.info(`[live] clamd verdict for EICAR: ${JSON.stringify(infected)}`);
    await expect(scanner.scan(Buffer.from('ordinary QA evidence log\n'))).resolves.toEqual({ status: 'CLEAN' });
  });

  it('end to end: infected upload rejected, clean upload stored as CLEAN', async () => {
    await resetDatabase();
    const { app } = createTestApp({ scanner });
    const acc = await registerAccount(app);
    const { projectId } = await createProject(acc);
    const bug = await acc.client.post(`/api/projects/${projectId}/bugs`, { title: 'live scan' });
    const upload = (data: Buffer) =>
      acc.client
        .post(`/api/projects/${projectId}/attachments`)
        .field('entityType', 'BUG')
        .field('entityId', bug.body.id)
        .attach('file', data, { filename: 'evidence.txt', contentType: 'text/plain' });
    expect((await upload(EICAR)).status).toBe(422);
    const clean = await upload(Buffer.from('ordinary QA evidence log\n'));
    expect(clean.status).toBe(201);
    expect(clean.body.scanStatus).toBe('CLEAN');
    expect(await testPrisma().attachment.count({ where: { entityId: bug.body.id } })).toBe(1);
  });
});

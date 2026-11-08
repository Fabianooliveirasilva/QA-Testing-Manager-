/**
 * LIVE Anthropic API tests — real network calls, real billing (a few hundred tokens).
 * Run only with credentials: ANTHROPIC_API_KEY=… pnpm --filter @qtm/api test:live:anthropic
 * Prompts are synthetic QA text; never send personal or production data here.
 * Rate limiting and refusals cannot be triggered deterministically against the live API; they are
 * covered by src/modules/ai/anthropic.provider.test.ts (official SDK against a local API stub).
 */
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { aiBugAnalysisResponseSchema } from '@qtm/shared';
import { createApp } from '../src/app.js';
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from '../src/modules/ai/anthropic.provider.js';
import { createTestApp, registerAccount, resetDatabase, testPrisma } from '../tests/helpers.js';

const KEY = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = process.env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL;
// Explicit public endpoint: never inherit a proxy/base URL from the shell environment.
const BASE_URL = 'https://api.anthropic.com';
const SYNTHETIC_BUG =
  'Synthetic QA example: on the demo checkout page, clicking "Pay" with a valid test card shows a spinner forever. ' +
  'Browser console shows "TypeError: cannot read properties of undefined (reading token)". Happens in Chrome 130 on staging.';

if (!KEY) console.warn('[live] ANTHROPIC_API_KEY is not set — live Anthropic tests are SKIPPED (not verified).');

describe.skipIf(!KEY)('Anthropic live API', () => {
  it('end to end through the API route: structured result, quota accounting, no secrets in logs', { timeout: 120_000 }, async () => {
    await resetDatabase();
    const lines: string[] = [];
    const logger = pino({ level: 'debug' }, new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) }));
    const base = createTestApp();
    const provider = new AnthropicProvider(KEY, MODEL, { baseURL: BASE_URL });
    const app = createApp({ ...base.ctx, ai: provider, logger });
    const acc = await registerAccount(app, 'Live AI', 'Live AI Org');
    await acc.client.patch(`/api/organizations/${acc.orgId}`, { aiEnabled: true });

    const res = await acc.client.post(`/api/organizations/${acc.orgId}/ai/bug-analysis`, { description: SYNTHETIC_BUG });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ aiGenerated: true, provider: 'anthropic' });
    expect(aiBugAnalysisResponseSchema.safeParse(res.body.result).success).toBe(true);
    expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(res.body.result.suggestedSeverity);

    const usage = await testPrisma().aiRequest.findFirstOrThrow({ where: { userId: acc.userId } });
    expect(usage).toMatchObject({ success: true, provider: 'anthropic', feature: 'bug_analysis' });
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(KEY);
  });

  it('truncated output (tiny max_tokens) is reported as invalid output, not success', { timeout: 60_000 }, async () => {
    const provider = new AnthropicProvider(KEY, MODEL, { baseURL: BASE_URL });
    const error = await provider
      .complete({ system: 'You are a QA assistant.', prompt: SYNTHETIC_BUG, schema: aiBugAnalysisResponseSchema, maxTokens: 16 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'invalid_output' });
  });

  it('an invalid API key is mapped to "unavailable" without leaking the key', { timeout: 60_000 }, async () => {
    const fake = 'sk-ant-invalid-live-test-key-000000000000';
    const provider = new AnthropicProvider(fake, MODEL, { baseURL: BASE_URL });
    const error = await provider
      .complete({ system: 's', prompt: 'Synthetic QA ping.', schema: aiBugAnalysisResponseSchema, maxTokens: 64 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'unavailable', message: 'AI provider credentials are invalid' });
    expect(JSON.stringify(error)).not.toContain(fake);
  });

  it('a request exceeding the client timeout is mapped to "unavailable"', { timeout: 60_000 }, async () => {
    const provider = new AnthropicProvider(KEY, MODEL, { baseURL: BASE_URL, timeout: 1 });
    const error = await provider
      .complete({ system: 's', prompt: 'Synthetic QA ping.', schema: aiBugAnalysisResponseSchema, maxTokens: 64 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});

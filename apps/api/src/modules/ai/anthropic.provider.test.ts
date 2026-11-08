import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiBugAnalysisResponseSchema } from '@qtm/shared';
import { AiProviderError } from './ai.provider.js';
import { AnthropicProvider } from './anthropic.provider.js';

/**
 * Local stand-in for the Anthropic HTTP API (the external vendor). The real SDK runs against it,
 * so request building, retries and error classes are the SDK's own. This is not a live API test.
 */
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let replies: Reply[] = [];
let requests: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
let server: Server;
let baseURL = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      const reply = replies.shift() ?? { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no reply queued' } } };
      res.writeHead(reply.status, { 'content-type': 'application/json', 'retry-after': '0', ...reply.headers });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  replies = [];
  requests = [];
});

const analysis = {
  possibleCauses: ['Null token'],
  missingInformation: [],
  reproductionSuggestions: ['Retry with a new card'],
  suggestedSeverity: 'HIGH',
  suggestedPriority: 'MEDIUM',
  rationale: 'Payment blocked',
};
const message = (text: string, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 34 },
});
const apiError = (status: number, type: string) => ({ status, body: { type: 'error', error: { type, message: type } } });
const provider = () => new AnthropicProvider('sk-test-not-a-real-key', 'claude-opus-5-5', { baseURL, timeout: 5_000 });
const call = () => provider().complete({ system: 'sys', prompt: 'user input', schema: aiBugAnalysisResponseSchema, maxTokens: 1000 });

describe('AnthropicProvider (official SDK against a local API stub)', () => {
  it('sends a structured-output request and returns validated data with usage', async () => {
    replies.push({ status: 200, body: message(JSON.stringify(analysis)) });
    const result = await call();
    expect(result).toEqual({ data: analysis, model: 'claude-opus-5-5', inputTokens: 12, outputTokens: 34 });
    const sent = requests[0]!;
    // SDK 1.x sends the API key as a bearer token.
    expect(sent.headers.authorization).toBe('Bearer sk-test-not-a-real-key');
    expect(sent.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 1000, system: 'sys' });
    expect((sent.body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
  });

  it('maps a refusal to a refusal error', async () => {
    replies.push({ status: 200, body: message('', 'refusal') });
    await expect(call()).rejects.toMatchObject({ kind: 'refusal' });
  });

  it('treats truncated output (max_tokens) as invalid output', async () => {
    replies.push({ status: 200, body: message('{"possibleCauses": [', 'max_tokens') });
    await expect(call()).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('rejects well-formed JSON that violates the contract', async () => {
    replies.push({ status: 200, body: message(JSON.stringify({ ...analysis, suggestedSeverity: 'APOCALYPTIC' })) });
    await expect(call()).rejects.toBeInstanceOf(AiProviderError);
  });

  it.each([
    [429, 'rate_limit_error', 'rate_limited'],
    [401, 'authentication_error', 'unavailable'],
    [403, 'permission_error', 'unavailable'],
    [400, 'invalid_request_error', 'bad_request'],
    [529, 'overloaded_error', 'unavailable'],
  ])('maps HTTP %i to %s → %s', async (status, type, kind) => {
    // Retryable statuses are retried once by the SDK (maxRetries: 1), so queue two replies.
    replies.push(apiError(status, type), apiError(status, type));
    await expect(call()).rejects.toMatchObject({ kind });
  });

  it('retries a transient failure once and then succeeds', async () => {
    replies.push(apiError(529, 'overloaded_error'), { status: 200, body: message(JSON.stringify(analysis)) });
    await expect(call()).resolves.toMatchObject({ data: analysis });
    expect(requests).toHaveLength(2);
  });

  it('maps an unreachable provider to unavailable without leaking the key', async () => {
    const dead = new AnthropicProvider('sk-test-secret-value', 'claude-opus-5-5', { baseURL: 'http://127.0.0.1:1', timeout: 2_000 });
    const error = await dead.complete({ system: 's', prompt: 'p', schema: aiBugAnalysisResponseSchema, maxTokens: 10 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(String((error as Error).message)).not.toContain('sk-test-secret-value');
  });
});

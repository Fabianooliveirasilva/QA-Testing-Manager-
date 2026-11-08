import { afterEach, describe, expect, it, vi } from 'vitest';
import { passRateOf, progressOf } from '@/features/test-runs/run-utils';
import { ApiError, api, errorMessage } from './api';
import { formatBytes, formatDuration, humanize } from './format';

describe('format helpers', () => {
  it('humanizes enum values', () => {
    expect(humanize('IN_PROGRESS')).toBe('In progress');
    expect(humanize('CRITICAL')).toBe('Critical');
  });
  it('formats durations and sizes', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(6987)).toBe('7.0 s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('run utils (must mirror API pass-rate definition)', () => {
  it('ignores skipped/not-run and returns null without decisive results', () => {
    expect(passRateOf({ PASSED: 0, FAILED: 0, BLOCKED: 0 })).toBeNull();
    expect(passRateOf({ PASSED: 1, FAILED: 1, BLOCKED: 1 })).toBe(33.3);
  });
  it('computes progress over all results', () => {
    expect(progressOf({ PASSED: 1, FAILED: 0, BLOCKED: 0, SKIPPED: 1, NOT_RUN: 2, total: 4 })).toBe(50);
    expect(progressOf({ PASSED: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0, NOT_RUN: 0, total: 0 })).toBe(0);
  });
});

describe('api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'qtm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('sends the CSRF cookie value as header on mutations only', async () => {
    document.cookie = 'qtm_csrf=abc%2B123';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/x', { a: 1 });
    await api.get('/y', { q: 'test', empty: '' });
    const [postUrl, postInit] = fetchMock.mock.calls[0]!;
    expect(postUrl).toBe('/api/x');
    expect(postInit.headers['x-csrf-token']).toBe('abc+123');
    expect(postInit.body).toBe('{"a":1}');
    const [getUrl, getInit] = fetchMock.mock.calls[1]!;
    expect(getUrl).toBe('/api/y?q=test');
    expect(getInit.headers['x-csrf-token']).toBeUndefined();
  });

  it('turns API error envelopes into ApiError with field details', async () => {
    const body = { error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: [{ path: 'title', message: 'Required' }] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));
    const error = await api.post('/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect(errorMessage(error)).toBe('Invalid request data: title — Required');
  });

  it('reports network failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await api.get('/x').catch((e: unknown) => e);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api.delete('/x')).resolves.toBeUndefined();
  });
});

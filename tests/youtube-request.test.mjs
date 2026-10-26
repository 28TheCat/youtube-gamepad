import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { requestYouTube } = await importSettingsModel('src/sites/youtube-request.ts');
const ok = () => ({ ok: true, json: async () => ({ contents: [] }) });

test('transient failures retry once while retaining the same request', async t => {
  for (const failure of ['network', 502, 503, 504]) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        if (failure === 'network') throw new TypeError('offline');
        return { ok: false, status: failure };
      }
      return ok();
    });
    await requestYouTube('browse', { method: 'POST', body: '{"continuation":"same"}' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.body, calls[1].options.body);
    t.mock.restoreAll();
  }
});

test('permanent HTTP failures and malformed responses never retry', async t => {
  for (const response of [
    { ok: false, status: 401 }, { ok: false, status: 429 },
    ...[null, [], {}, { error: {} }, { unexpected: true }].map(raw => ({ ok: true, json: async () => raw })),
    { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }
  ]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return response; });
    await assert.rejects(requestYouTube('next', {}), error => ['http', 'response'].includes(error.kind));
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
});

test('timeout bounds both fetch and body reads even when transport ignores abort', async t => {
  for (const body of [false, true]) {
    let signal;
    t.mock.method(globalThis, 'fetch', (_url, options) => {
      signal = options.signal;
      return body ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    });
    await assert.rejects(requestYouTube('next', {}, 15), error => error.kind === 'timeout');
    assert.equal(signal.aborted, true);
    t.mock.restoreAll();
  }
});

test('cancellation before fetch and during retry prevents subsequent requests', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('offline'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestYouTube('search', { signal: controller.signal }), error => error.kind === 'cancelled');
  assert.equal(calls, 0);
  const active = new AbortController();
  const pending = requestYouTube('search', { signal: active.signal });
  await new Promise(resolve => setTimeout(resolve, 10)); active.abort();
  await assert.rejects(pending, error => error.kind === 'cancelled');
  assert.equal(calls, 1);
});

test('repeated transient failure stops after two attempts and unsafe endpoints never fetch', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('private message'); });
  await assert.rejects(requestYouTube('next', {}), error => error.kind === 'network' && !error.message.includes('private'));
  assert.equal(calls, 2);
  await assert.rejects(requestYouTube('like/like', {}));
  assert.equal(calls, 2);
});

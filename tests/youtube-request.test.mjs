import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { requestYouTube, mutateYouTube } = await importSettingsModel('src/sites/youtube-request.ts');
const ok = () => ({ ok: true, json: async () => ({ contents: [] }) });

test('requests use YouTube.js action normalization and retain page context and credentials', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, options }; return ok(); });
  const context = { client: { clientName: 'WEB', clientVersion: 'page', visitorData: 'visitor' }, user: {} };
  await requestYouTube('browse', { headers: { Authorization: 'captured', 'X-Goog-AuthUser': '2' },
    body: JSON.stringify({ context, token: 'cursor', parse: true }) });
  assert.equal(sent.url, '/youtubei/v1/browse');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(body.context, context);
  assert.equal(body.continuation, 'cursor');
  assert.equal(body.token, undefined);
  assert.equal(body.parse, undefined);
  assert.equal(body.skip_auth_check, undefined);
  assert.equal(sent.options.headers.authorization, 'captured');
  assert.equal(sent.options.headers['x-goog-authuser'], '2');
  assert.equal(sent.options.headers['x-goog-visitor-id'], 'visitor');
  assert.equal(sent.options.credentials, 'same-origin');
  assert.equal(sent.options.method, 'POST');
});

test('mutations use the shared client, never retry failures and enforce their endpoint list', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: false, status: 503 }; });
  await assert.rejects(mutateYouTube('like/like', {}), error => error.kind === 'http');
  assert.equal(calls, 1);
  await assert.rejects(mutateYouTube('browse', {}));
  assert.equal(calls, 1);
  for (const data of [{ success: false }, { error: {} }, null]) {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => data }));
    await assert.rejects(mutateYouTube('like/like', {}), error => error.kind === 'response');
  }
});

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

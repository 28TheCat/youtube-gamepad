import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { createShortsService } = await importSettingsModel('src/sites/youtube-shorts.ts');

function setup(t, respond) {
  if (!('window' in globalThis)) globalThis.window = undefined;
  if (!('document' in globalThis)) globalThis.document = undefined;
  t.mock.property(globalThis, 'window', { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' }, user: {} } : undefined } });
  t.mock.property(globalThis, 'document', { cookie: '' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const body = JSON.parse(options.body); calls.push({ path, body });
    return { ok: true, json: async () => respond(path, body, calls.length) };
  });
  const service = createShortsService(); t.after(service.destroy);
  return { service, calls };
}
const entries = ids => ids.map(videoId => ({ reelWatchEndpoint: { videoId } }));
test('Shorts API uses YouTube.js sequence encoding, paginates and strips duplicate or invalid video IDs', async t => {
  let sequence = 0;
  const { service, calls } = setup(t, path => path.endsWith('reel_item_watch') ? { playerResponse: { playabilityStatus: { status: 'OK' } } } : ++sequence === 1
    ? { entries: entries(['first', 'second', 'second', '../bad']), continuationEndpoint: { continuationCommand: { token: 'private-cursor', request: 'CONTINUATION_REQUEST_TYPE_REEL_WATCH_SEQUENCE' } } }
    : { entries: entries(['second', 'third']) });
  assert.deepEqual(await service.read('first'), { ids: ['second'], hasMore: true });
  assert.deepEqual(await service.read('second'), { ids: ['third'], hasMore: false });
  assert.deepEqual(await service.read('third'), { ids: [], hasMore: false });
  assert.equal(calls.filter(call => call.path.endsWith('reel_item_watch')).length, 1);
  const requests = calls.filter(call => call.path.endsWith('reel_watch_sequence'));
  assert.ok(requests[0].body.sequenceParams.length > 10);
  assert.equal(requests[1].body.sequenceParams, 'private-cursor');
});
test('Shorts API errors are retryable without advancing or poisoning the recommendation session', async t => {
  let fail = true;
  const { service } = setup(t, path => {
    if (path.endsWith('reel_item_watch')) return { playerResponse: {} };
    if (fail) throw new SyntaxError('invalid API response');
    return { entries: entries(['next']) };
  });
  await assert.rejects(service.read('first'));
  fail = false;
  assert.deepEqual(await service.read('first'), { ids: ['next'], hasMore: false });
});

test('resetting Shorts recommendations starts a new sequence even when revisiting a known video', async t => {
  let batch = 0;
  const { service, calls } = setup(t, path => path.endsWith('reel_item_watch') ? { playerResponse: {} }
    : { entries: entries([++batch === 1 ? 'second' : 'fresh']) });
  assert.deepEqual(await service.read('first'), { ids: ['second'], hasMore: false });
  assert.deepEqual(await service.read('first', true), { ids: ['fresh'], hasMore: false });
  assert.equal(calls.filter(call => call.path.endsWith('reel_item_watch')).length, 2);
});

test('concurrent reads share a request and a late cancelled sequence cannot replace its successor', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let first = true;
  const { service, calls } = setup(t, path => {
    if (path.endsWith('reel_item_watch')) return { playerResponse: {} };
    if (first) {
      first = false; entered();
      return new Promise(resolve => { release = () => resolve({ entries: entries(['stale']) }); });
    }
    return { entries: entries(['fresh']) };
  });
  const old = service.read('first');
  const shared = service.read('first');
  const oldRejected = assert.rejects(old), sharedRejected = assert.rejects(shared);
  await waiting;
  assert.equal(calls.filter(call => call.path.endsWith('reel_watch_sequence')).length, 1);
  assert.deepEqual(await service.read('different', true), { ids: ['fresh'], hasMore: false });
  release();
  await Promise.all([oldRejected, sharedRejected]);
  assert.deepEqual(await service.read('fresh'), { ids: [], hasMore: false });
});

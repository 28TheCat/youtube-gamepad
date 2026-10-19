import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { isShortsPlaybackRoute, readShortsQueue, shortsPlayerHref, prepareShortsIntent } = await importSettingsModel('src/shared/shorts-route.ts');

test('Shorts route markers do not take over ordinary video pages', t => {
  const saved = globalThis.location;
  t.after(() => { if (saved === undefined) delete globalThis.location; else globalThis.location = saved; });
  for (const [pathname, search, expected] of [
    ['/watch', '?v=one', false], ['/shorts/one', '', true], ['/watch', '?v=one&ytg_shorts=1', true],
    ['/watch', '?v=one', true], ['/watch', '?v=other', false], ['/', '?ytg_shorts=1', false]
  ]) { globalThis.location = { pathname, search }; assert.equal(isShortsPlaybackRoute(), expected); }
  assert.equal(shortsPlayerHref('one'), '/watch?v=one&ytg_shorts=1');
});

test('pending Shorts intent preserves the current Short until SPA navigation reaches its target', t => {
  const saved = globalThis.location;
  t.after(() => { if (saved === undefined) delete globalThis.location; else globalThis.location = saved; });
  globalThis.location = { pathname: '/watch', search: '?v=first&ytg_shorts=1' };
  assert.equal(isShortsPlaybackRoute(), true);
  prepareShortsIntent('second');
  assert.equal(isShortsPlaybackRoute(), true);
  globalThis.location.search = '?v=second';
  assert.equal(isShortsPlaybackRoute(), true);
  prepareShortsIntent('third'); prepareShortsIntent('');
  globalThis.location.search = '?v=third';
  assert.equal(isShortsPlaybackRoute(), false);
});

test('Shorts queues are bounded, deduplicated and cannot redirect outside YouTube', t => {
  const savedLocation = globalThis.location, savedStorage = globalThis.sessionStorage;
  t.after(() => {
    if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
    if (savedStorage === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = savedStorage;
  });
  globalThis.location = { origin: 'https://www.youtube.com' };
  const read = raw => { globalThis.sessionStorage = { getItem: () => raw }; return readShortsQueue(); };
  assert.deepEqual(read(JSON.stringify({ ids: ['first', 'first', 'second', '../bad', null], returnTo: '/feed/subscriptions' })), { ids: ['first', 'second'], returnTo: '/feed/subscriptions' });
  for (const returnTo of ['https://evil.test/', '//evil.test/', '/watch?v=one', '/shorts/one', null])
    assert.equal(read(JSON.stringify({ ids: ['first'], returnTo })).returnTo, '/');
  assert.deepEqual(read('invalid JSON'), { ids: [], returnTo: '/' });
  assert.deepEqual(read('x'.repeat(30001)), { ids: [], returnTo: '/' });
  assert.equal(read(JSON.stringify({ ids: Array.from({ length: 300 }, (_, i) => `short${i}`), returnTo: '/' })).ids.length, 200);
  globalThis.sessionStorage = { getItem() { throw new Error('blocked storage'); } };
  assert.deepEqual(readShortsQueue(), { ids: [], returnTo: '/' });
});

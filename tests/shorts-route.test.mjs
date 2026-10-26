import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { isShortsPlaybackRoute, readShortsQueue, shortsPlayerHref } = await importSettingsModel('src/shared/shorts-route.ts');

test('Shorts use their native route and never take over ordinary watch pages', t => {
  const saved = globalThis.location;
  t.after(() => { if (saved === undefined) delete globalThis.location; else globalThis.location = saved; });
  for (const [pathname, search, expected] of [
    ['/watch', '?v=one', false], ['/shorts/one', '', true], ['/watch', '?v=one&ytg_shorts=1', false],
    ['/shorts/', '', false], ['/shorts/one/more', '', false], ['/', '?ytg_shorts=1', false]
  ]) { globalThis.location = { pathname, search }; assert.equal(isShortsPlaybackRoute(), expected); }
  assert.equal(shortsPlayerHref('one'), '/shorts/one');
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
  assert.deepEqual(read(JSON.stringify({ ids: ['first', 'second'], currentId: 'first', returnTo: '/' })), { ids: ['first', 'second'], currentId: 'first', returnTo: '/' });
  assert.deepEqual(read(JSON.stringify({ ids: ['first'], currentId: 'other', returnTo: '/' })), { ids: ['first'], returnTo: '/' });
  for (const returnTo of ['https://evil.test/', '//evil.test/', '/watch?v=one', '/shorts/one', null])
    assert.equal(read(JSON.stringify({ ids: ['first'], returnTo })).returnTo, '/');
  assert.deepEqual(read('invalid JSON'), { ids: [], returnTo: '/' });
  assert.deepEqual(read('x'.repeat(30001)), { ids: [], returnTo: '/' });
  assert.equal(read(JSON.stringify({ ids: Array.from({ length: 300 }, (_, i) => `short${i}`), returnTo: '/' })).ids.length, 200);
  globalThis.sessionStorage = { getItem() { throw new Error('blocked storage'); } };
  assert.deepEqual(readShortsQueue(), { ids: [], returnTo: '/' });
});

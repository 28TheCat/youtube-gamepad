import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { createBrowseFeedController } = await importSettingsModel('src/app/browse-feed-controller.ts');
const { createNativeBrowsePager } = await importSettingsModel('src/app/browse-native-pager.ts');
const item = id => ({ id, title: id, channel: '', thumbnail: '', href: '/watch?v=' + id });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const store = { categories: [{ id: 'all', selected: true }, { id: 'music' }], category: '', loading: false, error: '' };
  const state = { route: '/', visible: true, restoring: false, focus: 0, loading: false, requests: [], cancellations: 0 };
  let render = () => Promise.resolve();
  const controller = createBrowseFeedController({ store,
    feed: { categories: () => [{ id: 'all', selected: true }, { id: 'music' }], cancel: () => state.cancellations++,
      request: (id, page) => { const pending = deferred(); state.requests.push({ id, page, ...pending }); return pending.promise; } },
    getRoute: () => state.route, isVisible: () => state.visible, isRestoring: () => state.restoring,
    stopBatch() {}, changed() {}, loadingChanged: value => { state.loading = value; },
    afterRender: () => render(), canResetFocus: () => true, resetFocus: () => state.focus++
  });
  async function load(id, ids, nextPage) {
    const pending = controller.changeCategory(id);
    state.requests.at(-1).resolve({ items: ids.map(item), nextPage });
    await pending;
  }
  return { store, state, controller, load, render: fn => { render = fn; } };
}

test('category switching ignores old successes and failures', async () => {
  const { store, state, controller } = fixture();
  const old = controller.changeCategory('all');
  const current = controller.changeCategory('music');
  state.requests[0].resolve({ items: [item('old')] }); await old;
  assert.equal(store.loading, true);
  assert.deepEqual(controller.snapshot.items, []);
  state.requests[1].resolve({ items: [item('new')] }); await current;
  const g = fixture();
  const failed = g.controller.changeCategory('all');
  const newer = g.controller.changeCategory('music');
  g.state.requests[0].reject(new Error('old error')); await failed;
  assert.equal(g.store.error, ''); assert.equal(g.store.loading, true);
  g.state.requests[1].resolve({ items: [item('latest')] }); await newer;
  assert.equal(g.controller.snapshot.items[0].id, 'latest');
});

test('category switches reuse recent pages and continuations without a new request', async () => {
  const f = fixture();
  await f.load('all', ['a'], 'all-next');
  await f.load('music', ['m'], 'music-next');
  await f.controller.changeCategory('all');
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.store.loading, false);
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['a']);
  const append = f.controller.changeCategory('all', true);
  assert.equal(f.state.requests.at(-1).page, 'all-next');
  f.state.requests.at(-1).resolve({ items: [item('b')], nextPage: 'all-third' }); await append;
  await f.controller.changeCategory('music');
  await f.controller.changeCategory('all');
  assert.equal(f.state.requests.length, 3);
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['a', 'b']);
});

test('repeated activation keeps pending requests and loaded categories intact', async () => {
  const f = fixture();
  const pending = f.controller.changeCategory('all');
  await f.controller.changeCategory('all');
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.cancellations, 1);
  f.state.requests[0].resolve({ items: [item('a')] }); await pending;
  await f.controller.changeCategory('all');
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.cancellations, 1);
});

test('ordinary switching refreshes expired cached categories', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  await f.load('all', ['old']);
  await f.load('music', ['m']);
  now += 120001;
  const pending = f.controller.changeCategory('all');
  assert.equal(f.state.requests.length, 3);
  f.state.requests.at(-1).resolve({ items: [item('fresh')] }); await pending;
  assert.equal(f.controller.snapshot.items[0].id, 'fresh');
});

test('pagination deduplicates videos, blocks duplicate loads and restores route-specific continuations', async () => {
  const f = fixture();
  await f.load('all', ['a'], 'page-2');
  const append = f.controller.changeCategory('all', true);
  await f.controller.changeCategory('all', true);
  await f.controller.changeCategory('music', true);
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.state.requests[1].page, 'page-2');
  f.state.requests[1].resolve({ items: [item('a'), item('b')], nextPage: 'page-3' }); await append;
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['a', 'b']);
  f.controller.reset(); f.state.route = '/feed/subscriptions';
  f.controller.initialize(); await Promise.resolve();
  f.state.requests.at(-1).resolve({ items: [item('subscription')] }); await Promise.resolve(); await Promise.resolve();
  f.controller.reset(); f.state.route = '/'; f.state.restoring = true;
  const focusBeforeRestore = f.state.focus;
  f.controller.initialize(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['a', 'b']);
  assert.equal(f.state.loading, false);
  assert.equal(f.state.focus, focusBeforeRestore, 'cached return preserves the restored focus');
  const resumed = f.controller.changeCategory('all', true);
  assert.equal(f.state.requests.at(-1).page, 'page-3');
  f.state.requests.at(-1).resolve({ items: [] }); await resumed;
});

test('changed routes and hidden surfaces reject late errors and post-render focus', async () => {
  for (const invalidate of [f => { f.state.route = '/other'; }, f => { f.state.visible = false; }]) {
    const f = fixture();
    const request = f.controller.changeCategory('all');
    invalidate(f); f.state.requests[0].reject(new Error('late')); await request;
    assert.equal(f.store.error, '');
    const g = fixture(), render = deferred(); g.render(() => render.promise);
    const success = g.controller.changeCategory('all');
    g.state.requests[0].resolve({ items: [item('a')] }); await Promise.resolve();
    invalidate(g); render.resolve(); await success;
    assert.equal(g.state.focus, 0);
  }
});

test('reset and destruction invalidate deferred initialization and in-flight data', async () => {
  const f = fixture(), render = deferred(); f.render(() => render.promise);
  f.store.categories = []; f.controller.initialize(); f.controller.reset();
  render.resolve(); await Promise.resolve();
  assert.equal(f.state.requests.length, 0);
  const g = fixture(); const request = g.controller.changeCategory('all');
  g.controller.destroy(); g.state.requests[0].resolve({ items: [item('late')] }); await request;
  assert.equal(g.controller.active, false); assert.equal(g.controller.snapshot, undefined);
  assert.equal(g.controller.initialize(), false);
  await g.controller.changeCategory('all'); assert.equal(g.state.requests.length, 1);
});

test('current request errors allow retry without losing existing continuation items', async () => {
  const f = fixture(); await f.load('all', ['a'], 'next');
  const append = f.controller.changeCategory('all', true);
  f.state.requests.at(-1).reject(new Error('failed')); await append;
  assert.ok(f.store.error); assert.equal(f.state.loading, false);
  const retry = f.controller.changeCategory('all', true);
  assert.equal(f.state.requests.at(-1).page, 'next');
  f.state.requests.at(-1).resolve({ items: [item('b')] }); await retry;
  assert.equal(f.store.error, ''); assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['a', 'b']);
});

test('native pager loads at most three pages and stops on route change, replacement or timeout', () => {
  function native() {
    let time = 10000, callback, calls = 0;
    let snapshot = { route: '/', items: [item('a')], canLoadMore: true };
    const pager = createNativeBrowsePager({ read: () => snapshot, loadMore: () => { calls++; return true; },
      canLoad: () => true, now: () => time, timeout: fn => { callback = fn; return 1; }, clearTimeout: () => { callback = undefined; } });
    return { pager, get calls() { return calls; }, get snapshot() { return snapshot; },
      poll: (next, advance = 1500) => { snapshot = next; time += advance; const fn = callback; callback = undefined; fn?.(); } };
  }
  const f = native(); f.pager.more(f.snapshot); f.pager.more(f.snapshot); assert.equal(f.calls, 1);
  for (const id of ['b', 'c', 'd']) f.poll({ ...f.snapshot, items: [...f.snapshot.items, item(id)] });
  assert.equal(f.calls, 3);
  for (const next of [{ route: '/other', items: [item('a'), item('b')] }, { route: '/', items: [item('b')] }]) {
    const g = native(); g.pager.more(g.snapshot); g.poll({ ...next, canLoadMore: true });
    g.poll({ ...next, items: [...next.items, item('c')], canLoadMore: true }); assert.equal(g.calls, 1);
  }
  const h = native(); h.pager.more(h.snapshot); h.poll(h.snapshot, 15001); h.poll(h.snapshot); assert.equal(h.calls, 1);
});

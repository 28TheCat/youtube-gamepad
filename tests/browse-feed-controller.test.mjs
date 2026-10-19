import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { createBrowseFeedController } = await importSettingsModel('src/app/browse-feed-controller.ts');
const item = id => ({ id, title: id, channel: '', thumbnail: '', href: '/watch?v=' + id });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const store = { categories: [{ id: 'all', selected: true }, { id: 'music' }], category: '', loading: false, error: '' };
  const state = { route: '/', visible: true, restoring: false, focus: 0, loading: false, requests: [], cancellations: 0, unavailable: 0 };
  let render = () => Promise.resolve();
  const controller = createBrowseFeedController({ store,
    feed: { categories: () => [{ id: 'all', selected: true }, { id: 'music' }], cancel: () => state.cancellations++,
      request: (id, page) => { const pending = deferred(); state.requests.push({ id, page, ...pending }); return pending.promise; } },
    unavailable: () => state.unavailable++,
    getRoute: () => state.route, isVisible: () => state.visible, isRestoring: () => state.restoring,
    changed() {}, loadingChanged: value => { state.loading = value; },
    afterRender: () => render(), canResetFocus: () => true, resetFocus: () => state.focus++
  });
  async function load(id, ids, nextPage) {
    const pending = controller.changeCategory(id);
    state.requests.at(-1).resolve({ items: ids.map(item), nextPage });
    await pending;
  }
  return { store, state, controller, load, render: fn => { render = fn; } };
}

test('navigation reset cancels requests while retaining the visible categories until route completion', async () => {
  const f = fixture();
  await f.load('all', ['home']);
  const categories = f.store.categories;
  const pending = f.controller.changeCategory('music');
  f.controller.reset(true);
  assert.equal(f.store.categories, categories);
  assert.equal(f.store.category, 'music');
  assert.equal(f.controller.active, false);
  f.state.requests.at(-1).resolve({ items: [item('stale')] });
  await pending;
  assert.equal(f.controller.snapshot, undefined);
  f.controller.reset();
  assert.deepEqual(f.store.categories, []);
  assert.equal(f.store.loading, false);
});

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

test('channel tab switches refresh controls rather than reuse another tab sort context', async () => {
  const f = fixture();
  f.state.route = '/@creator/videos';
  await f.load('all', ['a'], 'all-next');
  await f.load('music', ['m'], 'music-next');
  await f.load('all', ['fresh'], 'fresh-next');
  assert.equal(f.state.requests.length, 3);
  assert.equal(f.controller.snapshot.items[0].id, 'fresh');
  assert.equal(f.controller.captureReturnState(42).scrollTop, 42);
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

for (const route of ['/feed/subscriptions', '/@creator/videos', '/playlist?list=PLordinary'])
test(`${route} restores its own cached list and continuation through the shared controller`, async () => {
  const f = fixture();
  f.state.route = route;
  await f.load('all', ['first'], 'next');
  const append = f.controller.changeCategory('all', true);
  f.state.requests.at(-1).resolve({ items: [item('second')], nextPage: 'third' }); await append;
  f.controller.reset(); f.state.route = '/';
  f.controller.initialize(); await Promise.resolve();
  f.state.requests.at(-1).resolve({ items: [item('home')] }); await Promise.resolve(); await Promise.resolve();
  f.controller.reset(); f.state.route = route; f.state.restoring = true;
  const requestsBefore = f.state.requests.length, focusBefore = f.state.focus;
  f.controller.initialize(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.state.requests.length, requestsBefore);
  assert.equal(f.state.focus, focusBefore);
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['first', 'second']);
  const resumed = f.controller.changeCategory('all', true);
  assert.equal(f.state.requests.at(-1).page, 'third');
  f.state.requests.at(-1).resolve({ items: [item('third')] }); await resumed;
  assert.deepEqual(f.controller.snapshot.items.map(x => x.id), ['first', 'second', 'third']);
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



test('initial feed failure restores native access; pagination failure keeps loaded videos', async () => {
  const f = fixture();
  const initial = f.controller.changeCategory('all');
  f.state.requests[0].reject(new Error('unsupported response')); await initial;
  assert.equal(f.state.unavailable, 1);
  assert.equal(f.store.loading, false);
  await f.load('all', ['existing'], 'next');
  const append = f.controller.changeCategory('all', true);
  f.state.requests.at(-1).reject(new Error('network')); await append;
  assert.equal(f.state.unavailable, 1);
  assert.equal(f.controller.snapshot.items[0].id, 'existing');
});

test('stale feed failure cannot restore native mode over a newer route', async () => {
  const f = fixture();
  const pending = f.controller.changeCategory('all');
  f.state.route = '/feed/subscriptions';
  f.state.requests[0].reject(new Error('old')); await pending;
  assert.equal(f.state.unavailable, 0);
});

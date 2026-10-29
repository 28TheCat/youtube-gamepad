import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { saveBrowseReturn, readBrowseReturn, saveWatchReturn, readWatchReturn } = await importSettingsModel('src/app/browse-history.ts');
const { createBrowseFeedController } = await importSettingsModel('src/app/browse-feed-controller.ts');

const saved = () => ({ categories: [{ id: 'music', label: 'Music', selected: true }], category: 'music',
  snapshot: { route: '/', items: ['a', 'b'].map(id => ({ id, title: id, channel: '', thumbnail: '', href: '/watch?v=' + id })), canLoadMore: true },
  nextPage: 'page-3', activeItemId: 'b', scrollTop: 620 });

test('history snapshot survives structured cloning of Vue state and preserves YouTube fields', () => {
  const history = { state: { youtube: { index: 9 } }, replaceState(value) { this.state = structuredClone(value); } };
  saveBrowseReturn(history, reactive(saved()));
  assert.deepEqual(history.state.youtube, { index: 9 });
  assert.deepEqual(readBrowseReturn(history, '/'), { version: 1, ...saved() });
  assert.equal(readBrowseReturn(history, '/feed/subscriptions'), undefined);
  history.state.ytGamepadBrowseReturn.snapshot.items = null;
  assert.equal(readBrowseReturn(history, '/'), undefined);
  assert.doesNotThrow(() => saveBrowseReturn({ replaceState() { throw new Error('quota'); } }, saved()));
});

test('a new controller restores category, loaded pages, focus and continuation without a feed request', async () => {
  const state = saved();
  const store = { categories: [], category: '', loading: false, error: '',
    apply(value) { this.snapshot = value; }, select(id) { this.activeItemId = id; } };
  let requestedPage;
  const controller = createBrowseFeedController({ store,
    feed: { categories() { throw new Error('native categories not ready'); }, cancel() {},
      async request(category, page) { assert.equal(category, 'music'); requestedPage = page; return { items: [] }; } },
    restoreState: () => state, getRoute: () => '/', isVisible: () => true, isRestoring: () => false,
    changed() {}, loadingChanged() {}, afterRender: async () => {}, canResetFocus: () => false, resetFocus() {} });
  assert.equal(controller.initialize(), true);
  assert.equal(store.category, 'music');
  assert.equal(store.activeItemId, 'b');
  assert.deepEqual(controller.snapshot.items.map(item => item.id), ['a', 'b']);
  assert.equal(requestedPage, undefined);
  assert.deepEqual(controller.captureReturnState(620), state);
  await controller.changeCategory('music', true);
  assert.equal(requestedPage, 'page-3');
});


test('each history entry owns its watch focus even when the same video is visited twice', () => {
  const history = { state: { youtube: { index: 1 } }, replaceState(value) { this.state = structuredClone(value); } };
  const first = { route: '/watch?v=one', target: { region: 'controls', itemKey: 'channel', index: 3 }, tab: 0, scrollTop: 320 };
  saveWatchReturn(history, first);
  const entry = history.state;
  history.state = { youtube: { index: 2 } };
  const second = { ...first, target: { region: 'recommendations', itemKey: 'video-two', index: 7 }, scrollTop: 900 };
  saveWatchReturn(history, second);
  assert.deepEqual(readWatchReturn(history, first.route), second);
  history.state = entry;
  assert.deepEqual(readWatchReturn(history, first.route), first);
  assert.deepEqual(history.state.youtube, { index: 1 });
  assert.equal(readWatchReturn(history, '/watch?v=other'), undefined);
  history.state.ytGamepadWatchReturn.target.index = -1;
  assert.equal(readWatchReturn(history, first.route), undefined);
});

test('browse return snapshots retain playlist cards alongside videos', () => {
  const history = { state: {}, replaceState(value) { this.state = structuredClone(value); } };
  const state = saved();
  state.snapshot.items.push({ id: 'playlist:PLone', title: 'Playlist', channel: '', thumbnail: '', href: '/playlist?list=PLone' });
  saveBrowseReturn(history, state);
  assert.equal(readBrowseReturn(history, '/').snapshot.items.length, 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, disposePinia } from 'pinia';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { useBrowseStore } = await importSettingsModel('src/app/browse-store.ts');
const { browseIdentity, createYouTubeBrowseAdapter } = await importSettingsModel('src/sites/youtube-browse.ts');
const item = id => ({ id, title: id, channel: 'Channel', thumbnail: '', href: '/watch?v=' + id });

test('browse selection survives append and reorder, chooses a surviving neighbour on removal', () => {
  const pinia = createPinia();
  try {
    const store = useBrowseStore(pinia);
    const apply = ids => store.apply({ route: '/', items: ids.map(item), canLoadMore: true });
    apply(['a', 'b', 'c']); store.select('b');
    apply(['c', 'b', 'a', 'd']); assert.equal(store.activeItemId, 'b');
    apply(['c', 'a', 'd']); assert.equal(store.activeItemId, 'a');
    store.select('missing'); assert.equal(store.activeItemId, 'a');
    store.apply({ route: '/results?search_query=new', items: [item('new')], canLoadMore: false });
    assert.equal(store.activeItemId, 'new');
  } finally { disposePinia(pinia); }
});

test('browse identities deduplicate tracking URLs and reject unsafe destinations', () => {
  assert.equal(browseIdentity('/watch?v=a&tracking=x').id, browseIdentity('/watch?v=a').id);
  assert.equal(browseIdentity('/shorts/a').id, 'short:a');
  for (const href of ['javascript:alert(1)', 'https://other.example/watch?v=a', '/watch', '/channel/a'])
    assert.equal(browseIdentity(href), null);
});

test('adapter produces data only, retains native pagination and activates the current source', () => {
  let clicked = 0, paged = 0;
  let href = '/watch?v=a';
  const anchor = { isConnected: true, getAttribute: name => name === 'href' ? href : null,
    textContent: 'A', click: () => clicked++ };
  const card = { closest: () => null, querySelector: selector => selector.startsWith('a#') ? anchor :
    selector.startsWith('#video-title') ? { textContent: 'Video A' } : null };
  const sentinel = { scrollIntoView: () => paged++, querySelector: () => null };
  let nodes = [card, card];
  const page = { querySelectorAll: () => nodes, querySelector: () => sentinel };
  const doc = { querySelector: selector => selector === 'ytd-page-manager' ? page : sentinel };
  const previous = globalThis.location;
  globalThis.location = { pathname: '/', search: '' };
  try {
    const adapter = createYouTubeBrowseAdapter(doc);
    const snapshot = adapter.read();
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].title, 'Video A');
    assert.equal(snapshot.canLoadMore, true);
    assert.equal('anchor' in snapshot.items[0], false);
    assert.equal(adapter.open('video:a'), true); assert.equal(clicked, 1);
    href = '/watch?v=changed';
    assert.equal(adapter.open('video:a'), false, 'a recycled native source cannot activate a different video');
    assert.equal(adapter.loadMore(), true); assert.equal(paged, 1);
    nodes = []; adapter.read();
    assert.equal(adapter.open('video:a'), false);
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; }
});

test('browse thumbnails survive unloaded native images and prefer lazy-loading sources', () => {
  const fallback = 'https://i.ytimg.com/vi/late/hqdefault.jpg';
  const cases = [
    [null, fallback],
    [{ src: '' }, fallback],
    [{ src: 'data:image/gif;base64,placeholder' }, fallback],
    [{ src: 'https://www.youtube.com/' }, fallback],
    [{ src: 'data:image/gif;base64,placeholder', 'data-src': 'https://i.ytimg.com/vi/late/custom.jpg' }, 'https://i.ytimg.com/vi/late/custom.jpg'],
    [{ 'data-thumb': '//i.ytimg.com/vi/late/thumb.jpg' }, 'https://i.ytimg.com/vi/late/thumb.jpg'],
    [{ srcset: 'https://i.ytimg.com/vi/late/small.jpg 1x, https://i.ytimg.com/vi/late/large.jpg 2x' }, 'https://i.ytimg.com/vi/late/large.jpg'],
    [{ src: 'https://i.ytimg.com/vi/late/loaded.jpg' }, 'https://i.ytimg.com/vi/late/loaded.jpg'],
  ];
  const previous = globalThis.location;
  globalThis.location = { pathname: '/', search: '' };
  try {
    for (const [attributes, expected] of cases) {
      const image = attributes && { currentSrc: attributes.src || '', getAttribute: name => attributes[name] || null };
      const anchor = { getAttribute: name => name === 'href' ? '/watch?v=late' : null, textContent: 'Late video' };
      const card = { closest: () => null, querySelector: selector => selector.startsWith('a#thumbnail[href]') ? anchor :
        selector.includes('img') ? image : null };
      const page = { querySelectorAll: () => [card], querySelector: () => null };
      const snapshot = createYouTubeBrowseAdapter({ querySelector: () => page }).read();
      assert.equal(snapshot.items[0].thumbnail, expected, JSON.stringify(attributes));
      assert.equal(snapshot.items[0].thumbnailFallback, fallback);
    }
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; }
});

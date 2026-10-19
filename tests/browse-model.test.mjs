import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, disposePinia } from 'pinia';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { useBrowseStore } = await importSettingsModel('src/app/browse-store.ts');
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

import { defineStore } from 'pinia';
import { readonly, shallowRef } from 'vue';
import type { BrowseSnapshot } from '../sites/youtube-browse';
import type { FeedCategory } from '../sites/youtube-feed';

export const useBrowseStore = defineStore('browse', () => {
  const snapshot = shallowRef<BrowseSnapshot>({ route: '', items: [], canLoadMore: false });
  const activeItemId = shallowRef<string | null>(null);
  const categories = shallowRef<FeedCategory[]>([]);
  const category = shallowRef('');
  const loading = shallowRef(false);
  const error = shallowRef('');
  function apply(next: BrowseSnapshot) {
    const previous = snapshot.value;
    const ids = new Set(next.items.map(item => item.id));
    const selected = activeItemId.value;
    if (next.route !== previous.route) activeItemId.value = next.items[0]?.id || null;
    else if (!selected || !ids.has(selected)) {
      const index = previous.items.findIndex(item => item.id === selected);
      // Prefer a surviving neighbour's identity, never use a new array index as identity.
      const neighbours = [...previous.items.slice(index + 1), ...previous.items.slice(0, index).reverse()];
      activeItemId.value = neighbours.find(item => ids.has(item.id))?.id || next.items[0]?.id || null;
    }
    snapshot.value = next;
  }
  function select(id: string) {
    if (snapshot.value.items.some(item => item.id === id)) activeItemId.value = id;
  }
  return { snapshot: readonly(snapshot), activeItemId: readonly(activeItemId), apply, select,
    categories, category, loading, error };
});

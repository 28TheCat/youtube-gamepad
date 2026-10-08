import { h, render } from 'vue';
import SearchPanel from './SearchPanel.vue';
import type { MountSearch } from './search-view';

/** Synchronous patches preserve the menu's immediate gamepad focus contract. */
export const mountSearch: MountSearch = (container, view, actions, style) => {
  let disposed = false;
  const update = (snapshot: typeof view) => {
    if (!disposed) render(h(SearchPanel, { view: snapshot, actions, controllerStyle: style }), container);
  };
  update(view);
  return { update, dispose() { if (!disposed) { disposed = true; render(null, container); } } };
};

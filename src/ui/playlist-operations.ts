import type { SavedPlaylistSnapshot } from '../../types/ports';
import { createPanelOperation, type PanelOperationPort } from './panel-operation';

/** Ignore completions after closing a panel or changing its video. */
export function createPlaylistOperations(port: PanelOperationPort & {
  read(): Promise<readonly SavedPlaylistSnapshot[] | undefined>;
  toggle(key: string): Promise<boolean | undefined>;
}) {
  const state = { items: [] as readonly SavedPlaylistSnapshot[], loading: false, failed: false };
  const operation = createPanelOperation(port, state);
  return {
    state,
    reset() { operation.reset(); state.items = []; },
    async load() {
      await operation.run(() => port.read(), items => {
        if (!Array.isArray(items)) return false;
        state.items = items;
        return true;
      });
    },
    async toggle(key: string) {
      await operation.run(() => port.toggle(key), ok => {
        if (ok) state.items = state.items.map(item => item.key === key ? { ...item, selected: !item.selected } : item);
        return !!ok;
      });
    }
  };
}

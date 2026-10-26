import type { SavedPlaylistSnapshot } from '../../types/ports';

/** Ignore completions after closing a panel or changing its video. */
export function createPlaylistOperations(port: {
  read(): Promise<readonly SavedPlaylistSnapshot[] | undefined>;
  toggle(key: string): Promise<boolean | undefined>;
  active(): boolean;
  route(): string;
  changed(): void;
}) {
  const state = { items: [] as readonly SavedPlaylistSnapshot[], loading: false, failed: false };
  let version = 0;
  async function run(request: () => Promise<void>) {
    if (state.loading || !port.active()) return;
    const current = ++version, route = port.route();
    state.loading = true; state.failed = false; port.changed();
    try { await request(); } catch { if (current === version && route === port.route()) state.failed = true; }
    finally { if (current === version && route === port.route() && port.active()) { state.loading = false; port.changed(); } }
  }
  return {
    state,
    reset() { ++version; state.items = []; state.loading = false; state.failed = false; },
    load() {
      return run(async () => {
        const current = version, route = port.route(), items = await port.read();
        if (current !== version || route !== port.route() || !port.active()) return;
        state.failed = !Array.isArray(items); if (items) state.items = items;
      });
    },
    toggle(key: string) {
      return run(async () => {
        const current = version, route = port.route(), ok = await port.toggle(key);
        if (current !== version || route !== port.route() || !port.active()) return;
        state.failed = !ok;
        if (ok) state.items = state.items.map(item => item.key === key ? { ...item, selected: !item.selected } : item);
      });
    }
  };
}

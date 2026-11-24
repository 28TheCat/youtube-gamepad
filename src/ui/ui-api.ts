import type { PlaybackLayout } from '../shared/playback-layout';
export type UiTheme = 'light' | 'dark';
export type UiLayout = PlaybackLayout;
export type UiPanel = 'menu' | 'notifications' | 'account' | 'settings' | 'search' | 'description' | 'comments' | 'playlists' | 'subscription';
export interface BrowseUiState {
  mode: 'gamepad' | 'youtube'; busy: boolean; error: string; home: boolean; canRefreshHome: boolean;
}
interface BrowsePort {
  read(): BrowseUiState;
  refresh(): Result | Promise<Result>;
  change(mode: BrowseUiState['mode']): Result | Promise<Result>;
}
export type SecondaryWatchAction = 'channel' | 'subscribe' | 'description' | 'like' | 'dislike' | 'comments' | 'save' | 'mute' | 'settings' | 'collection';
export interface WatchMenuItem { id: SecondaryWatchAction; label: string; pressed?: boolean }
interface WatchActionsPort { read(): readonly WatchMenuItem[]; activate(action: SecondaryWatchAction): Result }
export interface UiSnapshot {
  readonly theme: UiTheme | undefined;
  readonly layout: UiLayout | undefined;
  readonly openPanels: readonly UiPanel[];
  readonly browse: BrowseUiState | undefined;
  readonly watchActions: readonly WatchMenuItem[];
}
type Result = boolean | void;
interface ValuePort<T> { read(): T; write(value: T): Result | Promise<Result> }
interface PanelPort { isOpen(): boolean; open(): Result; close(): Result }
interface Entry<T> { value: T; order: number }

/** Local ISOLATED API. Owners keep their state and DOM; registrations only
 * delegate commands to the current owner, and must be released on teardown. */
export function createUiApi() {
  const panels: readonly UiPanel[] = ['menu', 'notifications', 'account', 'settings', 'search', 'description', 'comments', 'playlists', 'subscription'];
  let destroyed = false, order = 0;
  const themes: Entry<ValuePort<UiTheme>>[] = [], layouts: Entry<ValuePort<UiLayout>>[] = [];
  const browseTargets: Entry<BrowsePort>[] = [];
  const watchTargets: Entry<WatchActionsPort>[] = [];
  const focusTargets = new Map<string, Entry<() => boolean>[]>();
  const panelTargets = new Map<UiPanel, Entry<PanelPort>[]>();
  let themeQueue = Promise.resolve(false), layoutQueue = Promise.resolve(false);
  function register<T>(entries: Entry<T>[], value: T) {
    if (destroyed) return () => {};
    const entry = { value, order: ++order }; entries.push(entry);
    return () => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); };
  }
  function bind<K, T>(map: Map<K, Entry<T>[]>, key: K, value: T) {
    if (destroyed) return () => {};
    const entries = map.get(key) || []; map.set(key, entries);
    const release = register(entries, value);
    return () => { release(); if (!entries.length && map.get(key) === entries) map.delete(key); };
  }
  const current = <T>(entries: Entry<T>[]) => destroyed ? undefined : entries.at(-1);
  async function write<T>(entries: Entry<ValuePort<T>>[], entry: Entry<ValuePort<T>> | undefined, value: T) {
    if (!entry || current(entries) !== entry) return false;
    try { const result = await entry.value.write(value); return current(entries) === entry && result !== false; }
    catch { return false; }
  }
  function read<T>(entries: Entry<{ read(): T }>[]) {
    try { return current(entries)?.value.read(); } catch { return undefined; }
  }
  async function browseCommand(command: 'refresh' | BrowseUiState['mode']) {
    const entry = current(browseTargets);
    if (!entry) return false;
    try {
      const state = entry.value.read();
      if (state.busy || command === 'refresh' && !state.canRefreshHome) return false;
      const result = command === 'refresh' ? await entry.value.refresh() : await entry.value.change(command);
      return current(browseTargets) === entry && result !== false;
    } catch { return false; }
  }
  function openEntries() {
    if (destroyed) return [];
    return [...panelTargets].flatMap(([id, entries]) => {
      const entry = current(entries);
      try { return entry?.value.isOpen() ? [{ id, entry }] : []; } catch { return []; }
    }).sort((a, b) => {
      const priority = (id: UiPanel) => id === 'menu' || id === 'settings' || id === 'search' ? 100 : id === 'account' || id === 'notifications' ? 50 : 0;
      return priority(a.id) - priority(b.id) || a.entry.order - b.entry.order;
    });
  }
  return {
    get state(): UiSnapshot { return { theme: read(themes), layout: read(layouts), browse: read(browseTargets), watchActions: read(watchTargets) || [], openPanels: openEntries().map(item => item.id) }; },
    registerTheme: (port: ValuePort<UiTheme>) => register(themes, port),
    registerLayout: (port: ValuePort<UiLayout>) => register(layouts, port),
    registerBrowse: (port: BrowsePort) => register(browseTargets, port),
    registerWatchActions: (port: WatchActionsPort) => register(watchTargets, port),
    performWatchAction(action: string): boolean {
      const entry = current(watchTargets);
      try {
        const item = entry?.value.read().find(item => item.id === action);
        return !!entry && !!item && entry.value.activate(item.id) !== false;
      } catch { return false; }
    },
    refreshHome: () => browseCommand('refresh'),
    setBrowseMode: (mode: BrowseUiState['mode']) => ['gamepad', 'youtube'].includes(mode) ? browseCommand(mode) : Promise.resolve(false),
    registerFocus: (id: string, focus: () => boolean) => bind(focusTargets, id, focus),
    registerPanel: (id: UiPanel, port: PanelPort) => bind(panelTargets, id, port),
    setTheme(value: UiTheme): Promise<boolean> {
      if (!['light', 'dark'].includes(value)) return Promise.resolve(false);
      const entry = current(themes);
      return themeQueue = themeQueue.then(() => write(themes, entry, value));
    },
    setLayout(value: UiLayout): Promise<boolean> {
      if (!['fullscreen', 'windowed'].includes(value)) return Promise.resolve(false);
      const entry = current(layouts);
      return layoutQueue = layoutQueue.then(() => write(layouts, entry, value));
    },
    focus(id: string): boolean {
      try { return current(focusTargets.get(id) || [])?.value() === true; } catch { return false; }
    },
    openPanel(id: UiPanel): boolean {
      if (!panels.includes(id)) return false;
      const entry = current(panelTargets.get(id) || []);
      if (!entry) return false;
      try {
        const ok = entry.value.open() !== false && entry.value.isOpen();
        if (ok) entry.order = ++order;
        return ok;
      } catch { return false; }
    },
    closePanel(id?: UiPanel): boolean {
      const entry = id ? current(panelTargets.get(id) || []) : openEntries().at(-1)?.entry;
      if (!entry) return false;
      try { if (!entry.value.isOpen()) return false; return entry.value.close() !== false && !entry.value.isOpen(); }
      catch { return false; }
    },
    destroy() { destroyed = true; themes.length = 0; layouts.length = 0; browseTargets.length = 0; watchTargets.length = 0; focusTargets.clear(); panelTargets.clear(); }
  };
}

export type UiApi = ReturnType<typeof createUiApi>;
// Module-private instance: never exposed through MAIN, page events or window.
export const ui = createUiApi();

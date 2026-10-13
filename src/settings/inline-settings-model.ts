import { videoGridDefaults, normalizeVideoGrid, type VideoGridSettings, type VideoGridKey } from '../shared/video-grid';
import { nextTick, reactive } from 'vue';
import { YTGamepadBindings as schema } from '../input/bindings.ts';
import { YTGamepadDiagnosticStore as diagnostics } from '../diagnostics/diagnostics-store.ts';
import { t, applyLanguage, languageDefault, normalizeLanguage, type UILanguage } from '../shared/i18n';

type Layout = 'watch' | 'browse';
type Category = '' | 'general' | 'display' | 'controller' | 'help';
type Bindings = Record<string, number>;
interface Settings extends VideoGridSettings {
  uiLanguage: UILanguage;
  enabled: boolean;
  rightHandMode: boolean;
  theater: boolean;
  autoFullscreen: boolean | null;
  deadzone: number;
  repeatDelay: number;
  repeatInterval: number;
  bindings: Bindings;
  bindingLayouts: Record<Layout, Bindings>;
}
export const categories = {
  general: 'General', display: 'Display & layout',
  controller: 'Gamepad & buttons', help: 'Help & diagnostics'
} as const;
export const physicalNames: Record<string, string> = {
  A: 'A / × · Bottom', B: 'B / ○ · Right', X: 'X / □ · Left', Y: 'Y / △ · Top',
  LB: 'LB / L1', RB: 'RB / R1', LT: 'LT / L2', RT: 'RT / R2',
  Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'Left stick press', R3: 'Right stick press'
};
export const positions: Record<string, [number, number]> = {
  A: [74.5, 46.75], B: [81, 37], X: [68, 37], Y: [74.5, 27.25],
  LB: [24, 16], RB: [76, 16], LT: [16, 7], RT: [84, 7],
  Select: [43.2, 36.5], Start: [56.8, 36.5], L3: [26.3, 36.5], R3: [63, 57.5]
};
export const adjustments = [
  { key: 'deadzone', label: 'Stick deadzone', min: .15, max: .75, step: .05, suffix: '' },
  { key: 'repeatDelay', label: 'Initial repeat delay', min: 150, max: 1000, step: 10, suffix: ' ms' },
  { key: 'repeatInterval', label: 'Repeat interval', min: 80, max: 500, step: 10, suffix: ' ms' }
] as const;
const defaults = {
  ...videoGridDefaults, uiLanguage: languageDefault, enabled: true, rightHandMode: false, theater: true, autoFullscreen: null, deadzone: .35,
  repeatDelay: 350, repeatInterval: 140, bindings: {}, bindingLayouts: null
};

export function createInlineSettingsModel(root: ShadowRoot, container: HTMLElement) {
  const state = reactive({
    values: null as Settings | null,
    category: '' as Category,
    bindingAction: '',
    layout: (location.pathname === '/watch' ? 'watch' : 'browse') as Layout,
    saving: false,
    family: document.documentElement.dataset.ytgController || 'generic',
    error: ''
  });
  let disposed = false, focusRevision = 0;
  const feedback = (text: string) => {
    if (disposed) return;
    const message = root.querySelector<HTMLElement>('#message');
    if (message) { message.setAttribute?.('data-ytg-text', text); message.textContent = t(text); }
  };
  const activeId = () => (root.activeElement as HTMLElement | null)?.dataset.setting;
  const ownsFocus = () => container.contains(root.activeElement);
  // Vue patches asynchronously. Restore by stable action ID after the patch,
  // invalidating queued restorations whenever the user changes levels/closes.
  async function focus(id?: string) {
    const revision = ++focusRevision;
    await nextTick();
    if (disposed || revision !== focusRevision || !container.isConnected) return;
    const controls = Array.from(container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const target = (id === undefined ? controls.find(button => button.closest?.('.settings-content')) : controls.find(button => button.dataset.setting === id)) || controls[0];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }
  function apply(stored: Record<string, unknown>) {
    const values: Settings = {
      ...defaults, ...normalizeVideoGrid(stored),
      uiLanguage: normalizeLanguage(stored.uiLanguage),
      bindings: schema.normalize(stored.bindings),
      bindingLayouts: schema.normalizeLayouts(stored.bindingLayouts, stored.bindings)
    };
    for (const key of ['enabled', 'theater', 'rightHandMode'] as const) {
      values[key] = typeof stored[key] === 'boolean' ? stored[key] : defaults[key];
    }
    values.autoFullscreen = typeof stored.autoFullscreen === 'boolean' ? stored.autoFullscreen : values.theater;
    for (const { key, min, max } of adjustments) {
      const value = stored[key];
      values[key] = typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value)) : defaults[key];
    }
    state.values = values;
    if (values.rightHandMode) state.bindingAction = '';
  }
  const currentBindings = () => state.values!.rightHandMode ? schema.rightHand : state.values!.bindingLayouts[state.layout];
  const bindingUpdate = (next: Bindings) => {
    const bindingLayouts = { ...state.values!.bindingLayouts, [state.layout]: next };
    return { bindingLayouts, bindings: bindingLayouts.watch };
  };
  async function save(next: Partial<Settings>, id: string, text = 'Settings saved.') {
    if (disposed || state.saving || !state.values) return;
    const revision = focusRevision, hadFocus = ownsFocus();
    state.saving = true;
    try {
      await chrome.storage.local.set(next);
      if (disposed) return;
      apply({ ...state.values, ...next });
      if (next.uiLanguage) applyLanguage(state.values!.uiLanguage);
      feedback(text);
    } catch { feedback('Could not save settings. Please try again.'); }
    finally {
      state.saving = false;
      if (!disposed && hadFocus && revision === focusRevision && (ownsFocus() || !root.activeElement)) void focus(id);
    }
  }
  function open(category: Exclude<Category, ''>) {
    if (state.saving) return;
    state.category = category;
    state.bindingAction = '';
    void focus(category === 'controller' ? `layout-${state.layout}` : undefined);
  }
  function selectLayout(layout: Layout) {
    if (state.saving) return;
    state.layout = layout; void focus(`layout-${layout}`);
  }
  function selectAction(action: string) {
    if (state.saving || state.values?.rightHandMode) return;
    state.bindingAction = action; void focus(String(currentBindings()[action]));
  }
  function back() {
    if (state.saving) return;
    const previous = state.bindingAction || state.category;
    if (state.bindingAction) state.bindingAction = '';
    else state.category = '';
    void focus(previous);
  }
  function toggle(key: 'enabled' | 'theater' | 'autoFullscreen' | 'rightHandMode') {
    if (state.values) void save({ [key]: !state.values[key] }, key);
  }
  function bind(index: number) {
    if (!state.values || state.values.rightHandMode || !state.bindingAction) return;
    const next = { ...currentBindings() }, previous = next[state.bindingAction];
    const conflict = Object.keys(next).find(action => action !== state.bindingAction && next[action] === index);
    if (conflict) next[conflict] = previous;
    next[state.bindingAction] = index;
    void save(bindingUpdate(next), String(index), conflict
      ? t('Saved. Swapped buttons with “{label}”.', { label: t(schema.labels[conflict]) }) : 'Button bindings saved.');
  }
  function adjust(item: typeof adjustments[number], delta: number, label: string) {
    if (!state.values) return;
    const value = Math.round(Math.min(item.max, Math.max(item.min, state.values[item.key] + delta)) * 100) / 100;
    void save({ [item.key]: value }, `${item.key}-${label}`);
  }
  async function clearDiagnostics() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ytg-clear-inline-diagnostics' });
      feedback(result?.ok ? 'Diagnostic records cleared.' : 'Could not clear records. Please try again.');
    } catch { feedback('Could not clear records. Please try again.'); }
  }
  async function exportDiagnostics() {
    let url: string | undefined;
    try {
      const saved = await chrome.storage.local.get(diagnostics.key);
      if (disposed) return;
      const entries = diagnostics.bounded(saved[diagnostics.key]);
      const report = { formatVersion: 1, extensionVersion: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(), entries };
      url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'youtube-gamepad-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove();
      feedback(t('Exported {count} records.', { count: entries.length }));
    } catch { feedback('Export failed. Please try again.'); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000); }
  }
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !state.values || disposed) return;
    const updates = Object.fromEntries(Object.entries(changes).filter(([key]) => key in defaults)
      .map(([key, change]) => [key, change.newValue ?? defaults[key as keyof typeof defaults]]));
    if (!Object.keys(updates).length) return;
    const id = activeId(), restore = ownsFocus();
    apply({ ...state.values, ...updates });
    if (restore && !state.saving) void focus(id);
  };
  const observer = new MutationObserver(() => {
    if (!disposed) state.family = document.documentElement.dataset.ytgController || 'generic';
  });
  async function start() {
    try {
      chrome.storage.onChanged.addListener(changed);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ytg-controller'] });
      const stored = await chrome.storage.local.get(defaults);
      if (disposed) return;
      apply(stored); void focus();
    } catch {
      if (disposed) return;
      state.error = 'Could not load settings. Close and reopen this menu to retry.';
      feedback(state.error);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ++focusRevision;
    observer.disconnect();
    try { chrome.storage.onChanged.removeListener(changed); }
    catch (error) {
      if (!/extension context invalidated/i.test(String((error as Error)?.message || error))) throw error;
    }
  }
  const layouts = [{ id: 'watch', label: schema.layouts.watch }, { id: 'browse', label: schema.layouts.browse }] as const;
  const actions = Object.keys(schema.labels);
  return { state, schema, layouts, actions, start, dispose, open, selectLayout, selectAction, back, toggle, bind, adjust,
    setLanguage: (language: UILanguage) => save({ uiLanguage: normalizeLanguage(language) }, `language-${language}`),
    clearDiagnostics, exportDiagnostics,
    saveGrid: (next: Partial<VideoGridSettings>, id: string) => save(next, id),
    resetGrid: () => save(Object.fromEntries(Object.entries(videoGridDefaults).filter(([key]) => key.startsWith("gridColumns"))), "resetVideoGrid"),
    reset: () => save(bindingUpdate({ ...schema.defaults }), 'resetBindings'),
    keyFor: (action: string) => schema.keys[currentBindings()[action]],
    actionFor: (key: string) => Object.keys(currentBindings()).find(action => schema.keys[currentBindings()[action]] === key)
  };
}

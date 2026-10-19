import { onMounted, onUnmounted } from 'vue';
import { YTGamepadControllerStyle } from '../input/controller-style.ts';

// Preserve the shared controller artwork and YouTube theme with a bounded lifecycle.
export function usePageAppearance() {
  const prompts = YTGamepadControllerStyle!;
  let stopped = false, revision = 0, source = 'system';
  let sheet: HTMLStyleElement, unregister: () => void;
  let interval: ReturnType<typeof setInterval>;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const validTheme = (value: unknown): value is 'dark' | 'light' => value === 'dark' || value === 'light';
  const apply = (theme: string) => {
    document.documentElement.toggleAttribute('dark', theme === 'dark');
    document.documentElement.setAttribute('data-ytg-theme-synced', '');
  };
  async function refresh() {
    const request = ++revision;
    let theme = system.matches ? 'dark' : 'light', nextSource = 'system';
    let pad: { id: string } | undefined = Array.from(navigator.getGamepads?.() || [])
      .find(value => value?.connected && value.mapping === 'standard') ?? undefined;
    try {
      const saved = await chrome.storage.local.get(['uiTheme', 'bindings']);
      if (validTheme(saved.uiTheme)) { theme = saved.uiTheme; nextSource = 'stored'; }
      if (!stopped && request === revision) prompts.configureBindings(saved.bindings);
    } catch { /* Storage or tab availability may change while the popup closes. */ }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'ytg-read-theme' });
        if (validTheme(result?.theme)) { theme = result.theme; nextSource = 'tab'; }
        if (!pad) {
          const state = await chrome.tabs.sendMessage(tab.id, { type: 'ytg-connection-status' });
          if (state?.connected && typeof state.controllerId === 'string') pad = { id: state.controllerId.slice(0, 256) };
        }
      }
    } catch { /* Fall back to the stored or system appearance outside YouTube. */ }
    if (!stopped && request === revision) { source = nextSource; apply(theme); prompts.use(pad); }
  }
  function changed(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area === 'local' && (changes.uiTheme || changes.bindings)) void refresh();
  }
  function systemChanged() { if (source === 'system') void refresh(); }
  onMounted(() => {
    apply(system.matches ? 'dark' : 'light');
    sheet = document.createElement('style'); sheet.textContent = prompts.css;
    document.head.append(sheet);
    unregister = prompts.register(document);
    for (const node of document.querySelectorAll<HTMLElement>('[data-ytg-hint]')) prompts.hint(node, node.getAttribute('data-ytg-hint') || '');
    system.addEventListener('change', systemChanged);
    chrome.storage.onChanged.addListener(changed);
    void refresh(); interval = setInterval(refresh, 1000);
  });
  onUnmounted(() => {
    stopped = true; clearInterval(interval); sheet?.remove(); unregister?.();
    system.removeEventListener('change', systemChanged);
    chrome.storage?.onChanged?.removeListener?.(changed);
  });
}

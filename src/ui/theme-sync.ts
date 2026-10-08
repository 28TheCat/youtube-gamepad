
// Extension-owned pages cannot inherit YouTube's html theme directly.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let version = 0, source = 'system';
  const valid = (value: unknown) => value === 'dark' || value === 'light';
  const apply = (value: string) => {
    document.documentElement.toggleAttribute('dark', value === 'dark');
    document.documentElement.setAttribute('data-ytg-theme-synced', '');
  };
  apply(system.matches ? 'dark' : 'light');
  async function refresh() {
    const request = ++version;
    let theme = system.matches ? 'dark' : 'light', nextSource = 'system';
    try {
      const saved = await chrome.storage.local.get(['uiTheme']);
      if (valid(saved.uiTheme)) { theme = saved.uiTheme; nextSource = 'stored'; }
    } catch (_) {}
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'ytg-read-theme' });
        if (valid(result?.theme)) { theme = result.theme; nextSource = 'tab'; }
      }
    } catch (_) {}
    if (request === version) { source = nextSource; apply(theme); }
  }
  system.addEventListener('change', () => { if (source === 'system') refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiTheme) refresh();
  });
  refresh();
})();

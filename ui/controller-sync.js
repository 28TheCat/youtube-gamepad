// Extension pages share the same local prompt artwork as the YouTube overlays.
(() => {
  const lifecycle = window.YTGamepadRuntime.scope('controller-page');
  const prompts = window.YTGamepadControllerStyle;
  const sheet = document.createElement('style'); sheet.textContent = prompts.css;
  document.head.append(sheet);
  lifecycle.cleanup(() => sheet.remove());
  lifecycle.cleanup(prompts.register(document));
  for (const node of document.querySelectorAll('[data-ytg-hint]')) prompts.hint(node, node.getAttribute('data-ytg-hint'));
  if (chrome.storage?.local) {
    const applyBindings = (changes, area) => {
      if (area === 'local' && changes.bindings) prompts.configureBindings(changes.bindings.newValue);
    };
    chrome.storage.onChanged.addListener(applyBindings);
    lifecycle.cleanup(() => chrome.storage.onChanged.removeListener?.(applyBindings));
    chrome.storage.local.get({ bindings: {} }).then(values => {
      if (!lifecycle.destroyed) prompts.configureBindings(values.bindings);
    }).catch(() => {});
  }
  let request = 0;
  async function refresh() {
    const version = ++request;
    let pad = Array.from(navigator.getGamepads?.() || []).find(value => value?.connected && value.mapping === 'standard');
    if (!pad) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) {
          const state = await chrome.tabs.sendMessage(tab.id, { type: 'ytg-connection-status' });
          if (state?.connected && typeof state.controllerId === 'string') pad = { id: state.controllerId.slice(0, 256) };
        }
      } catch (_) {}
    }
    if (version === request && !lifecycle.destroyed) prompts.use(pad);
  }
  refresh(); lifecycle.interval(refresh, 1000);
})();

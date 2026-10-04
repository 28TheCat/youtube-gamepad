// Window fullscreen belongs to the extension, not to a document or a video.
if (!globalThis.YTGamepadDiagnosticStore) importScripts('diagnostics-store.js');
let diagnosticQueue = Promise.resolve();
const diagnosticRates = new Map();
const stateKey = 'ytg-fullscreen-windows';
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch(error => console.warn('YouTube Gamepad fullscreen:', error));
  return result;
}
async function records() {
  return (await chrome.storage.session.get(stateKey))[stateKey] || {};
}
async function save(states) { await chrome.storage.session.set({ [stateKey]: states }); }
async function restore(windowId, states) {
  const previous = states[windowId];
  if (!previous) return;
  try {
    const current = await chrome.windows.get(Number(windowId));
    // Do not overwrite a user's subsequent manual window change.
    if (current.state === 'fullscreen') await chrome.windows.update(Number(windowId), { state: previous.state });
  } finally {
    delete states[windowId];
    await save(states);
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'ytg-diagnostic') {
    if (sender.frameId !== 0 || !sender.tab || !sender.url?.startsWith('https://www.youtube.com/')) return;
    const now = Date.now(), id = sender.tab.id;
    const rate = diagnosticRates.get(id);
    if (rate && now - rate.since < 60000 && rate.count >= 100) return;
    // Bound the limiter itself even when many tabs are opened.
    for (const [tab, value] of diagnosticRates) if (now - value.since >= 60000) diagnosticRates.delete(tab);
    if (!diagnosticRates.has(id) && diagnosticRates.size >= 100) return;
    diagnosticRates.set(id, { since: diagnosticRates.get(id)?.since ?? now, count: (diagnosticRates.get(id)?.count ?? 0) + 1 });
    const store = globalThis.YTGamepadDiagnosticStore;
    const entry = store.normalize(message.entry, chrome.runtime.getManifest().version, now);
    if (!entry) return;
    diagnosticQueue = diagnosticQueue.catch(() => {}).then(async () => {
      const saved = await chrome.storage.local.get(store.key);
      await chrome.storage.local.set({ [store.key]: store.bounded([...store.bounded(saved[store.key]), entry]) });
    });
    diagnosticQueue.then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (message?.type === 'ytg-open-settings') {
    if (sender.frameId !== 0 || !sender.tab?.active || !sender.url?.startsWith('https://www.youtube.com/')) return;
    chrome.runtime.openOptionsPage().then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== 'ytg-controller-connection' || typeof message.connected !== 'boolean') return;
  if (sender.frameId !== 0 || !sender.tab || !sender.url?.startsWith('https://www.youtube.com/')) return;
  const { windowId, id: tabId } = sender.tab;
  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) return;
  enqueue(async () => {
    const states = await records();
    const settings = await chrome.storage.local.get({ enabled: true, theater: true, autoFullscreen: null });
    if (!settings.enabled || !(settings.autoFullscreen ?? settings.theater)) { await restore(windowId, states); return; }
    if (!message.connected) {
      if (states[windowId]?.tabId === tabId) await restore(windowId, states);
      return;
    }
    // Let the bridge retry after tab activation instead of caching a skipped request.
    if (!sender.tab.active) return false;
    const current = await chrome.windows.get(windowId);
    if (states[windowId]) {
      // A reload or B return must not replace the original window state.
      if (current.state !== 'fullscreen') { delete states[windowId]; await save(states); }
      return;
    }
    // Fullscreen already enabled by the user stays under their control.
    if (current.state === 'fullscreen') return;
    states[windowId] = { state: current.state === 'maximized' ? 'maximized' : 'normal', tabId };
    await save(states);
    try { await chrome.windows.update(windowId, { state: 'fullscreen' }); }
    catch (error) { delete states[windowId]; await save(states); throw error; }
  }).then(applied => reply({ ok: true, retry: applied === false }), error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.enabled && !changes.theater && !changes.autoFullscreen)) return;
  enqueue(async () => {
    const settings = await chrome.storage.local.get({ enabled: true, theater: true, autoFullscreen: null });
    if (settings.enabled && (settings.autoFullscreen ?? settings.theater)) return;
    const states = await records();
    for (const id of Object.keys(states)) await restore(id, states);
  });
});
chrome.tabs.onRemoved.addListener(tabId => enqueue(async () => {
  const states = await records();
  for (const id of Object.keys(states)) if (states[id].tabId === tabId) await restore(id, states);
}));
chrome.windows.onRemoved.addListener(windowId => enqueue(async () => {
  const states = await records(); delete states[windowId]; await save(states);
}));

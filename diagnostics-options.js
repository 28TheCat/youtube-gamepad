(() => {
  const store = globalThis.YTGamepadDiagnosticStore;
  const status = document.querySelector('#diagnosticStatus');
  const exportButton = document.querySelector('#exportDiagnostics');
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    let url;
    try {
      const saved = await chrome.storage.local.get(store.key);
      const entries = store.bounded(saved[store.key]);
      const report = { formatVersion: 1, extensionVersion: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(), entries };
      url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'youtube-gamepad-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove();
      status.textContent = `Exported ${entries.length} ${entries.length === 1 ? 'record' : 'records'}`;
    } catch (_) { status.textContent = 'Export failed. Please try again.'; }
    finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportButton.disabled = false;
    }
  });
  document.querySelector('#clearDiagnostics').addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ytg-clear-diagnostics' });
      if (!result?.ok) throw new Error('clear failed');
      status.textContent = 'Diagnostic records cleared';
    }
    catch (_) { status.textContent = 'Could not clear records. Please try again.'; }
  });
})();

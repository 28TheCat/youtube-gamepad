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
      status.textContent = `已导出 ${entries.length} 条记录`;
    } catch (_) { status.textContent = '导出失败，请重试'; }
    finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportButton.disabled = false;
    }
  });
  document.querySelector('#clearDiagnostics').addEventListener('click', async () => {
    try { await chrome.storage.local.remove(store.key); status.textContent = '诊断记录已清空'; }
    catch (_) { status.textContent = '清空失败，请重试'; }
  });
})();

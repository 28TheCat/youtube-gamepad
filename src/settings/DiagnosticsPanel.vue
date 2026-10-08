<script setup lang="ts">
import { ref } from 'vue';
import { YTGamepadDiagnosticStore } from '../diagnostics/diagnostics-store.ts';
const store = YTGamepadDiagnosticStore;
const status = ref(''), exporting = ref(false), clearing = ref(false);
async function exportDiagnostics() {
  exporting.value = true;
  let url: string | undefined;
  try {
    const saved = await chrome.storage.local.get(store.key);
    const entries = store.bounded(saved[store.key]);
    const report = { formatVersion: 1, extensionVersion: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), entries };
    url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `youtube-gamepad-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove();
    status.value = `Exported ${entries.length} ${entries.length === 1 ? 'record' : 'records'}`;
  } catch { status.value = 'Export failed. Please try again.'; }
  finally { if (url) { const resource = url; setTimeout(() => URL.revokeObjectURL(resource), 1000); } exporting.value = false; }
}
async function clearDiagnostics() {
  clearing.value = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ytg-clear-diagnostics' });
    if (!result?.ok) throw new Error('clear failed');
    status.value = 'Diagnostic records cleared';
  } catch { status.value = 'Could not clear records. Please try again.'; }
  finally { clearing.value = false; }
}
</script>
<template>
  <div class="section-heading"><h2 id="diagnosticsTitle">Local diagnostics</h2><p>Keeps recent errors locally, up to 100 records and 32,768 characters. Older records are removed when these limits are reached. Export them to review or share.</p></div>
  <p>Records include the time, extension version, module, error, stack trace, and interface state. Video titles, comments, and full page addresses are excluded. URLs in error text are hidden.</p>
  <div class="diagnostic-actions"><button id="exportDiagnostics" type="button" :disabled="exporting || clearing" @click="exportDiagnostics">Export diagnostics JSON</button><button id="clearDiagnostics" type="button" :disabled="exporting || clearing" @click="clearDiagnostics">Clear diagnostic records</button></div>
  <output id="diagnosticStatus" role="status" aria-live="polite">{{ status }}</output>
</template>

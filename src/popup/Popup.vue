<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '../settings/store';
import { usePageAppearance } from '../shared/page-appearance';
const settings = useSettingsStore();
usePageAppearance();
const connection = ref('Checking connection…');
let stopped = false, refreshing = false;
let interval: ReturnType<typeof setInterval>;
async function openSettings() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'ytg-open-inline-settings' });
    if (!result?.ok) throw new Error('YouTube unavailable');
    window.close();
  } catch { settings.feedback('Open a YouTube tab, then open settings here.'); }
}
async function refreshConnection() {
  if (refreshing || stopped) return;
  refreshing = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const state = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'ytg-connection-status' });
    if (!stopped) connection.value = state?.connected ? 'Gamepad connected (standard layout)' : 'No gamepad detected. Press a gamepad button on YouTube.';
  } catch { if (!stopped) connection.value = 'Open YouTube to check your gamepad connection'; }
  finally { refreshing = false; }
}
onMounted(() => {
  chrome.storage.onChanged.addListener(settings.changed);
  void settings.initialize(); void refreshConnection();
  interval = setInterval(refreshConnection, 1000);
});
onUnmounted(() => {
  stopped = true; clearInterval(interval);
  chrome.storage.onChanged.removeListener(settings.changed); settings.dispose();
});
</script>

<template>
<header><span class="brand-mark" aria-hidden="true">▶</span><div><h1>YouTube Gamepad</h1><p class="tagline">YouTube from your couch</p></div></header>
<label class="toggle"><span>Enable gamepad controls</span><input id="enabled" type="checkbox" :checked="settings.values.enabled" :disabled="!settings.ready || settings.saving" @change="settings.save('enabled', $event)"></label>
<section class="connection-card" aria-labelledby="connectionTitle"><h2 id="connectionTitle">Connection status</h2><p id="connection" role="status">{{ connection }}</p></section>
<p class="quick-guide" data-ytg-hint="A Confirm · B Back · Start Menu">A Confirm · B Back · Start Menu</p>
<button id="moreSettings" type="button" @click="openSettings">Open settings on YouTube</button>
<output id="status" role="status" :hidden="!settings.statusVisible">{{ settings.status }}</output>
</template>

<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useSettingsStore } from './store';
import type { SettingKey } from '../shared/settings';
import { usePageAppearance } from '../shared/page-appearance';
import BindingsPanel from './BindingsPanel.vue';
import VideoGridSettings from './VideoGridSettings.vue';
import { videoGridDefaults } from '../shared/video-grid';
import DiagnosticsPanel from './DiagnosticsPanel.vue';
import CategorySettings from './CategorySettings.vue';
import GamepadTestPanel from './GamepadTestPanel.vue';
const settings = useSettingsStore();
function resetGridColumns() { void settings.saveValues(Object.fromEntries(Object.entries(videoGridDefaults).filter(([key]) => key.startsWith("gridColumns")))); }
usePageAppearance();
const aliases: Record<string, string> = { general: 'general', display: 'display', shortcuts: 'controller', gamepad: 'controller', gamepadTest: 'test', diagnostics: 'help', connectionHelp: 'help' };
const category = ref(aliases[location.hash.slice(1)] || 'general');
const deadzonePreview = ref(settings.values.deadzone);
watch(() => settings.values.deadzone, value => { deadzonePreview.value = value; });
function previewDeadzone(event: Event) { deadzonePreview.value = Number((event.target as HTMLInputElement).value); }
async function saveSetting(key: SettingKey, event: Event) {
  await settings.save(key, event);
  deadzonePreview.value = settings.values.deadzone;
}
function showCategory() { category.value = aliases[location.hash.slice(1)] || 'general'; }
function navigate(event: KeyboardEvent) {
  const links = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLAnchorElement>('[data-category-link]'));
  const index = links.indexOf(event.target as HTMLAnchorElement);
  if (index < 0) return;
  let next: number;
  if (event.key === 'ArrowDown') next = (index + 1) % links.length;
  else if (event.key === 'ArrowUp') next = (index + links.length - 1) % links.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = links.length - 1;
  else return;
  event.preventDefault(); links[next]?.focus();
}
onMounted(() => {
  window.addEventListener('hashchange', showCategory);
  chrome.storage.onChanged.addListener(settings.changed);
  void settings.initialize();
});
onUnmounted(() => {
  window.removeEventListener('hashchange', showCategory);
  chrome.storage?.onChanged?.removeListener?.(settings.changed);
  settings.dispose();
});
</script>

<template>
<main>
<header class="page-header"><div><p class="eyebrow">{{ t("YouTube Gamepad · Preferences") }}</p><h1>{{ t("Make your gamepad feel at home") }}</h1><p>{{ t("Customize your YouTube experience, from layout to button bindings.") }}</p></div><span class="save-badge">{{ t("Changes saved automatically") }}</span></header>
<div class="settings-layout">
<nav @keydown="navigate" class="settings-navigation" :aria-label="t('Settings categories')"><p class="navigation-label">{{ t("Preferences") }}</p><a href="#general" data-category-link="general" :aria-current="category === 'general' ? 'page' : undefined" aria-controls="general">{{ t("General") }}<span>{{ t("Controls and getting started") }}</span></a><a href="#display" data-category-link="display" :aria-current="category === 'display' ? 'page' : undefined" aria-controls="display">{{ t("Display & layout") }}<span>{{ t("TV layout and fullscreen") }}</span></a><a href="#shortcuts" data-category-link="controller" :aria-current="category === 'controller' ? 'page' : undefined" aria-controls="shortcuts gamepad">{{ t("Gamepad & buttons") }}<span>{{ t("Bindings and sensitivity") }}</span></a><a href="#gamepadTest" data-category-link="test" :aria-current="category === 'test' ? 'page' : undefined" aria-controls="gamepadTest">{{ t("Gamepad test") }}<span>{{ t("Detection, buttons and stick drift") }}</span></a><a href="#connectionHelp" data-category-link="help" :aria-current="category === 'help' ? 'page' : undefined" aria-controls="connectionHelp diagnostics">{{ t("Help & diagnostics") }}<span>{{ t("Connection help and error records") }}</span></a></nav>
<div class="settings-content"><form @submit.prevent><fieldset :disabled="!settings.ready || settings.saving">
<section id="general" data-category="general" aria-labelledby="generalTitle" :hidden="category !== 'general'">
<div class="section-heading"><h2 id="generalTitle">{{ t("General") }}</h2><p>{{ t("Turn gamepad controls on or off.") }}</p></div>
<div class="setting-row">
  <div class="setting-copy"><label for="uiLanguage">{{ t('Interface language') }}</label><p>{{ t('Language changes apply immediately and save automatically.') }}</p></div>
  <select id="uiLanguage" :value="settings.values.uiLanguage" @change="settings.saveValues({ uiLanguage: ($event.target as HTMLSelectElement).value === 'zh-CN' ? 'zh-CN' : 'en' })">
    <option value="en">{{ t("English") }}</option><option value="zh-CN">简体中文</option>
  </select>
</div>
<div class="setting-row">
<div class="setting-copy"><label for="enabled">{{ t("Enable gamepad controls") }}</label><p id="enabledHelp">{{ t("Browse videos, control playback, and open the quick menu with your gamepad.") }}</p></div>
<input class="toggle" id="enabled" :checked="settings.values.enabled" @change="saveSetting('enabled', $event)" type="checkbox" aria-describedby="enabledHelp">
</div>
<details class="help"><summary>{{ t("How to use gamepad controls") }}</summary><div class="help-content"><p>{{ t("Turning off gamepad controls restores the YouTube interface.") }}</p><p :data-ytg-hint="t('During playback, press Start to open the quick menu to search, toggle captions, adjust volume, or open all settings.')">{{ t("During playback, press Start to open the quick menu to search, toggle captions, adjust volume, or open all settings.") }}</p></div></details>
</section>
<section id="display" data-category="display" aria-labelledby="displayTitle" :hidden="category !== 'display'">
<div class="section-heading"><h2 id="displayTitle">{{ t("Display & layout") }}</h2><p>{{ t("Make YouTube easier to use from a distance. Enable either option independently.") }}</p></div>
<div class="setting-row">
<div class="setting-copy"><label for="theater">{{ t("TV layout") }}</label><p id="layoutHelp">{{ t("Use a client-style home with a navigation sidebar, large video cards and TV playback controls when a gamepad is detected.") }}</p></div>
<input class="toggle" id="theater" :checked="settings.values.theater" @change="saveSetting('theater', $event)" type="checkbox" aria-describedby="layoutHelp">
</div>
<div class="setting-row">
<div class="setting-copy"><label for="autoFullscreen">{{ t("Enter fullscreen when a gamepad is detected") }}</label><p id="fullscreenHelp">{{ t("Make the browser window fullscreen to hide its tabs and address bar.") }}</p></div>
<input class="toggle" id="autoFullscreen" :checked="settings.values.autoFullscreen" @change="saveSetting('autoFullscreen', $event)" type="checkbox" aria-describedby="fullscreenHelp fullscreenDetails">
</div>
<VideoGridSettings :values="settings.values" :disabled="!settings.ready || settings.saving" @save="settings.saveValues" @reset="resetGridColumns" />
<div class="setting-row">
  <div class="setting-copy"><label for="playbackLayout">{{ t('Default playback layout') }}</label><p>{{ t('Choose the gamepad playback layout. Mouse and keyboard use the windowed gamepad interface. Browser fullscreen is separate.') }}</p></div>
  <select id="playbackLayout" :value="settings.values.playbackLayout" @change="settings.saveValues({ playbackLayout: ($event.target as HTMLSelectElement).value as 'fullscreen' | 'windowed' })">
    <option value="fullscreen">{{ t('Fullscreen gamepad') }}</option><option value="windowed">{{ t('Windowed gamepad') }}</option>
  </select>
</div>
<details class="help"><summary>{{ t("TV layout and fullscreen explained") }}</summary><div class="help-content" id="fullscreenDetails"><p>{{ t("TV layout changes the YouTube page. Automatic fullscreen expands the browser window containing the current YouTube tab, like pressing F11.") }}</p><p>{{ t("Disconnecting the gamepad, turning off automatic fullscreen, or disabling the extension restores the previous window state. Fullscreen entered manually stays active.") }}</p><p>{{ t("The page-filling video layout is also independent of browser fullscreen.") }}</p></div></details>
<CategorySettings />
</section>
<section id="shortcuts" data-category="controller" :hidden="category !== 'controller'" aria-labelledby="shortcutsTitle"><BindingsPanel /></section>
<section id="gamepad" data-category="controller" aria-labelledby="gamepadTitle" :hidden="category !== 'controller'">
<div class="section-heading"><h2 id="gamepadTitle">{{ t("Input sensitivity") }}</h2><p>{{ t("Start using your gamepad as soon as it connects. Adjust sensitivity if needed.") }}</p></div>
<details class="advanced">
<summary><span>{{ t("Advanced settings") }}<span class="summary-hint">{{ t("Stick deadzone and hold-to-repeat speed") }}</span></span></summary>
<div class="advanced-content">
<div class="setting-row parameter-row">
<div class="setting-copy"><label for="deadzone">{{ t("Stick deadzone") }}</label><p id="deadzoneHelp">{{ t("Higher values require more stick movement and help prevent accidental input from drift.") }}</p></div>
<div class="range-control"><output id="deadzoneValue" for="deadzone">{{ deadzonePreview }}</output><input id="deadzone" @input="previewDeadzone" :value="settings.values.deadzone" @change="saveSetting('deadzone', $event)" type="range" min="0.15" max="0.75" step="0.05" aria-describedby="deadzoneHelp"></div>
</div>
<div class="setting-row parameter-row">
<div class="setting-copy"><label for="repeatDelay">{{ t("Initial repeat delay") }}</label><p id="delayHelp">{{ t("How long to wait before repeating a held direction.") }}</p><span class="constraint" id="delayRange">{{ t("Range: 150–1000 ms") }}</span></div>
<div class="number-control"><input id="repeatDelay" :value="settings.values.repeatDelay" @change="saveSetting('repeatDelay', $event)" type="number" min="150" max="1000" step="10" required aria-describedby="delayHelp delayRange"><span aria-hidden="true">ms</span></div>
</div>
<div class="setting-row parameter-row">
<div class="setting-copy"><label for="repeatInterval">{{ t("Repeat interval") }}</label><p id="intervalHelp">{{ t("Time between repeated movements. Lower values move faster.") }}</p><span class="constraint" id="intervalRange">{{ t("Range: 80–500 ms") }}</span></div>
<div class="number-control"><input id="repeatInterval" :value="settings.values.repeatInterval" @change="saveSetting('repeatInterval', $event)" type="number" min="80" max="500" step="10" required aria-describedby="intervalHelp intervalRange"><span aria-hidden="true">ms</span></div>
</div>
</div></details>
</section>
</fieldset></form>
<GamepadTestPanel v-if="category === 'test'" />
<section id="connectionHelp" data-category="help" aria-labelledby="connectionTitle" :hidden="category !== 'help'">
<div class="section-heading"><h2 id="connectionTitle">{{ t("Connection and controls") }}</h2><p>{{ t("Connect a standard-layout gamepad, click the YouTube page, then press a gamepad button.") }}</p></div>
<p :data-ytg-hint="t('D-pad / left stick: Select. A Confirm, B Back, Start Quick menu.')">{{ t("D-pad / left stick: Select. A Confirm, B Back, Start Quick menu.") }}</p>
<p>{{ t('During playback, hold the right stick button (R3) for temporary 2× speed. Release to restore your previous speed. Unavailable when R3 is assigned another playback action.') }}</p>
<details class="help"><summary>{{ t("Gamepad not responding?") }}</summary><div class="help-content"><p>{{ t("Check that your gamepad is connected and gamepad controls are enabled under General. Return to YouTube, click the page, then press a gamepad button.") }}</p><p><a href="#gamepadTest">{{ t('Open gamepad detection & calibration') }}</a></p><p>{{ t("If the issue persists, export the local diagnostic records below to help troubleshoot.") }}</p></div></details>
</section>
<section id="diagnostics" data-category="help" :hidden="category !== 'help'" aria-labelledby="diagnosticsTitle"><DiagnosticsPanel /></section></div></div>
<output id="status" role="status" aria-live="polite" :hidden="!settings.statusVisible">{{ t(settings.status) }}</output>
</main>
</template>

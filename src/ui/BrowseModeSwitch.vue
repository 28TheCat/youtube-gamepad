<script setup lang="ts">
import type { BrowseMode, BrowseModeState } from './browse-mode';
import { useI18n } from '../shared/use-i18n';
import type { Directive } from 'vue';
import { YTGamepadControllerStyle } from '../input/controller-style';
defineProps<{ state: BrowseModeState; change: (mode: BrowseMode) => void }>();
const { t } = useI18n();
const vSwitchKey: Directive<HTMLElement> = { mounted(node) { YTGamepadControllerStyle?.badge(node, 'A'); } };
</script>
<template>
  <button class="ytg-mode-switch" type="button" role="switch" data-ytg-page-mode
    :aria-label="t('Gamepad interface')" :aria-checked="state.mode === 'gamepad'" :disabled="state.busy"
    :title="t(state.mode === 'gamepad' ? 'Switch to YouTube' : 'Switch to Gamepad')"
    @click="change(state.mode === 'gamepad' ? 'youtube' : 'gamepad')">
    <span class="ytg-mode-label">Gamepad</span>
    <span class="ytg-mode-state">{{ t(state.mode === 'gamepad' ? 'On' : 'Off') }}</span>
    <span class="ytg-mode-track" aria-hidden="true"><span class="ytg-mode-thumb"></span></span>
    <span v-switch-key class="ytg-mode-key" aria-hidden="true">A</span>
  </button>
  <span v-if="state.error" class="ytg-mode-error" role="status">{{ t(state.error) }}</span>
</template>

<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import type { PlaybackModel } from './playback-model';
defineProps<{ model: PlaybackModel; selected: string }>();
</script>
<template>
  <div class="cluster volume-controls" :aria-label="t('Volume controls')">
    <button v-for="[action, label] in [['volumeDown', t('Volume down')], ['mute', model.state.value.muted ? t('Unmute') : t('Mute')], ['volumeUp', t('Volume up')]]" :key="action"
      class="control" :class="{ selected: selected === action }" :data-action="action" :data-focus-id="action" :aria-label="label"
      :aria-pressed="action === 'mute' ? model.state.value.muted : undefined" @click="model.request(action)">{{ action === 'volumeDown' ? '−' : action === 'volumeUp' ? '+' : label }}</button>
    <output :aria-label="t('Volume')" data-view="volume">{{ model.state.value.muted ? t('Muted') : Math.round(model.state.value.volume * 100) + '%' }}</output>
  </div>
</template>

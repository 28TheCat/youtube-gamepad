<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import type { PlaybackFeedback } from './playback-presentation';
import { formatPlaybackTime } from './playback-presentation';
import PlaybackIcon from './PlaybackIcon.vue';
defineProps<{ value: PlaybackFeedback | null }>();
function label(text: string) {
  const volume = /^Volume (\d+)%$/.exec(text), seek = /^([−+]\d+) seconds$/.exec(text);
  return volume ? t('Volume {percent}%', { percent: volume[1] })
    : seek ? t('{seconds} seconds', { seconds: seek[1] }) : t(text);
}
</script>
<template>
  <template v-if="value">
    <template v-if="value.seek">
      <span class="seek-target">{{ t('Seek to {time}', { time: formatPlaybackTime(value.seek.target) }) }}</span>
      <span class="seek-change">{{ t('{seconds} seconds', { seconds: (value.seek.delta < 0 ? '−' : '+') + Math.round(Math.abs(value.seek.delta)) }) }}</span>
      <span class="feedback-track"><span class="feedback-level" :style="{ width: Math.max(0, Math.min(100, (value.seek.target - value.seek.start) / (value.seek.end - value.seek.start) * 100)) + '%' }"></span></span>
      <span class="seek-instruction">{{ t('Release to seek') }}</span>
    </template>
    <template v-else><PlaybackIcon v-if="value.icon" :name="value.icon" /><span v-else>{{ label(value.label) }}</span><span v-if="value.level !== undefined" class="feedback-track"><span class="feedback-level" :style="{ width: value.level + '%' }"></span></span></template>
  </template>
</template>

<script setup lang="ts">
import type { PlaybackFeedback } from './playback-presentation';
import PlaybackIcon from './PlaybackIcon.vue';
defineProps<{ value: PlaybackFeedback | null }>();
</script>
<template>
  <template v-if="value"><PlaybackIcon v-if="value.icon" :name="value.icon" /><span v-else>{{ value.label }}</span><span v-if="value.level !== undefined" class="feedback-track"><span class="feedback-level" :style="{ width: value.level + '%' }"></span></span></template>
</template>

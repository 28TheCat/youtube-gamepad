<script setup lang="ts">
import type { PlaybackModel } from './playback-model';
defineProps<{ model: PlaybackModel; selected: string }>();
</script>
<template>
  <div class="cluster volume-controls" aria-label="Volume controls">
    <button v-for="[action, label] in [['volumeDown', 'Volume down'], ['mute', model.state.value.muted ? 'Unmute' : 'Mute'], ['volumeUp', 'Volume up']]" :key="action"
      class="control" :class="{ selected: selected === action }" :data-action="action" :data-focus-id="action" :aria-label="label"
      :aria-pressed="action === 'mute' ? model.state.value.muted : undefined" @click="model.request(action)">{{ action === 'volumeDown' ? '−' : action === 'volumeUp' ? '+' : label }}</button>
    <output aria-label="Volume" data-view="volume">{{ model.state.value.muted ? 'Muted' : Math.round(model.state.value.volume * 100) + '%' }}</output>
  </div>
</template>

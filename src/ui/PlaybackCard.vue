<script setup lang="ts">
import VideoThumbnail from './VideoThumbnail.vue';
import CardMetadataRow from './CardMetadataRow.vue';
import type { RecommendationSnapshot } from '../../types/ports';
defineProps<{ item: RecommendationSnapshot; focusId?: string; queueIndex?: number }>();
const emit = defineEmits<{ open: [key: string] }>();
</script>
<template>
  <button class="card" :class="{ 'collection-entry': queueIndex !== undefined, 'currently-playing': queueIndex !== undefined && item.selected }"
    :disabled="queueIndex !== undefined && item.selected" :aria-current="queueIndex !== undefined && item.selected ? 'true' : undefined"
    :data-video-id="item.key" :data-focus-id="focusId || `recommendation:${item.key}`" :aria-label="item.label" @click="emit('open', item.key)">
    <template v-if="queueIndex !== undefined">
      <span class="collection-index" aria-hidden="true"><svg v-if="item.selected" viewBox="0 0 24 24" class="collection-playing-icon"><path d="M8 5v14l11-7z" /></svg><template v-else>{{ queueIndex }}</template></span>
      <VideoThumbnail class="card-thumbnail collection-thumbnail" :item="item" />
      <div class="collection-copy"><div class="card-title">{{ item.label }}</div><div v-if="item.channel" class="card-meta">{{ item.channel }}</div></div>
    </template>
    <template v-else><VideoThumbnail class="card-thumbnail" :item="item" /><div class="card-title">{{ item.label }}</div><CardMetadataRow v-if="item.channel || item.metadata || item.viewCount" :item="item" /></template>
  </button>
</template>

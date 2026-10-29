<script setup lang="ts">
import VideoThumbnail from './VideoThumbnail.vue';
import CardMetadataRow from './CardMetadataRow.vue';
import type { RecommendationSnapshot } from '../../types/ports';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
defineProps<{ item: RecommendationSnapshot; focusId?: string; queueIndex?: number; showAuthor?: boolean }>();
const emit = defineEmits<{ open: [key: string] }>();
</script>
<template>
  <button class="card" :class="{ 'collection-entry': queueIndex !== undefined, 'currently-playing': queueIndex !== undefined && item.selected }"
    :disabled="queueIndex !== undefined && item.selected" :aria-current="queueIndex !== undefined && item.selected ? 'true' : undefined"
    :data-video-id="item.key" :data-focus-id="focusId || `recommendation:${item.key}`" :aria-label="item.label" @click="emit('open', item.key)">
    <template v-if="queueIndex !== undefined">
      <span class="collection-index">{{ queueIndex }}</span>
      <div class="collection-copy"><div class="card-title">{{ item.label }}</div><div v-if="showAuthor && item.channel" class="card-meta">{{ item.channel }}</div><span v-if="item.selected" class="collection-playing-label">{{ t('Now playing') }}</span></div>
      <span v-if="item.duration" class="collection-duration">{{ item.duration }}</span>
    </template>
    <template v-else><VideoThumbnail class="card-thumbnail" :item="item" /><div class="card-title">{{ item.label }}</div><CardMetadataRow v-if="item.channel || item.metadata || item.viewCount" :item="item" /></template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { RecommendationSnapshot } from '../../types/ports';
import PlaybackCard from './PlaybackCard.vue';
import LoadStatus from './LoadStatus.vue';
import { recommendationFocusIds } from './playback-presentation';
const { t } = useI18n();
const props = defineProps<{ items: readonly RecommendationSnapshot[]; queue?: readonly RecommendationSnapshot[]; playlistTitle?: string;
  collectionOpen?: boolean; splitQueue?: boolean; failed: boolean; openVideo: (key: string) => void }>();
// Duplicate queue entries have independent identities, computed once per list update.
const entries = computed(() => {
  const ids = recommendationFocusIds(props.items);
  return props.items.map((item, index) => ({ item, id: ids[index] })).filter(entry => !props.splitQueue || !entry.item.queue);
});
const collection = computed(() => {
  const ids = recommendationFocusIds(props.items);
  const keys = new Map(props.items.map((item, index) => [item.key, ids[index]]));
  return (props.queue || []).map((item, index) => {
    let position = index + 1;
    try { position = Number(new URL(item.href || '', 'https://www.youtube.com').searchParams.get('index')) || position; } catch { /* Use loaded position. */ }
    return { item, id: keys.get(item.key) || `current:${item.key}`, position };
  });
});
const current = computed(() => collection.value.find(entry => entry.item.selected));
</script>
<template>
  <div class="recommendations" :class="{ 'collection-panel': collectionOpen }" :aria-label="t(collectionOpen ? 'Collection' : 'Recommendations')">
    <template v-if="collectionOpen">
      <header class="collection-heading"><h2>{{ playlistTitle || t('Collection') }}</h2><p v-if="current">{{ t('Playing item {index}', { index: current.position }) }}</p></header>
      <PlaybackCard v-for="entry in collection" :key="entry.id" :item="entry.item" :focus-id="entry.id" :queue-index="entry.position" :selected="false" @open="openVideo" />
    </template>
    <PlaybackCard v-else v-for="entry in entries" :key="entry.id" :item="entry.item" :focus-id="entry.id" :selected="false" @open="openVideo" />
  </div>
  <LoadStatus class="empty" :failed="failed && !items.length"
    error-role="status" :error-message="t('Recommendations are unavailable. Playback continues normally.')" />
</template>

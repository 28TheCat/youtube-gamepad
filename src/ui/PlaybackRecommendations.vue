<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { RecommendationSnapshot } from '../../types/ports';
import PlaybackCard from './PlaybackCard.vue';
import LoadStatus from './LoadStatus.vue';
import { recommendationFocusIds } from './playback-presentation';
import InterfaceIcon from './InterfaceIcon.vue';
const { t } = useI18n();
const props = defineProps<{ items: readonly RecommendationSnapshot[]; queue?: readonly RecommendationSnapshot[]; playlistTitle?: string; playlistTotal?: number;
  collectionOpen?: boolean; fullscreenCollection?: boolean; closeCollection?: () => void; splitQueue?: boolean; failed: boolean; openVideo: (key: string) => void }>();
// Duplicate queue entries have independent identities, computed once per list update.
const focusIds = computed(() => recommendationFocusIds(props.items));
const entries = computed(() => {
  return props.items.map((item, index) => ({ item, id: focusIds.value[index] })).filter(entry => !props.splitQueue || !entry.item.queue);
});
const collection = computed(() => {
  const keys = new Map(props.items.map((item, index) => [item.key, focusIds.value[index]]));
  return (props.queue || []).map((item, index) => {
    let position = index + 1;
    try { position = Number(new URL(item.href || '', 'https://www.youtube.com').searchParams.get('index')) || position; } catch { /* Use loaded position. */ }
    return { item, id: keys.get(item.key) || `current:${item.key}`, position };
  });
});
const current = computed(() => collection.value.find(entry => entry.item.selected));
const mixedAuthors = computed(() => new Set((props.queue || []).map(item => item.channel.trim()).filter(Boolean)).size > 1);
</script>
<template>
  <div class="recommendations" :class="{ 'collection-panel': collectionOpen }" :role="fullscreenCollection ? 'dialog' : undefined" :aria-modal="fullscreenCollection ? true : undefined" :aria-label="t(collectionOpen ? 'Collection' : 'Recommendations')">
    <template v-if="collectionOpen">
      <header class="collection-heading"><h2>{{ playlistTitle || t('Collection') }}</h2><button v-if="fullscreenCollection" class="collection-close" :aria-label="t('Close')" :title="t('Close')" @click="closeCollection?.()"><InterfaceIcon name="close" /></button><p v-if="current">{{ playlistTotal && playlistTotal >= current.position ? t('Playing {index} / {total}', { index: current.position, total: playlistTotal }) : t('Playing item {index}', { index: current.position }) }}</p><p v-if="fullscreenCollection" class="collection-instruction">{{ t('Select an episode · B / Esc to close') }}</p></header>
      <PlaybackCard v-for="entry in collection" :key="entry.id" :item="entry.item" :focus-id="entry.id" :queue-index="entry.position" :show-author="mixedAuthors" @open="openVideo" />
    </template>
    <PlaybackCard v-else v-for="entry in entries" :key="entry.id" :item="entry.item" :focus-id="entry.id" @open="openVideo" />
  </div>
  <LoadStatus class="empty" :failed="failed && !items.length"
    error-role="status" :error-message="t('Recommendations are unavailable. Playback continues normally.')" />
</template>

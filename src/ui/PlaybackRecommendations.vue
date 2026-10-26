<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { RecommendationSnapshot } from '../../types/ports';
import PlaybackCard from './PlaybackCard.vue';
import LoadStatus from './LoadStatus.vue';
import { recommendationFocusIds } from './playback-presentation';
const { t } = useI18n();
const props = defineProps<{ items: readonly RecommendationSnapshot[]; failed: boolean; openVideo: (key: string) => void }>();
// Duplicate queue entries have independent identities, computed once per list update.
const entries = computed(() => {
  const ids = recommendationFocusIds(props.items);
  return props.items.map((item, index) => ({ item, id: ids[index] }));
});
</script>
<template>
  <div class="recommendations" :aria-label="t('Recommendations')">
    <PlaybackCard v-for="entry in entries" :key="entry.id" :item="entry.item" :focus-id="entry.id" :selected="false" @open="openVideo" />
  </div>
  <LoadStatus class="empty" :failed="failed && !items.length"
    error-role="status" :error-message="t('Recommendations are unavailable. Playback continues normally.')" />
</template>

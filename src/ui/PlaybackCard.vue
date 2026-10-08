<script setup lang="ts">
import { ref, watch } from 'vue';
import type { RecommendationSnapshot } from '../../types/ports';
const props = defineProps<{ item: RecommendationSnapshot; selected: boolean; hidden: boolean; focusId?: string }>();
const emit = defineEmits<{ open: [key: string] }>();
const source = ref(''), failed = ref(false), fallback = ref(false);
watch(() => [props.item.thumbnail, props.item.thumbnailFallback], () => {
  source.value = props.item.thumbnail || props.item.thumbnailFallback;
  fallback.value = !props.item.thumbnail || props.item.thumbnail === props.item.thumbnailFallback;
  failed.value = !source.value;
}, { immediate: true });
function imageError() {
  if (!fallback.value && props.item.thumbnailFallback) { fallback.value = true; source.value = props.item.thumbnailFallback; }
  else failed.value = true;
}
</script>
<template>
  <button class="card" :class="{ selected }" :hidden="hidden" :data-video-id="item.key" :data-focus-id="focusId || `recommendation:${item.key}`" :aria-label="item.label" @click="emit('open', item.key)">
    <div class="card-thumbnail"><img alt="" loading="lazy" :src="source || undefined" :style="{ visibility: failed ? 'hidden' : 'visible' }" @error="imageError" /><span v-if="item.duration" class="card-duration">{{ item.duration }}</span></div>
    <div class="card-title">{{ item.label }}</div><div class="card-meta">{{ item.channel }}</div><div v-if="item.metadata" class="card-meta">{{ item.metadata }}</div>
  </button>
</template>

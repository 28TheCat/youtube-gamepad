<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ item: {
  id?: string; key?: string; thumbnail?: string; thumbnailFallback?: string;
  duration?: string; watchedPercent?: number; isPlaylist?: boolean;
} }>();
const source = ref(''), failed = ref(false), loaded = ref(false);
watch(() => [props.item.id ?? props.item.key, props.item.thumbnail, props.item.thumbnailFallback], () => {
  const nextSource = props.item.thumbnail || props.item.thumbnailFallback || '';
  if (source.value !== nextSource) loaded.value = false;
  source.value = nextSource;
  failed.value = !nextSource;
}, { immediate: true });
function imageError() {
  loaded.value = false;
  const fallback = props.item.thumbnailFallback;
  if (fallback && source.value !== fallback) source.value = fallback;
  else failed.value = true;
}
const element = ref<HTMLElement>();
const progress = computed(() => Number.isFinite(props.item.watchedPercent)
  ? Math.max(0, Math.min(100, props.item.watchedPercent!)) : 0);
defineExpose({ element });
</script>
<template>
  <div ref="element" class="video-thumbnail" :data-loading="!!source && !failed && !loaded">
    <img v-if="source && !failed" :key="source" :src="source" :data-loaded="loaded"
      :style="{ opacity: loaded ? 1 : 0 }" alt="" loading="lazy" decoding="async"
      @load="loaded = true" @error="imageError">
    <span v-else class="thumbnail-placeholder" aria-hidden="true"></span>
    <slot name="preview" />
    <span v-if="item.duration && !item.isPlaylist" class="card-duration">{{ item.duration }}</span>
    <span v-if="progress && !item.isPlaylist" class="card-watch-progress" aria-hidden="true"><span :style="{ width: `${progress}%` }"></span></span>
    <slot />
  </div>
</template>

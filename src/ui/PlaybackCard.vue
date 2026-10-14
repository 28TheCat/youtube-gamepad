<script setup lang="ts">
import { useThumbnail } from './use-thumbnail';
import type { RecommendationSnapshot } from '../../types/ports';
const props = defineProps<{ item: RecommendationSnapshot; selected: boolean; hidden: boolean; focusId?: string }>();
const emit = defineEmits<{ open: [key: string] }>();
const { source, failed, imageError } = useThumbnail(() => props.item);
</script>
<template>
  <button class="card" :class="{ selected }" :hidden="hidden" :data-video-id="item.key" :data-focus-id="focusId || `recommendation:${item.key}`" :aria-label="item.label" @click="emit('open', item.key)">
    <div class="card-thumbnail"><img alt="" loading="lazy" :src="source || undefined" :style="{ visibility: failed ? 'hidden' : 'visible' }" @error="imageError" /><span v-if="item.duration" class="card-duration">{{ item.duration }}</span></div>
    <div class="card-title">{{ item.label }}</div><div class="card-meta">{{ item.channel }}</div><div v-if="item.metadata" class="card-meta">{{ item.metadata }}</div>
  </button>
</template>

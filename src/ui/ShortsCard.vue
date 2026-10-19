<script setup lang="ts">
import VideoCard from './VideoCard.vue';
import type { BrowseItem } from '../shared/browse-data';

defineProps<{ item: BrowseItem; selected: boolean; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
</script>
<template>
  <VideoCard class="shorts-card" :item="item" :selected="selected" :register="register"
    @select="emit('select', $event)" @open="emit('open', $event)">
    <template #cover-overlay>
      <span class="shorts-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.8 2.3a4 4 0 0 1 4 6.9l-3 1.7 1.3.8a4 4 0 0 1 0 6.9l-12 6.9a4 4 0 0 1-4-6.9l3-1.7-1.3-.8a4 4 0 0 1 0-6.9Z" transform="translate(1 -1) scale(.9)"/><path fill="white" d="m10 8 6 4-6 4Z"/></svg>Shorts</span>
    </template>
  </VideoCard>
</template>

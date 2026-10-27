<script setup lang="ts">
import VideoCard from './VideoCard.vue';
import type { BrowseItem } from '../shared/browse-data';

defineProps<{ item: BrowseItem; selected: boolean; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
</script>
<template>
  <VideoCard class="shorts-card" :item="item" :selected="selected" :register="register"
    @select="emit('select', $event)" @open="emit('open', $event)">
    <template #metadata>
      <div class="card-copy">
        <strong>{{ item.title }}</strong>
        <span v-if="item.viewCount" class="shorts-view-count">{{ item.viewCount }}</span>
      </div>
    </template>
  </VideoCard>
</template>

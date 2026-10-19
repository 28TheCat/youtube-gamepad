<script setup lang="ts">
import VideoCard from './VideoCard.vue';
import InterfaceIcon from './InterfaceIcon.vue';
import type { BrowseItem } from '../shared/browse-data';

defineProps<{ item: BrowseItem; selected: boolean; label: string; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
</script>
<template>
  <VideoCard class="playlist-card" :item="item" :selected="selected" :register="register"
    :style="{ '--ytg-playlist-stack-light': item.stackColorLight, '--ytg-playlist-stack-dark': item.stackColorDark }"
    @select="emit('select', $event)" @open="emit('open', $event)">
    <template #cover-overlay>
      <span class="playlist-badge"><InterfaceIcon name="playlists" filled />{{ label }}</span>
    </template>
  </VideoCard>
</template>

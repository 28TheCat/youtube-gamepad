<script setup lang="ts">
import { ref, watch } from 'vue';
import type { BrowseItem } from '../sites/youtube-browse';
const props = defineProps<{ item: BrowseItem; selected: boolean; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
const source = ref(''), failed = ref(false);
watch(() => [props.item.id, props.item.thumbnail, props.item.thumbnailFallback], () => {
  source.value = props.item.thumbnail || props.item.thumbnailFallback || '';
  failed.value = !source.value;
}, { immediate: true });
function imageError() {
  const fallback = props.item.thumbnailFallback;
  if (fallback && source.value !== fallback) source.value = fallback;
  else failed.value = true;
}
</script>
<template>
  <a :ref="node => register(item.id, node as HTMLAnchorElement | null)" :href="item.href"
    :data-browse-id="item.id" :data-selected="selected" @focus="emit('select', item.id)"
    @click.prevent="emit('open', item.id)">
    <img v-if="source && !failed" :src="source" alt="" loading="lazy" @error="imageError">
    <span v-else class="thumbnail-placeholder"></span>
    <div class="card-copy"><strong>{{ item.title }}</strong><span class="channel">{{ item.channel }}</span></div>
  </a>
</template>

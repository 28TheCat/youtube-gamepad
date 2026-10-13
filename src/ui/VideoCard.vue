<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { BrowseItem } from '../sites/youtube-browse';
const props = defineProps<{ item: BrowseItem; selected: boolean; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
const source = ref(''), failed = ref(false);
const loaded = ref(false), cover = ref<HTMLElement>();
let press: Animation | undefined;
watch(() => [props.item.id, props.item.thumbnail, props.item.thumbnailFallback], () => {
  source.value = props.item.thumbnail || props.item.thumbnailFallback || '';
  failed.value = !source.value;
  loaded.value = false;
}, { immediate: true });
function imageError() {
  loaded.value = false;
  const fallback = props.item.thumbnailFallback;
  if (fallback && source.value !== fallback) source.value = fallback;
  else failed.value = true;
}
function open() {
  press?.cancel();
  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    press = cover.value?.animate([{ scale: '.97' }, { scale: '1' }], {
      duration: 120, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-card-press'
    });
  }
  emit('open', props.item.id);
}
onBeforeUnmount(() => press?.cancel());
</script>
<template>
  <a :ref="node => register(item.id, node as HTMLAnchorElement | null)" :href="item.href"
    :data-browse-id="item.id" :data-selected="selected" @focus="emit('select', item.id)"
    @click.prevent="open">
    <div ref="cover" class="card-cover" :data-loading="!!source && !failed && !loaded">
      <img v-if="source && !failed" :key="source" :src="source" :data-loaded="loaded" alt="" loading="lazy" @load="loaded = true" @error="imageError">
      <span v-else class="thumbnail-placeholder"></span>
    </div>
    <div class="card-copy"><strong>{{ item.title }}</strong><span class="channel">{{ item.channel }}</span></div>
  </a>
</template>

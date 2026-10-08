<script setup lang="ts">
import { nextTick, watch, onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { useBrowseStore } from '../app/browse-store';
import { videoGridLayout, type VideoGridSettings } from '../shared/video-grid';
import VideoCard from './VideoCard.vue';
const props = defineProps<{ open: (id: string) => void; more: () => void; ownsFocus: () => boolean; gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void }>();
const store = useBrowseStore();
const cards = ref<HTMLElement>();
const width = ref(0);
const layout = computed(() => videoGridLayout(width.value, props.gridSettings));
const observer = new ResizeObserver(entries => { width.value = entries[0]?.contentRect.width || 0; });
onMounted(() => { if (cards.value) observer.observe(cards.value); });
const elements = new Map<string, HTMLAnchorElement>();
let disposed = false;
function register(id: string, node: HTMLAnchorElement | null) { if (node) elements.set(id, node); else elements.delete(id); }
watch(() => [store.activeItemId, store.snapshot] as const, async () => {
  await nextTick();
  if (disposed || !props.ownsFocus()) return;
  const node = elements.get(store.activeItemId || '');
  node?.focus({ preventScroll: true });
  node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
function scroll(event: Event) {
  const node = event.currentTarget as HTMLElement;
  if (store.snapshot.canLoadMore && node.scrollHeight - node.scrollTop - node.clientHeight < 400) props.more();
}
onBeforeUnmount(() => { disposed = true; observer.disconnect(); elements.clear(); });
</script>
<template>
  <nav v-if="store.categories.length" id="ytg-browse-categories" aria-label="视频分类">
    <div data-ytg-category v-for="item in store.categories" :key="item.id"
      :selected="store.category === item.id ? '' : undefined" :aria-label="item.label">
      <button type="button" :aria-pressed="store.category === item.id" @click="changeCategory?.(item.id)">{{ item.label }}</button>
    </div>
  </nav>
  <div data-ytg-browse-grid @scroll.passive="scroll" aria-label="Videos">
    <p v-if="store.error" role="alert">{{ store.error }} <button @click="changeCategory?.(store.category)">重试</button></p>
    <p v-else-if="!store.snapshot.items.length" role="status">{{ store.loading || !store.category ? 'Loading videos…' : '此分类暂无视频' }}</p>
    <div ref="cards" class="cards" :data-horizontal="layout.horizontal" :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, '--ytg-cover-width': `${layout.cover}%`, '--ytg-cover-flex': layout.cover, '--ytg-info-flex': 100 - layout.cover }">
      <VideoCard v-for="item in store.snapshot.items" :key="item.id" :item="item"
        :selected="item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
    </div>
    <button v-if="store.snapshot.canLoadMore" data-browse-more @click="more">Load more videos</button>
  </div>
</template>

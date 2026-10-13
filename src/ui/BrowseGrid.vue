<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { nextTick, watch, onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { useBrowseStore } from '../app/browse-store';
import { videoGridLayout, type VideoGridSettings } from '../shared/video-grid';
import VideoCard from './VideoCard.vue';
import FeedStatus from './FeedStatus.vue';
const props = defineProps<{ open: (id: string) => void; more: () => void; ownsFocus: () => boolean; gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void }>();
const store = useBrowseStore();
const cards = ref<HTMLElement>();
let contentAnimation: Animation | undefined;
// Fade only a replacement feed or its first result, never held navigation or appended pages.
watch(() => [store.category, store.snapshot.route, store.snapshot.items.length > 0] as const,
  async ([category, route, populated], previous) => {
    if (!populated || (previous && category === previous[0] && route === previous[1] && previous[2])) return;
    await nextTick();
    if (disposed) return;
    contentAnimation?.cancel();
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      contentAnimation = cards.value?.animate([{ opacity: .35 }, { opacity: 1 }], {
        duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-feed-enter'
      });
    }
  });
const width = ref(0);
const layout = computed(() => videoGridLayout(width.value, props.gridSettings));
const observer = new ResizeObserver(entries => { width.value = entries[0]?.contentRect.width || 0; });
onMounted(() => {
  if (cards.value) {
    width.value = cards.value.getBoundingClientRect().width;
    observer.observe(cards.value);
  }
});
const elements = new Map<string, HTMLAnchorElement>();
let disposed = false;
function register(id: string, node: HTMLAnchorElement | null) { if (node) elements.set(id, node); else elements.delete(id); }
watch(() => [store.activeItemId, store.snapshot] as const, async () => {
  // Set columns before restoration uses card geometry on a newly visible page.
  width.value = cards.value?.getBoundingClientRect().width || width.value;
  await nextTick();
  if (disposed || !props.ownsFocus()) return;
  const node = elements.get(store.activeItemId || '');
  node?.focus({ preventScroll: true });
  // Navigation owns scrolling and saved return positions. Focusing metadata
  // must not move the feed again after the thumbnail position is restored.
});
function scroll(event: Event) {
  const node = event.currentTarget as HTMLElement;
  if (store.snapshot.canLoadMore && node.scrollHeight - node.scrollTop - node.clientHeight < 400) props.more();
}
onBeforeUnmount(() => { disposed = true; contentAnimation?.cancel(); observer.disconnect(); elements.clear(); });
</script>
<template>
  <div data-ytg-browse-grid @scroll.passive="scroll" :aria-label="t('Videos')" :aria-busy="store.loading">
    <FeedStatus :error="store.error" :loading="store.loading" :empty="!store.snapshot.items.length"
      :category="store.category" @retry="changeCategory?.(store.category)" />
    <div v-if="store.loading && !store.snapshot.items.length && !store.error" class="feed-skeletons" aria-hidden="true"
      :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }">
      <div v-for="n in layout.columns * 2" :key="n" class="feed-skeleton"><div></div><span></span><span></span></div>
    </div>
    <div ref="cards" class="cards" :data-horizontal="layout.horizontal" :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, '--ytg-cover-width': `${layout.cover}%`, '--ytg-cover-flex': layout.cover, '--ytg-info-flex': 100 - layout.cover }">
      <VideoCard v-for="item in store.snapshot.items" :key="item.id" :item="item"
        :selected="item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
    </div>
    <button v-if="store.snapshot.canLoadMore" data-browse-more @click="more">{{ t("Load more videos") }}</button>
  </div>
</template>

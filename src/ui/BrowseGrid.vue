<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { nextTick, watch, onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { useBrowseStore } from '../app/browse-store';
import { videoGridLayout, type VideoGridSettings } from '../shared/video-grid';
import VideoCard from './VideoCard.vue';
import PlaylistCard from './PlaylistCard.vue';
import ShortsShelf from './ShortsShelf.vue';
import { feedRows, rowGeometry, windowIndexes, indexFeedRows, type FeedRow } from '../shared/virtual-feed';
import type { BrowseItem } from '../shared/browse-data';
import FeedStatus from './FeedStatus.vue';
import { pageActiveElement } from '../shared/page-dom';
const props = defineProps<{ open: (id: string) => void; more: () => void; ownsFocus: () => boolean; gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void; pageTitle?: string }>();
const store = useBrowseStore();
// Share row ordering with the virtual feed so Shorts never interrupt a partial row.
const feedEntries = computed(() => {
  const entries: ({ id: string; item: BrowseItem } | { id: string; shorts: readonly BrowseItem[] })[] = [];
  for (const row of rows.value) {
    if (row.shorts) entries.push({ id: row.id, shorts: row.items });
    else for (const item of row.items) entries.push({ id: item.id, item });
  }
  return entries;
});
const cards = ref<HTMLElement>();
const viewport = ref<HTMLElement>();
const sentinel = ref<HTMLElement>();
let pagingObserver: IntersectionObserver | undefined;
let emptyPages = 0;
watch(() => JSON.stringify([store.category, store.snapshot.route]), () => { emptyPages = 0; });
watch(() => store.snapshot, (next, previous) => {
  if (next.route === previous.route && previous.items.length && next.items.length <= previous.items.length) emptyPages++;
  else emptyPages = 0;
});
function loadNearBottom() {
  const node = viewport.value;
  if (disposed || document.hidden || !node?.clientHeight || store.loading || store.error || emptyPages >= 2 ||
    !store.snapshot.items.length || !store.snapshot.canLoadMore) return;
  if (node.scrollHeight - node.scrollTop - node.clientHeight < 400) props.more();
}
watch(() => [store.loading, store.snapshot], async () => { await nextTick(); loadNearBottom(); });
function retry() {
  emptyPages = 0;
  if (store.snapshot.items.length && store.snapshot.canLoadMore) props.more();
  else props.changeCategory?.(store.category);
}
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
const scrollTop = ref(0), viewportHeight = ref(800), cardsTop = ref(0), rowGap = ref(32), columnGap = ref(24);
const normalHeight = ref(0), shortsHeight = ref(480);
const pendingSourceId = ref<string>();
const virtual = computed(() => store.snapshot.items.length > 120 || store.snapshot.items.filter(item => item.id.startsWith('short:')).length > 60);
const rows = computed(() => feedRows(store.snapshot.items, layout.value.columns));
const navigation = computed(() => indexFeedRows(rows.value));
const estimatedHeight = computed(() => {
  const cardWidth = Math.max(1, (width.value - columnGap.value * (layout.value.columns - 1)) / layout.value.columns);
  return layout.value.horizontal ? Math.max(100, (cardWidth - 20) * layout.value.cover / 100 * 9 / 16) : cardWidth * 9 / 16 + 100;
});
const geometry = computed(() => rowGeometry(rows.value, normalHeight.value || estimatedHeight.value, shortsHeight.value, rowGap.value));
const pieces = computed(() => {
  const pinned = navigation.value.position(store.activeItemId || '')?.row ?? -1;
  const indexes = windowIndexes(geometry.value.offsets, Math.max(0, scrollTop.value - cardsTop.value), viewportHeight.value, pinned);
  const sourceRow = navigation.value.position(pendingSourceId.value || '')?.row ?? -1;
  if (sourceRow >= 0 && !indexes.includes(sourceRow)) { indexes.push(sourceRow); indexes.sort((a, b) => a - b); }
  const result: { key: string; row?: FeedRow; height?: number; gap?: number }[] = [];
  let cursor = 0;
  for (const index of indexes) {
    const offset = geometry.value.offsets[index];
    if (offset > cursor) result.push({ key: `space:${index}`, height: offset - cursor });
    const row = rows.value[index], gap = index === rows.value.length - 1 ? 0 : rowGap.value;
    result.push({ key: row.id, row, gap });
    cursor = offset + (row.shorts ? shortsHeight.value : normalHeight.value || estimatedHeight.value) + gap;
  }
  if (cursor < geometry.value.total) result.push({ key: 'end-space', height: geometry.value.total - cursor });
  return result;
});
function measureViewport() {
  if (!cards.value || !viewport.value) return;
  const bounds = cards.value.getBoundingClientRect();
  width.value = bounds.width;
  viewportHeight.value = viewport.value.clientHeight;
  cardsTop.value = bounds.top - viewport.value.getBoundingClientRect().top + viewport.value.scrollTop;
  const style = getComputedStyle(cards.value);
  rowGap.value = parseFloat(style.getPropertyValue('--ytg-row-gap')) || parseFloat(style.rowGap) || 32;
  columnGap.value = parseFloat(style.columnGap) || 24;
}
const observer = new ResizeObserver(entries => {
  if (entries.some(entry => entry.target === viewport.value || Math.abs(entry.contentRect.width - width.value) > .5)) measureViewport();
});
const rowObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    if (entry.contentRect.height <= 0) continue;
    const height = (entry.target as HTMLElement).dataset.shorts === 'true' ? shortsHeight : normalHeight;
    if (Math.abs(height.value - entry.contentRect.height) > .5) height.value = entry.contentRect.height;
  }
});
const rowElements = new Map<string, HTMLElement>();
function registerRow(id: string, node: HTMLElement | null) {
  const old = rowElements.get(id);
  if (old && old !== node) rowObserver.unobserve(old);
  if (node) { rowElements.set(id, node); rowObserver.observe(node); } else rowElements.delete(id);
}
// Resolve estimates before return restoration applies its saved scroll offset.
// At most one normal row and one shelf are measured after a feed/layout change.
watch(() => [rows.value, width.value], () => {
  if (!virtual.value) return;
  const measured = new Set<boolean>();
  for (const node of rowElements.values()) {
    const shorts = node.dataset.shorts === 'true';
    if (measured.has(shorts)) continue;
    const height = node.getBoundingClientRect().height;
    if (height > 0) { (shorts ? shortsHeight : normalHeight).value = height; measured.add(shorts); }
  }
}, { flush: 'post' });
function scrolled() { scrollTop.value = viewport.value?.scrollTop || 0; loadNearBottom(); }
function restoreScroll(event: Event) {
  const detail = (event as CustomEvent<{ scrollTop: number; ready?: Promise<void> }>).detail;
  const route = store.snapshot.route, category = store.category;
  measureViewport();
  scrollTop.value = detail.scrollTop;
  // Render the saved window before assigning scrollTop; otherwise snapping can
  // pick the initial window while the saved row is still represented by a spacer.
  detail.ready = nextTick().then(() => {
    if (!disposed && viewport.value && route === store.snapshot.route && category === store.category)
      viewport.value.scrollTo({ top: detail.scrollTop, behavior: 'instant' });
  });
}
let moveVersion = 0, pendingId: string | undefined;
let preferredColumn: number | undefined, lastNavigationId: string | undefined;
watch(() => [store.category, store.snapshot.route, layout.value.columns], () => {
  ++moveVersion; pendingId = undefined; pendingSourceId.value = undefined;
  preferredColumn = undefined; lastNavigationId = undefined;
});
async function direction(event: Event) {
  const command = event as CustomEvent<{ direction: string; focus: (node: HTMLElement) => void }>;
  const source = (event.target as Element).closest<HTMLElement>('[data-browse-id]')?.dataset.browseId;
  if (!source) return;
  const from = pendingId || source, position = navigation.value.position(from);
  if (!position) return;
  const direction = command.detail.direction;
  if (from !== lastNavigationId || preferredColumn === undefined) preferredColumn = position.column;
  const id = navigation.value.adjacent(from, direction, preferredColumn);
  // Only the top/left outer edges may hand focus to the page header/sidebar.
  // All other edges stay in the feed, including a short final row.
  if (!id) {
    if (!pendingId && ((direction === 'up' && position.row === 0) || (direction === 'left' && position.column === 0))) return;
    event.preventDefault();
    if (direction === 'down') loadNearBottom();
    return;
  }
  event.preventDefault();
  if (direction === 'left' || direction === 'right') preferredColumn = navigation.value.position(id)!.column;
  lastNavigationId = id;
  const version = ++moveVersion; pendingId = id; pendingSourceId.value = source;
  store.select(id);
  await nextTick();
  if (disposed || version !== moveVersion) return;
  if (!props.ownsFocus()) { pendingId = undefined; pendingSourceId.value = undefined; return; }
  const node = elements.get(id);
  if (node) {
    if (id.startsWith('short:')) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    command.detail.focus(node);
  }
  pendingId = undefined; pendingSourceId.value = undefined;
}
onMounted(() => {
  if (cards.value) {
    observer.observe(cards.value);
  }
  if (viewport.value) observer.observe(viewport.value);
  measureViewport();
  if (viewport.value && sentinel.value) {
    pagingObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNearBottom();
    }, { root: viewport.value, rootMargin: '0px 0px 400px 0px' });
    pagingObserver.observe(sentinel.value);
  }
  document.addEventListener('visibilitychange', loadNearBottom);
});
const elements = new Map<string, HTMLAnchorElement>();
let disposed = false;
function register(id: string, node: HTMLAnchorElement | null) { if (node) elements.set(id, node); else elements.delete(id); }
let focusVersion = 0;
watch(() => [store.activeItemId, store.snapshot, layout.value.columns] as const, async () => {
  const wasOwned = props.ownsFocus(), version = ++focusVersion;
  // Width comes from ResizeObserver, not a layout read on every focus move.
  await nextTick();
  if (disposed || version !== focusVersion || pendingId) return;
  const active = pageActiveElement();
  const root = viewport.value?.getRootNode() as ShadowRoot | undefined;
  const lostDuringPatch = wasOwned && (!active || active === document.body || active === document.documentElement || active === root?.host);
  if (!props.ownsFocus() && !lostDuringPatch) return;
  const node = elements.get(store.activeItemId || '');
  node?.focus({ preventScroll: true });
  // Navigation owns scrolling and saved return positions. Focusing metadata
  // must not move the feed again after the thumbnail position is restored.
});
onBeforeUnmount(() => {
  disposed = true; ++moveVersion; contentAnimation?.cancel(); observer.disconnect(); rowObserver.disconnect(); rowElements.clear(); pagingObserver?.disconnect(); elements.clear();
  document.removeEventListener('visibilitychange', loadNearBottom);
});
</script>
<template>
  <div ref="viewport" data-ytg-browse-grid data-ytg-indexed-feed :data-ytg-virtual-feed="virtual ? '' : undefined" :style="{ scrollSnapType: virtual ? 'none' : undefined }" @ytg-browse-direction="direction" @ytg-browse-restore="restoreScroll" @scroll.passive="scrolled" :aria-label="pageTitle || t('Videos')" :aria-busy="store.loading">
    <slot name="heading" />
    <FeedStatus v-if="!store.snapshot.items.length" :error="store.error" :loading="store.loading" :empty="true"
      :category="store.category" @retry="retry" />
    <div v-if="store.loading && !store.snapshot.items.length && !store.error" class="feed-skeletons" aria-hidden="true"
      :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }">
      <div v-for="n in layout.columns * 2" :key="n" class="feed-skeleton"><div></div><span></span><span></span></div>
    </div>
    <div ref="cards" class="cards" :data-horizontal="layout.horizontal" :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, rowGap: virtual ? '0px' : undefined, '--ytg-cover-width': `${layout.cover}%`, '--ytg-cover-flex': layout.cover, '--ytg-info-flex': 100 - layout.cover }">
      <template v-if="virtual">
        <template v-for="piece in pieces" :key="piece.key">
          <div v-if="!piece.row" aria-hidden="true" data-virtual-spacer :style="{ gridColumn: '1 / -1', height: `${piece.height}px` }"></div>
          <div v-else :ref="node => registerRow(piece.key, node as HTMLElement | null)" class="virtual-row" :data-shorts="piece.row.shorts"
            :style="{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, columnGap: `${columnGap}px`, marginBottom: `${piece.gap}px` }">
            <ShortsShelf v-if="piece.row.shorts" :items="piece.row.items" :selected-id="store.activeItemId" :keep-id="pendingSourceId" :register="register" @select="store.select" @open="open" />
            <template v-else v-for="item in piece.row.items" :key="item.id">
              <component :is="item.isPlaylist ? PlaylistCard : VideoCard" :item="item" v-bind="item.isPlaylist ? { label: t('Playlist') } : {}"
                :selected="item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
            </template>
          </div>
        </template>
      </template>
      <template v-else v-for="entry in feedEntries" :key="entry.id">
        <ShortsShelf v-if="'shorts' in entry" :items="entry.shorts" :selected-id="store.activeItemId" :register="register" @select="store.select" @open="open" />
        <component v-else :is="entry.item.isPlaylist ? PlaylistCard : VideoCard" :item="entry.item"
          v-bind="entry.item.isPlaylist ? { label: t('Playlist') } : {}"
          :selected="entry.item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
      </template>
    </div>
    <div ref="sentinel" data-browse-sentinel aria-hidden="true" style="height:1px"></div>
    <FeedStatus v-if="store.snapshot.items.length && store.error" :error="store.error" :loading="store.loading" :empty="false"
      :category="store.category" @retry="retry" />
    <p v-if="store.loading && store.snapshot.items.length" role="status">{{ t('Loading videos…') }}</p>
    <button v-if="store.snapshot.canLoadMore" data-browse-more :disabled="store.loading" @click="emptyPages = 0; more()">{{ t("Load more videos") }}</button>
  </div>
</template>

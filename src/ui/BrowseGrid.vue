<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t, language } = useI18n();
import { nextTick, watch, onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { useBrowseStore } from '../app/browse-store';
import { videoGridLayout, type VideoGridSettings } from '../shared/video-grid';
import VideoCard from './VideoCard.vue';
import VideoCardSkeleton from './VideoCardSkeleton.vue';
import PlaylistCard from './PlaylistCard.vue';
import ShortsShelf from './ShortsShelf.vue';
import { feedRows, rowGeometry, windowIndexes, indexFeedRows, createRowHeightCache, rowAtOffset, appendFeedSkeletons, type FeedRow } from '../shared/virtual-feed';
import type { BrowseItem } from '../shared/browse-data';
import LoadStatus from './LoadStatus.vue';
import { pageActiveElement } from '../shared/page-dom';
const props = defineProps<{ open: (id: string) => void; more: (manual?: boolean) => void; ownsFocus: () => boolean; gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void; pageTitle?: string }>();
const store = useBrowseStore();
const isHistory = computed(() => new URL(store.snapshot.route || '/', location.origin).pathname === '/feed/history');
const isWatchLater = computed(() => {
  const route = new URL(store.snapshot.route || '/', location.origin);
  return route.pathname === '/playlist' && route.searchParams.get('list') === 'WL';
});
const isListPage = computed(() => isHistory.value || isWatchLater.value);
const feedStatus = computed(() => ({
  loading: store.loading || (!store.snapshot.items.length && !store.category && !store.error),
  failed: !!store.error, empty: !store.snapshot.items.length,
  loadingMessage: t('Loading videos…'), errorMessage: t(store.error), emptyMessage: t('此分类暂无视频'),
  retryable: true, retryLabel: t('重试')
}));
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
let pagingFrame: number | undefined, pagingTimer: ReturnType<typeof setTimeout> | undefined;
let viewportMeasurementPending = false;
function cancelPagingCheck() {
  if (pagingFrame !== undefined) cancelAnimationFrame(pagingFrame);
  if (pagingTimer !== undefined) clearTimeout(pagingTimer);
  pagingFrame = pagingTimer = undefined;
}
// Vue's nextTick only finishes DOM patches. Let the browser lay out the new
// cards before reading scroll geometry, and merge scroll/observer/feed checks.
function loadNearBottom() {
  if (disposed || document.hidden) { cancelPagingCheck(); return; }
  if (pagingFrame !== undefined || pagingTimer !== undefined) return;
  pagingFrame = requestAnimationFrame(() => {
    pagingFrame = undefined;
    pagingTimer = setTimeout(() => {
      pagingTimer = undefined;
      if (disposed || document.hidden) return;
      if (viewportMeasurementPending) {
        viewportMeasurementPending = false;
        measureViewport();
        loadNearBottom();
        return;
      }
      checkNearBottom();
    }, 0);
  });
}
function checkNearBottom() {
  const node = viewport.value;
  if (disposed || document.hidden || !node || store.loading || store.error || store.snapshot.autoLoadBlocked || emptyPages >= 2 ||
    !store.snapshot.items.length || !store.snapshot.canLoadMore) return;
  const height = node.clientHeight;
  if (height && node.scrollHeight - node.scrollTop - height < 400) props.more();
}
watch(() => [store.loading, store.snapshot], loadNearBottom, { flush: 'post' });
// Removing the initial skeleton/status changes the grid's origin without
// changing its width. ResizeObserver alone cannot detect that movement.
watch(() => [store.snapshot.items.length > 0, !store.snapshot.items.length && store.loading,
  !store.snapshot.items.length && store.error, store.snapshot.filteredCount, store.snapshot.autoLoadBlocked, props.pageTitle], () => {
  viewportMeasurementPending = true;
  loadNearBottom();
}, { flush: 'post' });
function retry() {
  emptyPages = 0;
  if (store.refreshFailed) props.changeCategory?.(store.category);
  else if (store.snapshot.items.length && store.snapshot.canLoadMore) props.more(true);
  else props.changeCategory?.(store.category);
}
let contentAnimation: Animation | undefined;
// Fade only a replacement feed or its first result, never held navigation or appended pages.
watch(() => [store.category, store.snapshot.route, store.snapshot.items.length > 0] as const,
  async ([category, route, populated], previous) => {
    if (store.refreshing) { contentAnimation?.cancel(); return; }
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
const layout = computed(() => isListPage.value
  ? { ...videoGridLayout(width.value, props.gridSettings), columns: 1, horizontal: true, cover: 35 }
  : videoGridLayout(width.value, props.gridSettings));
const scrollTop = ref(0), viewportHeight = ref(800), cardsTop = ref(0), rowGap = ref(32), columnGap = ref(24);
const heightCache = createRowHeightCache(), heightVersion = ref(0);
let anchorVersion = 0, restoringScroll = false, restoreVersion = 0;
const pendingSourceId = ref<string>();
const virtual = computed(() => store.snapshot.items.length > 120 || store.snapshot.items.filter(item => item.id.startsWith('short:')).length > 60);
const displayItems = computed(() => appendFeedSkeletons(store.snapshot.items, layout.value.columns, feedStatus.value.loading && !store.error && !store.refreshing));
const rows = computed(() => feedRows(displayItems.value, layout.value.columns));
const rowsById = computed(() => new Map(rows.value.map(row => [row.id, row])));
const navigation = computed(() => indexFeedRows(feedRows(store.snapshot.items, layout.value.columns)));
const estimatedHeight = computed(() => {
  const cardWidth = Math.max(1, (width.value - columnGap.value * (layout.value.columns - 1)) / layout.value.columns);
  return layout.value.horizontal ? Math.max(100, (cardWidth - 20) * layout.value.cover / 100 * 9 / 16) : cardWidth * 9 / 16 + 100;
});
const heightContext = computed(() => JSON.stringify([store.snapshot.route, store.category, width.value,
  layout.value.columns, layout.value.horizontal, layout.value.cover, columnGap.value, language.value]));
const geometry = computed(() => {
  heightVersion.value;
  heightCache.use(heightContext.value, rows.value);
  return rowGeometry(rows.value, estimatedHeight.value, 480, rowGap.value, row => heightCache.read(row));
});
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
    result.push({ key: `row:${index}`, row, gap });
    cursor = offset + geometry.value.heights[index] + gap;
  }
  if (cursor < geometry.value.total) result.push({ key: 'end-space', height: geometry.value.total - cursor });
  return result;
});
function measureViewport() {
  if (!cards.value || !viewport.value) return;
  const top = viewport.value.scrollTop;
  const bounds = cards.value.getBoundingClientRect();
  const viewportBounds = viewport.value.getBoundingClientRect();
  const height = viewport.value.clientHeight;
  const style = getComputedStyle(cards.value);
  width.value = bounds.width;
  viewportHeight.value = height;
  cardsTop.value = bounds.top - viewportBounds.top + top;
  rowGap.value = parseFloat(style.getPropertyValue('--ytg-row-gap')) || parseFloat(style.rowGap) || 32;
  columnGap.value = parseFloat(style.columnGap) || 24;
}
const observer = new ResizeObserver(entries => {
  if (entries.some(entry => entry.target === viewport.value || Math.abs(entry.contentRect.width - width.value) > .5)) measureViewport();
});
const rowElements = new Map<string, HTMLElement>();
const rowObservationKeys = new Map<string, string>();
const elementRowIds = new WeakMap<HTMLElement, string>();
// Correct only the heights preceding the visible row. Row/spacer swaps with
// identical cached heights need no scroll adjustment or synchronous DOM reads.
function updateRowHeights(measurements: readonly { id: string; height: number }[]) {
  const before = geometry.value, context = heightContext.value;
  const anchor = rowAtOffset(before.offsets, Math.max(0, scrollTop.value - cardsTop.value));
  let changed = false;
  for (const { id, height } of measurements) {
    const row = rowsById.value.get(id);
    if (row) changed = heightCache.measure(row, height) || changed;
  }
  if (!changed) return;
  heightVersion.value++;
  const delta = (geometry.value.offsets[anchor] || 0) - (before.offsets[anchor] || 0);
  if (!virtual.value || restoringScroll || Math.abs(delta) <= .5) return;
  const top = scrollTop.value + delta, version = ++anchorVersion;
  scrollTop.value = top;
  void nextTick(() => {
    if (!disposed && !restoringScroll && version === anchorVersion && context === heightContext.value && viewport.value)
      viewport.value.scrollTop = top;
  });
}
const rowObserver = new ResizeObserver(entries => {
  const measurements: { id: string; height: number }[] = [];
  for (const entry of entries) {
    const node = entry.target as HTMLElement, id = node.dataset.rowId;
    if (id && rowElements.get(id) === node && Math.abs(entry.contentRect.width - width.value) <= .5)
      measurements.push({ id, height: entry.contentRect.height });
  }
  updateRowHeights(measurements);
});
function registerRow(id: string, node: HTMLElement | null) {
  const previousId = node && elementRowIds.get(node);
  if (previousId && previousId !== id) {
    rowElements.delete(previousId); rowObservationKeys.delete(previousId);
    rowObserver.unobserve(node!);
  }
  const old = rowElements.get(id);
  const row = rowsById.value.get(id);
  const key = row ? JSON.stringify([heightContext.value, heightCache.signature(row)]) : '';
  if (old === node && rowObservationKeys.get(id) === key) return;
  if (old) rowObserver.unobserve(old);
  if (node) {
    elementRowIds.set(node, id);
    rowElements.set(id, node); rowObservationKeys.set(id, key); rowObserver.observe(node);
  } else { rowElements.delete(id); rowObservationKeys.delete(id); }
}
// Ordinary page appends get their heights from ResizeObserver. Synchronous
// measurement is reserved for layout changes and saved-position restoration.
function measureRows() {
  if (!virtual.value) return;
  const measurements = [...rowElements].map(([id, node]) => ({ id, height: node.getBoundingClientRect().height }));
  updateRowHeights(measurements);
}
watch(() => [heightContext.value, virtual.value] as const,
  measureRows, { flush: 'post' });
function scrolled() { ++anchorVersion; scrollTop.value = viewport.value?.scrollTop || 0; loadNearBottom(); }
function restoreScroll(event: Event) {
  const detail = (event as CustomEvent<{ scrollTop: number; ready?: Promise<void> }>).detail;
  const route = store.snapshot.route, category = store.category;
  const version = ++restoreVersion;
  ++anchorVersion; restoringScroll = true;
  measureViewport();
  scrollTop.value = detail.scrollTop;
  // Render the saved window before assigning scrollTop; otherwise snapping can
  // pick the initial window while the saved row is still represented by a spacer.
  detail.ready = nextTick().then(async () => {
    if (disposed || version !== restoreVersion || route !== store.snapshot.route || category !== store.category) return;
    measureRows();
    await nextTick();
    if (!disposed && version === restoreVersion && viewport.value && route === store.snapshot.route && category === store.category)
      viewport.value.scrollTo({ top: detail.scrollTop, behavior: 'instant' });
  }).finally(() => {
    if (version === restoreVersion) restoringScroll = false;
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
  cancelPagingCheck();
  ++anchorVersion; ++restoreVersion; heightCache.clear();
  disposed = true; ++moveVersion; contentAnimation?.cancel(); observer.disconnect(); rowObserver.disconnect(); rowElements.clear(); rowObservationKeys.clear(); pagingObserver?.disconnect(); elements.clear();
  document.removeEventListener('visibilitychange', loadNearBottom);
});
</script>
<template>
  <div ref="viewport" data-ytg-browse-grid data-ytg-indexed-feed :data-history="isListPage || undefined" :data-ytg-virtual-feed="virtual ? '' : undefined" :style="{ scrollSnapType: virtual ? 'none' : undefined, overflowAnchor: virtual ? 'none' : undefined }" @ytg-browse-direction="direction" @ytg-browse-restore="restoreScroll" @scroll.passive="scrolled" :aria-label="pageTitle || t('Videos')" :aria-busy="store.loading">
    <slot name="heading" />
    <h1 v-if="isListPage" class="history-heading">{{ t(isHistory ? 'History' : 'Watch later') }}</h1>
    <p v-if="store.snapshot.filteredCount" role="status" class="feed-filter-status">{{ t('{count} videos hidden by home filters.', { count: store.snapshot.filteredCount }) }}</p>
    <p v-if="store.snapshot.autoLoadBlocked" role="status" class="feed-filter-status">{{ t('Automatic loading paused. Load more videos or adjust home filters.') }}</p>
    <LoadStatus v-if="!store.snapshot.items.length" :class="{ 'feed-loading-status': feedStatus.loading }" v-bind="feedStatus" @retry="retry" />
    <div ref="cards" class="cards" :data-horizontal="layout.horizontal" :style="{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, rowGap: virtual ? '0px' : undefined, '--ytg-cover-width': `${layout.cover}%`, '--ytg-cover-flex': layout.cover, '--ytg-info-flex': 100 - layout.cover }">
      <template v-if="virtual">
        <template v-for="piece in pieces" :key="piece.key">
          <div v-if="!piece.row" aria-hidden="true" data-virtual-spacer :style="{ gridColumn: '1 / -1', height: `${piece.height}px` }"></div>
          <div v-else :ref="node => registerRow(piece.row!.id, node as HTMLElement | null)" class="virtual-row" :data-shorts="piece.row.shorts" :data-row-id="piece.row.id"
            :style="{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, columnGap: `${columnGap}px`, marginBottom: `${piece.gap}px` }">
            <ShortsShelf v-if="piece.row.shorts" :items="piece.row.items" :selected-id="store.activeItemId" :keep-id="pendingSourceId" :register="register" @select="store.select" @open="open" />
            <template v-else v-for="item in piece.row.items" :key="item.id">
              <VideoCardSkeleton v-if="item.id.startsWith('skeleton:')" :data-skeleton-id="item.id" />
              <component v-else :is="item.isPlaylist ? PlaylistCard : VideoCard" :item="item" v-bind="item.isPlaylist ? { label: t('Playlist') } : {}"
                :selected="item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
            </template>
          </div>
        </template>
      </template>
      <template v-else v-for="entry in feedEntries" :key="entry.id">
        <ShortsShelf v-if="'shorts' in entry" :items="entry.shorts" :selected-id="store.activeItemId" :register="register" @select="store.select" @open="open" />
        <VideoCardSkeleton v-else-if="entry.id.startsWith('skeleton:')" :data-skeleton-id="entry.id" />
        <component v-else :is="entry.item.isPlaylist ? PlaylistCard : VideoCard" :item="entry.item"
          v-bind="entry.item.isPlaylist ? { label: t('Playlist') } : {}"
          :selected="entry.item.id === store.activeItemId" :register="register" @select="store.select" @open="open" />
      </template>
    </div>
    <div ref="sentinel" data-browse-sentinel aria-hidden="true" style="height:1px"></div>
    <LoadStatus v-if="store.snapshot.items.length && (store.error || store.loading)" v-bind="feedStatus" @retry="retry" />
    <button v-if="store.snapshot.canLoadMore" data-browse-more :disabled="store.loading" @click="emptyPages = 0; more(true)">{{ t("Load more videos") }}</button>
  </div>
</template>

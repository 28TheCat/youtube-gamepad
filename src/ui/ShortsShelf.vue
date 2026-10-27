<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BrowseItem } from '../shared/browse-data';
import { windowIndexes } from '../shared/virtual-feed';
import ShortsCard from './ShortsCard.vue';
import InterfaceIcon from './InterfaceIcon.vue';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
const props = defineProps<{ items: readonly BrowseItem[]; selectedId: string | null; keepId?: string;
  register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
const viewport = ref<HTMLElement>();
const left = ref(0), width = ref(800), cardWidth = ref(180);
const overflow = ref(false);
const gap = 16;
function scrollShorts(direction: number) {
  const node = viewport.value;
  if (!node) return;
  const max = node.scrollWidth - node.clientWidth, step = cardWidth.value + gap;
  const target = direction > 0
    ? (node.scrollLeft >= max - 1 ? 0 : Math.min(max, (Math.floor((node.scrollLeft + 1) / step) + 1) * step))
    : (node.scrollLeft <= 1 ? max : Math.max(0, (Math.ceil((node.scrollLeft - 1) / step) - 1) * step));
  node.scrollTo({ left: target, behavior: 'instant' });
  left.value = node.scrollLeft;
}
const virtual = computed(() => props.items.length > 60);
const pieces = computed(() => {
  const step = cardWidth.value + gap;
  const offsets = props.items.map((_, index) => index * step);
  const indexes = virtual.value ? windowIndexes(offsets, left.value, width.value,
    props.items.findIndex(item => item.id === props.selectedId)) : props.items.map((_, index) => index);
  const keep = props.items.findIndex(item => item.id === props.keepId);
  if (keep >= 0 && !indexes.includes(keep)) { indexes.push(keep); indexes.sort((a, b) => a - b); }
  const result: { key: string; item?: BrowseItem; space?: number }[] = [];
  let cursor = 0;
  for (const index of indexes) {
    if (offsets[index] > cursor) result.push({ key: `space:${index}`, space: offsets[index] - cursor - gap });
    result.push({ key: props.items[index].id, item: props.items[index] }); cursor = offsets[index] + step;
  }
  const remaining = props.items.length * step - cursor;
  if (remaining > 0) result.push({ key: 'end-space', space: remaining - gap });
  return result;
});
function measure() {
  const node = viewport.value;
  if (!node) return;
  width.value = node.clientWidth;
  const style = getComputedStyle(node);
  const available = Math.max(1, width.value - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  // YouTube's default rich grid derives the Shorts column cap from regular columns.
  const regular = Math.max(1, Math.min(6, Math.floor((available + gap) / (310 + gap))));
  const limit = regular === 1 ? 2 : regular % 2 === 0 ? regular / 2 * 3 : regular + 2;
  const columns = Math.max(1, Math.min(limit, Math.floor((available + gap) / (194 + gap))));
  cardWidth.value = (available - (columns - 1) * gap) / columns;
  void nextTick(() => { overflow.value = node.scrollWidth > node.clientWidth + 1; });
}
const observer = new ResizeObserver(measure);
onMounted(() => { measure(); if (viewport.value) observer.observe(viewport.value); });
onBeforeUnmount(() => observer.disconnect());
watch(() => props.items, async () => { await nextTick(); measure(); });
</script>
<template>
  <section class="shorts-shelf" aria-label="Shorts">
    <div class="shorts-heading">
      <h2><svg class="shorts-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.8 2.3a4 4 0 0 1 4 6.9l-3 1.7 1.3.8a4 4 0 0 1 0 6.9l-12 6.9a4 4 0 0 1-4-6.9l3-1.7-1.3-.8a4 4 0 0 1 0-6.9Z" transform="translate(1 -1) scale(.9)"/><path fill="white" d="m10 8 6 4-6 4Z"/></svg>Shorts</h2>
      <div v-if="overflow" class="shorts-navigation">
        <button type="button" data-shorts-scroll="previous" :aria-label="t('Previous Shorts')" :title="t('Previous Shorts')" @click="scrollShorts(-1)">
          <InterfaceIcon name="left" />
        </button>
        <button type="button" data-shorts-scroll="next" :aria-label="t('Next Shorts')" :title="t('Next Shorts')" @click="scrollShorts(1)">
          <InterfaceIcon name="right" />
        </button>
      </div>
    </div>
    <div ref="viewport" class="shorts-row" :style="{ '--ytg-shorts-card-width': `${cardWidth}px` }" @scroll.passive="left = viewport?.scrollLeft || 0">
      <template v-for="piece in pieces" :key="piece.key">
        <ShortsCard v-if="piece.item" :item="piece.item" :selected="piece.item.id === selectedId"
          :register="register" @select="emit('select', $event)" @open="emit('open', $event)" />
        <div v-else aria-hidden="true" :style="{ width: `${piece.space}px`, flex: 'none' }"></div>
      </template>
    </div>
  </section>
</template>

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
const left = ref(0), width = ref(800), cardWidth = ref(288);
const overflow = ref(false);
const gap = 16;
let slideFrame = 0, slideTarget: number | undefined;
function stopSlide() {
  cancelAnimationFrame(slideFrame); slideFrame = 0; slideTarget = undefined;
}
function slideTo(target: number) {
  const node = viewport.value;
  if (!node) return;
  stopSlide();
  target = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, target));
  const from = node.scrollLeft;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - from) <= 1) {
    node.scrollTo({ left: target, behavior: 'instant' }); left.value = node.scrollLeft; return;
  }
  slideTarget = target;
  const started = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / 500);
    // Quadratic ease-out matches the gallery's directional slide.
    node.scrollTo({ left: from + (target - from) * (1 - (1 - progress) ** 2), behavior: 'instant' });
    left.value = node.scrollLeft;
    if (progress < 1) slideFrame = requestAnimationFrame(tick);
    else { slideFrame = 0; slideTarget = undefined; }
  };
  slideFrame = requestAnimationFrame(tick);
}
function revealCard(event: Event) {
  const node = viewport.value, card = event.target as HTMLElement;
  if (!node || !node.contains(card)) return;
  event.preventDefault();
  const bounds = node.getBoundingClientRect(), target = card.getBoundingClientRect();
  const style = getComputedStyle(node);
  const start = bounds.left + (parseFloat(style.scrollPaddingLeft) || 0);
  const end = bounds.right - (parseFloat(style.scrollPaddingRight) || 0);
  const delta = target.left < start ? target.left - start : target.right > end ? target.right - end : 0;
  // Retarget from the current position on every input, including a reversal.
  if (Math.abs(delta) > 1) slideTo(node.scrollLeft + delta);
  else stopSlide();
}
function scrollShorts(direction: number) {
  const node = viewport.value;
  if (!node) return;
  const max = node.scrollWidth - node.clientWidth, step = cardWidth.value + gap;
  const current = slideTarget ?? node.scrollLeft;
  const target = direction > 0
    ? (current >= max - 1 ? 0 : Math.min(max, (Math.floor((current + 1) / step) + 1) * step))
    : (current <= 1 ? max : Math.max(0, (Math.ceil((current - 1) / step) - 1) * step));
  slideTo(target);
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
  if (width.value !== node.clientWidth) stopSlide();
  width.value = node.clientWidth;
  const style = getComputedStyle(node);
  const available = Math.max(1, width.value - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  // YouTube's default rich grid derives the Shorts column cap from regular columns.
  const regular = Math.max(1, Math.min(6, Math.floor((available + gap) / (310 + gap))));
  const limit = regular === 1 ? 2 : regular % 2 === 0 ? regular / 2 * 3 : regular + 2;
  const columns = Math.max(1, Math.min(limit, Math.floor((available + gap) / (240 + gap))));
  // Enlarge the actual card, even when the responsive column count stays unchanged.
  cardWidth.value = Math.min(available, (available - (columns - 1) * gap) / columns * 1.2);
  void nextTick(() => { overflow.value = node.scrollWidth > node.clientWidth + 1; });
}
const observer = new ResizeObserver(measure);
onMounted(() => { measure(); if (viewport.value) observer.observe(viewport.value); });
onBeforeUnmount(() => { stopSlide(); observer.disconnect(); });
watch(() => props.items, async () => { stopSlide(); await nextTick(); measure(); });
</script>
<template>
  <section class="shorts-shelf" aria-label="Shorts" @ytg-shorts-reveal="revealCard">
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
    <div ref="viewport" class="shorts-row" :style="{ '--ytg-shorts-card-width': `${cardWidth}px` }" @scroll.passive="left = viewport?.scrollLeft || 0"
      @wheel.passive="stopSlide" @pointerdown="stopSlide" @touchstart.passive="stopSlide">
      <template v-for="piece in pieces" :key="piece.key">
        <ShortsCard v-if="piece.item" :item="piece.item" :selected="piece.item.id === selectedId"
          :register="register" @select="emit('select', $event)" @open="emit('open', $event)" />
        <div v-else aria-hidden="true" :style="{ width: `${piece.space}px`, flex: 'none' }"></div>
      </template>
    </div>
  </section>
</template>

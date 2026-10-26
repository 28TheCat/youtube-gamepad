<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { computed, onBeforeUnmount, watch } from 'vue';
import type { Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import type { PlaybackModel, PlaybackViewState } from './playback-model';
import { formatPlaybackTime } from '../ui/playback-presentation';
const props = defineProps<{ model: PlaybackModel; state: PlaybackViewState; selected: boolean; adjusting: boolean; controllerStyle: ControllerStyle }>();
const state = computed(() => props.model.state.value);
const elapsed = computed(() => state.value.isLive ? (state.value.atLiveEdge ? t('Live') : t('Behind live by {time}', { time: formatPlaybackTime(state.value.end - state.value.currentTime) })) : formatPlaybackTime(state.value.currentTime));
const duration = computed(() => state.value.isLive ? (state.value.canSeek ? t('Live · Replay window: {time}', { time: formatPlaybackTime(state.value.end - state.value.start) }) : t('Live · Seeking unavailable')) : formatPlaybackTime(state.value.duration));
const percent = computed(() => state.value.canSeek ? Math.min(100, Math.max(0, (state.value.currentTime - state.value.start) / (state.value.end - state.value.start) * 100)) : 0);
let pointer: number | null = null;
function preview(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (rect.width) props.model.previewAt(state.value.start + (event.clientX - rect.left) / rect.width * (state.value.end - state.value.start));
}
function begin(event: PointerEvent) {
  if (pointer !== null || !state.value.canSeek || props.model.seeking.value || event.button !== 0) return;
  pointer = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(pointer);
  preview(event);
}
function finish(event: PointerEvent) {
  if (pointer !== event.pointerId) return;
  preview(event); pointer = null;
  void props.model.confirmSeek();
}
function cancel() { if (pointer !== null) { pointer = null; props.model.cancelPreview(); } }
watch(() => props.selected, value => { if (!value) cancel(); });
watch(() => state.value.controlsVisible, value => { if (!value) cancel(); });
onBeforeUnmount(cancel);
const vProgressLabel: Directive<HTMLElement, boolean> = {
  mounted(node, binding) { label(node, binding.value); },
  updated(node, binding) { if (binding.value !== binding.oldValue) label(node, binding.value); }
};
function label(node: HTMLElement, adjusting: boolean) {
  props.controllerStyle.bind(node, adjusting ? 'Playback position, adjusting. Left / right to seek, A to finish, B to go back' : 'Playback position, A to start adjusting', 'aria-label');
}
</script>
<template>
  <div class="times"><span data-view="elapsed">{{ elapsed }}</span><span data-view="duration">{{ duration }}</span></div>
  <button class="progress" :class="{ selected, adjusting: adjusting || model.preview.value !== null }" data-focus-id="progress" role="slider" v-progress-label="adjusting"
    :disabled="!state.canSeek" :aria-disabled="!state.canSeek" :aria-busy="model.seeking.value" :aria-valuemin="state.start" :aria-valuemax="state.end"
    :aria-valuenow="Math.min(state.end, Math.max(state.start, state.currentTime))" :aria-valuetext="elapsed + ' / ' + duration"
    :title="t(state.canSeek ? (state.isLive ? 'Live playback position' : 'Playback position') : 'Seeking is unavailable for this video')"
    @pointerdown="begin" @pointermove="pointer === $event.pointerId && preview($event)" @pointerup="finish" @pointercancel="cancel" @lostpointercapture="cancel"
    @click="$event.detail === 0 && model.request('adjustProgress')">
    <span class="track"><span class="fill" :style="{ width: percent + '%' }"></span></span>
  </button>
  <p v-if="model.error.value" role="status">{{ t(model.error.value) }}</p>
</template>

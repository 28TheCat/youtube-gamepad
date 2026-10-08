<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import type { PlaybackPresentation } from './playback-presentation';
import { recommendationFocusId } from './playback-presentation';
import type { PlaybackModel } from '../playback/playback-model';
import Timeline from '../playback/Timeline.vue';
import VolumeControl from '../playback/VolumeControl.vue';
import { YTGamepadActions } from '../shared/actions';
import PlaybackIcon from './PlaybackIcon.vue';
import PlaybackCard from './PlaybackCard.vue';
const props = defineProps<{ view: PlaybackPresentation; model: PlaybackModel; controllerStyle: ControllerStyle; activate: (action: string) => void; openVideo: (key: string) => void }>();
const video = computed(() => props.model.state.value);
const timeline = video;
const canSeek = computed(() => !!timeline.value?.canSeek);
const meta = computed(() => {
  const views = Number(props.view.page.viewCount);
  return [props.view.page.channel, views > 0 ? views.toLocaleString('en-US') + (views === 1 ? ' view' : ' views') : ''].filter(Boolean).join(' · ');
});
const avatarFailed = ref(false);
watch(() => props.view.page.avatar, () => { avatarFailed.value = false; });
const groups = [
  [['channel', ''], ['description', ''], ['subscribe', '']],
  [['seekBack', 'previous'], ['playPause', 'pause'], ['seekForward', 'next']],
  [['like', 'like'], ['dislike', 'dislike'], ['comments', 'comments'], ['save', 'save']],
  [['captions', 'captions'], ['settings', 'settings'], ['goLive', '']]
];
function label(action: string) {
  if (action === 'channel') return props.view.page.channel ? 'Channel: ' + props.view.page.channel : 'Channel';
  if (action === 'subscribe') return props.view.page.subscribed ? 'Subscribed, manage subscription' : 'Subscribe';
  if (action === 'playPause') return video.value?.paused ? 'Play' : 'Pause';
  const definition = YTGamepadActions.get(action);
  return definition?.controlLabel || definition?.label || 'Go live';
}
function pressed(action: string) {
  return action === 'subscribe' ? !!props.view.page.subscribed : action === 'like' ? !!props.view.page.liked : action === 'dislike' ? !!props.view.page.disliked : action === 'captions' ? video.value.captionsEnabled : undefined;
}
const hintEntries = computed(() => props.view.row === 'progress'
  ? (props.view.adjusting ? [['← / →', 'Seek'], ['A', 'Finish adjusting'], ['B', 'Back to timeline']] : [['A', 'Adjust position'], ['↑', 'Hide controls'], ['↓ / B', 'Back to controls']])
  : props.view.row === 'recommendations' ? [['↑ / ↓', 'Change group'], ['← / →', 'Select video'], ['A', 'Play'], ['B', 'Back to controls'], ['Start', 'Menu']]
  : [['A', 'Confirm'], ['B', 'Back'], ...(canSeek.value ? [['↑', 'Timeline · A Adjust']] : []), ['↓', 'Recommendations'], ...(canSeek.value ? [['LB / RB', 'Rewind / forward']] : []), ['Start', 'Menu']]);
const vBadge: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.badge(node, binding.value); } };
const vHint: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.hint(node, binding.value); }, updated(node, binding) { if (binding.value !== binding.oldValue) props.controllerStyle.hint(node, binding.value); } };
</script>
<template>
  <header class="heading" data-vue-playback><h1 class="title">{{ view.page.title || 'Loading video…' }}</h1><p class="meta">{{ meta }}</p></header>
  <section class="bottom">
    <Timeline :model="model" :state="model.state.value" :selected="view.selected === 'progress'" :adjusting="view.adjusting" :controller-style="controllerStyle" />
    <nav class="toolbar" aria-label="Video controls">
      <template v-for="(group, groupIndex) in groups" :key="groupIndex">
        <div v-if="groupIndex < 2" class="group">
          <button v-for="[action, symbol] in group" :key="action" class="control" :class="{ play: action === 'playPause', avatar: action === 'channel', selected: view.selected === action }"
            :data-action="action" :data-focus-id="action" :title="action === 'channel' ? view.page.channel || 'Channel' : label(action)" :aria-label="label(action)" :aria-pressed="pressed(action)"
            :disabled="['seekBack', 'seekForward'].includes(action) && !canSeek" @click="activate(action)">
            <template v-if="action === 'channel'"><img data-view="avatarImage" alt="" :src="view.page.avatar || undefined" :hidden="!view.page.avatar || avatarFailed" @error="avatarFailed = true" /><span data-view="avatarFallback" :hidden="!!view.page.avatar && !avatarFailed">{{ view.page.channel?.slice(0, 1) || '●' }}</span></template>
            <PlaybackIcon v-else-if="symbol" :name="action === 'playPause' ? (video?.paused ? 'play' : 'pause') : symbol" /><span v-else>{{ action === 'subscribe' && view.page.subscribed ? 'Subscribed' : label(action) }}</span>
          </button>
        </div>
        <div v-else-if="groupIndex === 2" class="group right-group">
          <div v-for="(rightGroup, index) in groups.slice(2)" :key="index" class="cluster">
            <button v-for="[action, symbol] in rightGroup" :key="action" class="control" :class="{ selected: view.selected === action }" :data-action="action" :data-focus-id="action"
              :aria-label="label(action)" :title="label(action)" :aria-pressed="pressed(action)" :hidden="action === 'goLive' && !timeline?.isLive" :disabled="action === 'goLive' && (!canSeek || timeline?.atLiveEdge)" @click="activate(action)">
              <PlaybackIcon v-if="symbol" :name="symbol" /><template v-else>{{ timeline?.atLiveEdge ? 'Live' : 'Go live' }}</template>
            </button>
          </div>
        </div>
      </template>
      <VolumeControl :model="model" :selected="view.selected" />
    </nav>
    <div class="recommendations" :aria-label="`Recommended videos, group ${Math.floor(view.start / 4) + 1}, ${view.page.recommendations.length} videos total`">
      <PlaybackCard v-for="(item, index) in view.page.recommendations" :key="recommendationFocusId(view.page.recommendations, index)" :item="item"
        :focus-id="recommendationFocusId(view.page.recommendations, index)" :selected="view.selected === recommendationFocusId(view.page.recommendations, index)"
        :hidden="index < view.start || index >= view.start + 4" @open="openVideo" />
    </div>
    <p class="empty" :hidden="view.page.recommendations.length > 0">{{ view.features.recommendations === 'failed' ? 'Recommendations are unavailable. Playback continues normally.' : 'No recommendations yet, or still loading…' }}</p>
    <div class="hint"><span v-for="[key, text] in hintEntries" :key="key" class="hint-item"><kbd v-badge="key"></kbd><span v-hint="text"></span></span></div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { computed, ref, watch } from 'vue';
import type { PlaybackMetadata, PlaybackControlState } from './playback-presentation';
import { YTGamepadActions } from '../shared/actions';
import PlaybackIcon from './PlaybackIcon.vue';
const props = defineProps<{ page: PlaybackMetadata; playback: PlaybackControlState; commentsOpen: boolean; activate: (action: string) => void }>();
const video = computed(() => props.playback);
const timeline = video;
const canSeek = computed(() => video.value.canSeek);
const avatarFailed = ref(false);
watch(() => props.page.avatar, () => { avatarFailed.value = false; });
const groups = [
  [['channel', ''], ['description', ''], ['subscribe', '']],
  [['seekBack', 'previous'], ['playPause', 'pause'], ['seekForward', 'next']],
  [['like', 'like'], ['dislike', 'dislike'], ['comments', 'comments'], ['save', 'save']],
  [['captions', 'captions'], ['settings', 'settings'], ['goLive', '']]
];
function label(action: string) {
  if (action === 'channel') return props.page.channel ? t('Channel: {name}', { name: props.page.channel }) : t('Channel');
  if (action === 'subscribe') return t(props.page.subscribed ? 'Subscribed, manage subscription' : 'Subscribe');
  if (action === 'playPause') return t(video.value?.paused ? 'Play' : 'Pause');
  const definition = YTGamepadActions.get(action);
  return t(definition?.controlLabel || definition?.label || 'Go live');
}
function pressed(action: string) {
  return action === 'subscribe' ? !!props.page.subscribed : action === 'like' ? !!props.page.liked : action === 'dislike' ? !!props.page.disliked : action === 'captions' ? video.value.captionsEnabled : undefined;
}
</script>
<template>
    <nav class="toolbar" :aria-label="t('Video controls')">
      <template v-for="(group, groupIndex) in groups" :key="groupIndex">
        <div v-if="groupIndex < 2" class="group">
          <button v-for="[action, symbol] in group" :key="action" class="control" :class="{ play: action === 'playPause', avatar: action === 'channel' }"
            :data-action="action" :data-focus-id="action" :title="action === 'channel' ? page.channel || t('Channel') : label(action)" :aria-label="t(label(action))" :aria-pressed="pressed(action)"
            :disabled="['seekBack', 'seekForward'].includes(action) && !canSeek" @click="activate(action)">
            <template v-if="action === 'channel'"><img data-view="avatarImage" alt="" :src="page.avatar || undefined" :hidden="!page.avatar || avatarFailed" @error="avatarFailed = true" /><span data-view="avatarFallback" :hidden="!!page.avatar && !avatarFailed">{{ page.channel?.slice(0, 1) || '●' }}</span></template>
            <PlaybackIcon v-else-if="symbol" :name="action === 'playPause' ? (video?.paused ? 'play' : 'pause') : symbol" /><span v-else>{{ action === 'subscribe' && page.subscribed ? t('Subscribed') : label(action) }}</span>
          </button>
        </div>
        <div v-else-if="groupIndex === 2" class="group right-group">
          <div v-for="(rightGroup, index) in groups.slice(2)" :key="index" class="cluster">
            <button v-for="[action, symbol] in rightGroup" :key="action" class="control"  :data-action="action" :data-focus-id="action"
              :aria-label="t(label(action))" :title="t(label(action))" :aria-pressed="pressed(action)" :hidden="action === 'goLive' && !timeline?.isLive" :disabled="action === 'goLive' && (!canSeek || timeline?.atLiveEdge)" @click="activate(action)">
              <PlaybackIcon v-if="symbol" :name="symbol" :filled="pressed(action)" /><template v-else>{{ timeline?.atLiveEdge ? t('Live') : t('Go live') }}</template>
            </button>
          </div>
        </div>
      </template>
    </nav>
    <nav class="watch-tabs" role="tablist" :aria-label="t('Recommendations')">
      <button class="watch-tab" role="tab" :aria-selected="!commentsOpen" @click="activate('recommendations')"><PlaybackIcon name="play" />{{ t('Recommendations') }}</button>
      <button class="watch-tab" role="tab" :aria-selected="!!commentsOpen" @click="activate('comments')"><PlaybackIcon name="comments" />{{ t('Comments') }}</button>
      <span class="tab-hint">LB / RB</span>
    </nav>
</template>

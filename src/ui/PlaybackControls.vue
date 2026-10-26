<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { computed } from 'vue';
import type { Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import type { PlaybackMetadata, PlaybackControlState } from './playback-presentation';
import { YTGamepadActions } from '../shared/actions';
import InterfaceIcon from './InterfaceIcon.vue';
import ChannelBadge from './ChannelBadge.vue';
import ChannelAvatar from './ChannelAvatar.vue';
import MediaActionButton from './MediaActionButton.vue';
const props = defineProps<{ page: PlaybackMetadata; playback: PlaybackControlState; commentsOpen: boolean; activate: (action: string) => void; controllerStyle: ControllerStyle }>();
const vBadge: Directive<HTMLElement, string> = {
  mounted(node, binding) { props.controllerStyle.badge(node, binding.value); }
};
const video = computed(() => props.playback);
const canSeek = computed(() => video.value.canSeek);
const primaryGroups = [
  [['channel', ''], ['subscribe', ''], ['description', '']],
  [['seekBack', 'previous'], ['playPause', 'pause'], ['seekForward', 'next']]
];
const secondaryGroups = [
  [['like', 'like'], ['dislike', 'dislike'], ['comments', 'comments'], ['save', 'save'], ['mute', 'volume']],
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
  return action === 'like' ? !!props.page.liked : action === 'dislike' ? !!props.page.disliked : action === 'captions' ? video.value.captionsEnabled : undefined;
}
</script>
<template>
    <nav class="toolbar" :aria-label="t('Video controls')">
        <div v-for="(group, groupIndex) in primaryGroups" :key="groupIndex" class="group" :class="{ 'channel-group': groupIndex === 0 }">
          <button v-for="[action, symbol] in group" :key="action" class="control" :class="{ play: action === 'playPause', avatar: action === 'channel' }"
            :data-action="action" :data-focus-id="action" :title="action === 'channel' ? page.channel || t('Channel') : label(action)" :aria-label="label(action)" :aria-pressed="pressed(action)" :aria-haspopup="action === 'subscribe' && page.subscribed ? 'dialog' : undefined"
            :disabled="['seekBack', 'seekForward'].includes(action) && !canSeek" @click="activate(action)">
            <template v-if="action === 'channel'"><ChannelAvatar class="channel-portrait" :src="page.avatar" :name="page.channel" :lazy="false" /><span class="channel-name"><span class="channel-label">{{ page.channel || t('Channel') }}</span><ChannelBadge :badge="page.channelBadge" /></span></template>
            <template v-else-if="action === 'subscribe' && page.subscribed"><InterfaceIcon class="subscription-bell" :name="page.notificationPreference === 'NONE' ? 'bell-off' : page.notificationPreference === 'ALL' ? 'bell-all' : 'bell'" /><span>{{ t('Subscribed') }}</span><InterfaceIcon class="subscription-chevron" name="down" /></template>
            <InterfaceIcon v-else-if="symbol" :name="action === 'playPause' ? (video?.paused ? 'play' : 'pause') : symbol" :filled="action === 'playPause'" /><span v-else>{{ label(action) }}</span>
          </button>
        </div>
        <div class="group right-group">
          <div v-for="(group, index) in secondaryGroups" :key="index" class="cluster">
            <template v-for="[action, symbol] in group" :key="action">
            <MediaActionButton v-if="action === 'like' || action === 'comments' || action === 'save' || action === 'mute'" :action="action"
              :active="action === 'like' ? !!page.liked : action === 'mute' ? video.muted : action === 'comments' ? commentsOpen : undefined"
              :data-action="action" :data-focus-id="action" @activate="activate(action)" />
            <button v-else class="control" :data-action="action" :data-focus-id="action"
              :aria-label="label(action)" :title="label(action)" :aria-pressed="pressed(action)" :hidden="action === 'goLive' && !video.isLive" :disabled="action === 'goLive' && (!canSeek || video.atLiveEdge)" @click="activate(action)">
              <InterfaceIcon v-if="symbol" :name="symbol" :filled="pressed(action)" /><template v-else>{{ video.atLiveEdge ? t('Live') : t('Go live') }}</template>
            </button>
            </template>
          </div>
        </div>
    </nav>
    <nav class="watch-tabs" role="tablist" :aria-label="t('Recommendations')">
      <button class="watch-tab" role="tab" :aria-selected="!commentsOpen" @click="activate('recommendations')"><InterfaceIcon name="play" filled />{{ t('Recommendations') }}</button>
      <button class="watch-tab" role="tab" :aria-selected="!!commentsOpen" @click="activate('comments')"><InterfaceIcon name="comments" />{{ t('Comments') }}</button>
      <span class="tab-hint key-controller-badge"><span v-badge="'LB'"></span><span aria-hidden="true">/</span><span v-badge="'RB'"></span></span>
    </nav>
</template>

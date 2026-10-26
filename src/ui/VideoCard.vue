<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import VideoThumbnail from './VideoThumbnail.vue';
import { useCardPreview } from './use-card-preview';
import { useI18n } from '../shared/use-i18n';
import ChannelBadge from './ChannelBadge.vue';
import ChannelAvatar from './ChannelAvatar.vue';
import ViewCountIcon from './ViewCountIcon.vue';
import type { BrowseItem } from '../shared/browse-data';
const props = defineProps<{ item: BrowseItem; selected: boolean; register: (id: string, node: HTMLAnchorElement | null) => void }>();
const emit = defineEmits<{ select: [id: string]; open: [id: string] }>();
const { t } = useI18n();
const { source: previewSource, ready: previewReady, enter: previewEnter, stop: stopPreview, leave: previewLeave,
  loaded: previewLoaded, failed: previewFailed } = useCardPreview(() => props.item);
const cover = ref<InstanceType<typeof VideoThumbnail>>();
let press: Animation | undefined;
function open() {
  stopPreview();
  press?.cancel();
  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    press = cover.value?.element?.animate([{ scale: '.97' }, { scale: '1' }], {
      duration: 120, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-card-press'
    });
  }
  emit('open', props.item.id);
}
onBeforeUnmount(() => press?.cancel());
</script>
<template>
  <a :ref="node => register(item.id, node as HTMLAnchorElement | null)" :href="item.href"
    :data-browse-id="item.id" :data-selected="selected" @focus="emit('select', item.id)"
    @pointerenter="previewEnter" @pointermove="previewEnter" @pointerleave="previewLeave"
    @click.prevent="open">
    <VideoThumbnail ref="cover" class="card-cover" :item="item">
      <template #preview>
        <iframe v-if="previewSource" class="card-video-preview" :class="{ ready: previewReady }" :src="previewSource"
          :title="t('Video preview')" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"
          tabindex="-1" @load="previewLoaded" @error="previewFailed" />
      </template>
      <slot name="cover-overlay" />
    </VideoThumbnail>
    <div class="card-copy" :class="{ 'has-channel-avatar': (item.channel || item.channelAvatar) && !item.isPlaylist }">
      <ChannelAvatar v-if="(item.channel || item.channelAvatar) && !item.isPlaylist" class="card-channel-avatar"
        :src="item.channelAvatar" :name="item.channel" :size="36" />
      <div class="card-details">
        <strong>{{ item.title }}</strong>
        <div class="card-metadata-row">
          <span class="channel">{{ item.channel }}<ChannelBadge :badge="item.channelBadge" /></span>
          <span v-if="item.viewCount || item.publishedTime" class="card-stats"><span v-if="item.viewCount" class="card-view-count"><ViewCountIcon />{{ item.viewCount }}</span>{{ item.viewCount && item.publishedTime ? ' ' : '' }}<span v-if="item.publishedTime">{{ item.publishedTime }}</span></span>
        </div>
      </div>
    </div>
  </a>
</template>

<script setup lang="ts">
import VideoThumbnail from './VideoThumbnail.vue';
import ChannelBadge from './ChannelBadge.vue';
import ViewCountIcon from './ViewCountIcon.vue';
import type { RecommendationSnapshot } from '../../types/ports';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
defineProps<{ item: RecommendationSnapshot; selected: boolean; focusId?: string }>();
const emit = defineEmits<{ open: [key: string] }>();
</script>
<template>
  <button class="card" :class="{ selected }" :data-video-id="item.key" :data-focus-id="focusId || `recommendation:${item.key}`" :aria-label="item.label" @click="emit('open', item.key)">
    <VideoThumbnail class="card-thumbnail" :item="item" />
    <div class="card-title">{{ item.label }}</div><div v-if="item.queue" class="card-meta">{{ t('Playlists') }}</div>
    <div class="card-metadata-row">
      <span class="card-meta card-channel">{{ item.channel }}<ChannelBadge :badge="item.channelBadge" /></span>
      <span v-if="item.metadata" class="card-meta card-stats"><ViewCountIcon v-if="item.viewCount" />{{ item.metadata }}</span>
    </div>
  </button>
</template>

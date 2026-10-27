<script setup lang="ts">
import ChannelBadge from './ChannelBadge.vue';
import ViewCountIcon from './ViewCountIcon.vue';

defineProps<{ item: {
  channel: string; channelBadge?: 'verified' | 'artist';
  viewCount?: string; publishedTime?: string; metadata?: string;
} }>();
</script>
<template>
  <div class="card-metadata-row" style="display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap">
    <span class="channel card-meta card-channel" style="min-width:0;min-height:0;margin-top:0;overflow:hidden;text-overflow:ellipsis">{{ item.channel }}<ChannelBadge :badge="item.channelBadge" /></span>
    <span v-if="item.metadata || item.viewCount || item.publishedTime" class="card-meta card-stats"
      style="display:inline-flex;align-items:center;flex:none;gap:8px;max-width:100%;overflow:hidden;white-space:nowrap">
      <template v-if="item.metadata"><ViewCountIcon v-if="item.viewCount" />{{ item.metadata }}</template>
      <template v-else><span v-if="item.viewCount" class="card-view-count" style="display:inline-flex;align-items:center"><ViewCountIcon />{{ item.viewCount }}</span>{{ item.viewCount && item.publishedTime ? ' ' : '' }}<span v-if="item.publishedTime">{{ item.publishedTime }}</span></template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { PlaybackMetadata } from './playback-presentation';
const { t } = useI18n();
const props = defineProps<{ page: PlaybackMetadata }>();
const meta = computed(() => {
  const views = Number(props.page.viewCount);
  return [props.page.channel, views > 0 ? t(views === 1 ? '{count} view' : '{count} views', { count: views.toLocaleString() }) : ''].filter(Boolean).join(' · ');
});
</script>
<template>
  <header class="heading" data-vue-playback><h1 class="title">{{ page.title || t('Loading video…') }}</h1><p class="meta">{{ meta }}</p></header>
</template>

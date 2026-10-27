<script setup lang="ts">
import { computed } from 'vue';
import ViewCountIcon from './ViewCountIcon.vue';
import { useI18n } from '../shared/use-i18n';
import type { PlaybackMetadata } from './playback-presentation';
const { t } = useI18n();
const props = defineProps<{ page: PlaybackMetadata; activate?: (action: string) => void }>();
const meta = computed(() => {
  const views = Number(props.page.viewCount);
  return views > 0 ? t(views === 1 ? '{count} view' : '{count} views', { count: views.toLocaleString() }) : '';
});
</script>
<template>
  <header class="heading" data-vue-playback><h1 class="title" role="button" tabindex="0" data-focus-id="metadata" :aria-label="t('Video description')" @click="activate?.('description')">{{ page.title || t('Loading video…') }}</h1><p v-if="meta" class="meta"><ViewCountIcon />{{ meta }}</p></header>
</template>

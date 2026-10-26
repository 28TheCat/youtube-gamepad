<script setup lang="ts">
import type { FeedCategory } from '../sites/youtube-feed';
import { useI18n } from '../shared/use-i18n';

defineProps<{ categories: readonly FeedCategory[]; selected: string }>();
const emit = defineEmits<{ change: [id: string] }>();
const { t } = useI18n();
</script>

<template>
  <nav v-if="categories.length" id="ytg-browse-categories" :aria-label="t('视频分类')">
    <div data-ytg-category v-for="item in categories" :key="item.id"
      :selected="selected === item.id ? '' : undefined" :aria-label="item.localize ? t(item.label) : item.label">
      <button type="button" :aria-pressed="selected === item.id" @click="emit('change', item.id)">{{ item.localize ? t(item.label) : item.label }}</button>
    </div>
  </nav>
</template>

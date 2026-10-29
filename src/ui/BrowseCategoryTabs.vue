<script setup lang="ts">
import type { FeedCategory } from '../sites/youtube-feed';
import { useI18n } from '../shared/use-i18n';
import { computed } from 'vue';

const props = defineProps<{ categories: readonly FeedCategory[]; selected: string }>();
const emit = defineEmits<{ change: [id: string] }>();
const { t } = useI18n();
const channel = computed(() => props.categories.some(item => item.id.startsWith('channel:')));
const groups = computed(() => channel.value ? [
  { id: 'tabs', label: t('Channel'), items: props.categories.filter(item => item.id.startsWith('channel:tab:')) },
  { id: 'sort', label: t('Sort'), items: props.categories.filter(item => item.id.startsWith('channel:sort:')) }
].filter(group => group.items.length) : [{ id: 'categories', label: t('视频分类'), items: props.categories }]);
function selected(item: FeedCategory) {
  const kind = item.id.startsWith('channel:sort:') ? 'channel:sort:' : 'channel:tab:';
  return channel.value && !props.selected.startsWith(kind) ? item.selected : props.selected === item.id;
}
const label = (item: FeedCategory) => item.localize ? t(item.label) : item.label;
</script>

<template>
  <nav v-if="categories.length" id="ytg-browse-categories" :aria-label="t('视频分类')">
    <div v-for="group in groups" :key="group.id" class="category-group" :data-category-group="group.id" role="group" :aria-label="group.label">
      <span v-if="group.id === 'sort'" class="category-group-label">{{ group.label }}</span>
      <div data-ytg-category v-for="item in group.items" :key="item.id" :selected="selected(item) ? '' : undefined" :aria-label="label(item)">
        <button type="button" :aria-pressed="selected(item)" @click="emit('change', item.id)">{{ label(item) }}</button>
      </div>
    </div>
  </nav>
</template>

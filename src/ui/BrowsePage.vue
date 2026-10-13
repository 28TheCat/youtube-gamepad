<script setup lang="ts">
import { useBrowseStore } from '../app/browse-store';
import type { VideoGridSettings } from '../shared/video-grid';
import BrowseSidebar from './BrowseSidebar.vue';
import BrowseCategoryTabs from './BrowseCategoryTabs.vue';
import BrowseGrid from './BrowseGrid.vue';
import BrowseHeader from './BrowseHeader.vue';

defineProps<{
  open: (id: string) => void;
  more: () => void;
  ownsFocus: () => boolean;
  gridSettings: VideoGridSettings;
  changeCategory?: (id: string) => void;
  refreshNavigation?: () => void;
}>();
const store = useBrowseStore();
</script>

<template>
  <BrowseHeader />
  <BrowseSidebar :route="store.snapshot.route" @changed="refreshNavigation?.()" />
  <BrowseCategoryTabs :categories="store.categories" :selected="store.category" @change="changeCategory?.($event)" />
  <BrowseGrid :open="open" :more="more" :owns-focus="ownsFocus" :grid-settings="gridSettings"
    :change-category="changeCategory" />
</template>
